import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { HOOK_MAX_CHARS, PITCH_MAX_CHARS } from "@le/shared";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

/**
 * The offer, in one line, several ways.
 *
 * The invitation may not pitch and the first message after an acceptance may
 * not either. What the product never had was the pitch itself: when a prospect
 * replied and asked what this was, the Reply Agent argued for the product from
 * the business profile and reached a slightly different conclusion every time.
 *
 * Several, not one, for rule 28's reason. An angle owns its prospect end to end
 * — somebody accepted because one pain was named, and an offer arguing a
 * different one leaves the two halves of the funnel measuring different things.
 * The agent writes them; a person approves each. Nothing unapproved is sent.
 */

function canManage(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

/**
 * Openers and pitches are the same row with different words in it, so they are
 * the same code. Two copies of "approve", "edit clears the approval" and "one
 * default per workspace" would drift, and the half that drifted would be the
 * half nobody was looking at.
 */
type Kind = "hooks" | "pitches";

const KINDS = {
  hooks: { table: "hooks" as const, max: HOOK_MAX_CHARS, one: "opener", many: "openers" },
  pitches: { table: "pitches" as const, max: PITCH_MAX_CHARS, one: "pitch", many: "pitches" },
};

function kindOf(formData: FormData): (typeof KINDS)[Kind] {
  const raw = String(formData.get("kind") ?? "");
  // Never trusted from the form beyond picking one of two known tables: it
  // names a table, and a table name taken from a request is how one becomes
  // any table.
  return raw === "hooks" ? KINDS.hooks : KINDS.pitches;
}

async function requireManager(action: string) {
  const session = await requireSession();
  if (!canManage(session.role)) {
    redirect(errorQuery("/app/pitch", `You do not have permission to ${action}.`));
  }
  return session;
}

/** Ask the agent for a set, or for a revision of the set on screen. */
async function generate(formData: FormData) {
  "use server";
  const session = await requireManager("change the copy");
  const kind = kindOf(formData);
  const instruction = String(formData.get("instruction") ?? "").trim();

  // Ninety seconds, not the ten a queue-and-return route needs: this one runs
  // the writer on the request thread so the person who clicked sees what it
  // produced. Cut off at ten, a working agent reads as a broken service.
  const result = await callWorker<{ ok: boolean; reason?: string; written?: number }>(
    kind.table === "hooks" ? "/jobs/write-hooks" : "/jobs/write-pitch",
    { workspaceId: session.workspaceId, userId: session.userId, instruction: instruction || undefined },
    90_000,
  );

  if (!result.ok) redirect(errorQuery("/app/pitch", result.error));
  if (result.data && result.data.ok === false) {
    redirect(errorQuery("/app/pitch", result.data.reason ?? `The agent could not write ${kind.many}.`));
  }

  revalidatePath("/app/pitch");
  redirect(
    noticeQuery(
      "/app/pitch",
      `Wrote ${result.data?.written ?? 0} ${kind.many}. Read them before approving — they go to real people.`,
    ),
  );
}

/** Save an edit. The trigger on the table clears that row's approval for us. */
async function saveEdit(formData: FormData) {
  "use server";
  const session = await requireManager("change the copy");
  const kind = kindOf(formData);

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim() || "Untitled";
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) redirect(errorQuery("/app/pitch", `That ${kind.one} cannot be empty.`));

  // The same ceiling the agent is held to. Checked here because this box is
  // typed into by a person, and an over-long line is not refused by LinkedIn —
  // it is delivered, skimmed and ignored.
  if (body.length > kind.max) {
    redirect(
      errorQuery(
        "/app/pitch",
        `That is ${body.length} characters, and ${kind.max} is the ceiling for ${kind.one === "pitch" ? "a pitch" : "an opener"}.`,
      ),
    );
  }

  const supabase = await createClient();
  // Branched rather than given a union payload: `facts_used` exists on one
  // table and not the other, and a shared object would have to lie about that.
  const { error } =
    kind.table === "pitches"
      ? await supabase
          .from("pitches")
          .update({ name, body, written_by: "human", facts_used: [] as never })
          .eq("id", id)
          .eq("workspace_id", session.workspaceId)
      : await supabase
          .from("hooks")
          .update({ name, body, written_by: "human" })
          .eq("id", id)
          .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery("/app/pitch", `That did not save: ${error.message}`));

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Saved. Editing clears the approval, so approve it again before it is used."));
}

/** The one place a pitch becomes sendable. */
async function approve(formData: FormData) {
  "use server";
  const session = await requireManager("approve copy");
  const kind = kindOf(formData);

  const id = String(formData.get("id") ?? "");
  // The exact words being approved travel with the click. Approving by id
  // alone approves whatever the row holds by the time the update lands, which
  // on a page somebody left open for an hour is not the text they read.
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) redirect(errorQuery("/app/pitch", "There is nothing to approve."));

  const supabase = await createClient();
  const { error, data } = await supabase
    .from(kind.table)
    .update({ approved_at: new Date().toISOString(), approved_by: session.userId })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .eq("body", body)
    .select("id");

  if (error) redirect(errorQuery("/app/pitch", `That did not save: ${error.message}`));
  if (!data?.length) {
    redirect(errorQuery("/app/pitch", "That line changed while you were reading it. Read it again, then approve."));
  }

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Approved."));
}

async function unapprove(formData: FormData) {
  "use server";
  const session = await requireManager("change the copy");
  const kind = kindOf(formData);
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  await supabase
    .from(kind.table)
    .update({ approved_at: null, approved_by: null })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Paused. It will not be used for anybody."));
}

/** Which one a prospect with no angle hears. Exactly one, enforced by an index. */
async function makeDefault(formData: FormData) {
  "use server";
  const session = await requireManager("change the copy");
  const kind = kindOf(formData);
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  // Cleared first: the unique index allows one default per workspace, so
  // setting a second without clearing the first is a constraint violation
  // rendered to somebody as "that did not save".
  await supabase
    .from(kind.table)
    .update({ is_default: false })
    .eq("workspace_id", session.workspaceId)
    .eq("is_default", true);
  const { error } = await supabase
    .from(kind.table)
    .update({ is_default: true })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery("/app/pitch", `That did not save: ${error.message}`));

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "That is now what anyone with no angle gets."));
}

/**
 * One card, whichever kind of line it holds.
 *
 * Openers and pitches differ in what they say and in nothing else: both are
 * approved one at a time, both un-approve when edited, both have exactly one
 * default. Two copies of this markup would drift, and the half that drifted
 * would be the half nobody was looking at.
 */
function CopyCard({
  row,
  kind,
  manage,
  usedBy,
  max,
}: {
  row: {
    id: string;
    name: string;
    body: string;
    angle: string | null;
    written_by: string;
    approved_at: string | null;
    is_default: boolean;
    facts_used?: unknown;
  };
  kind: Kind;
  manage: boolean;
  usedBy: string[];
  max: number;
}) {
  const facts = Array.isArray(row.facts_used) ? (row.facts_used as string[]) : [];
  return (
    <article className="card">
      <div className="stack-3">
        {manage ? (
          <form action={saveEdit} className="stack-3">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={row.id} />
            <label className="field">
              <span>Name</span>
              <input type="text" name="name" defaultValue={row.name} maxLength={40} required />
            </label>
            <label className="field">
              <span>{kind === "hooks" ? "The opening line" : "The line"}</span>
              <textarea name="body" rows={2} defaultValue={row.body} maxLength={max} required />
              <span className="hint">
                {row.body.length} of {max} characters. No links.
                {kind === "hooks"
                  ? " It is the shape of the note, not the whole of it — the writer still says one specific thing about the person."
                  : " The destination is substituted per campaign at send time."}{" "}
                Editing un-approves it, because an approval is a statement about particular words.
              </span>
            </label>
            <SubmitButton className="btn secondary small" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </form>
        ) : (
          <>
            <h3>{row.name}</h3>
            <p className="prose">{row.body}</p>
          </>
        )}

        {row.angle ? (
          // What bet this line places. Unsaid, five lines read as one sentence
          // written five ways and nobody can tell whether two are the same bet.
          <p className="small muted">Bet: {row.angle}</p>
        ) : null}

        <p className="tiny subtle">
          {row.is_default ? "Default · " : ""}
          {row.approved_at ? "Approved" : "Not approved"} ·{" "}
          {row.written_by === "agent" ? "written by the agent" : "written by hand"}
          {usedBy.length ? ` · used by ${usedBy.join(", ")}` : " · not attached to an angle"}
        </p>

        {kind === "pitches" ? (
          facts.length ? (
            <ul className="tiny muted stack-2">
              {facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          ) : (
            /*
             * Empty grounding is reported rather than hidden — rule 16's habit.
             * A pitch citing nothing looks exactly like one citing everything,
             * and the difference is whether a prospect is about to be told
             * something nobody can check. Openers make no claim at all, by
             * prompt and by rule, so there is nothing here to ground.
             */
            <p className="tiny muted">
              {row.written_by === "human"
                ? "You wrote this one, so nothing in it is checked against your knowledge base."
                : "The agent named no source for what this says. Read it before approving."}
            </p>
          )
        ) : null}

        {manage ? (
          <div className="form-row">
            {row.approved_at ? (
              <form action={unapprove}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={row.id} />
                <SubmitButton className="btn secondary small" pendingLabel="Pausing…">
                  Pause
                </SubmitButton>
              </form>
            ) : (
              <form action={approve}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={row.id} />
                <input type="hidden" name="body" value={row.body} />
                <SubmitButton className="btn small" pendingLabel="Approving…">
                  Approve
                </SubmitButton>
              </form>
            )}
            {row.approved_at && !row.is_default ? (
              <form action={makeDefault}>
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={row.id} />
                <SubmitButton className="btn secondary small" pendingLabel="Setting…">
                  Make default
                </SubmitButton>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** The "write me a set" box, for either kind. */
function WriteBox({ kind, hasAny, help }: { kind: Kind; hasAny: boolean; help: string }) {
  return (
    <div className="card">
      <form action={generate} className="stack-3">
        <input type="hidden" name="kind" value={kind} />
        <label className="field">
          <span>{hasAny ? "What should be different?" : "Anything it should know"}</span>
          <textarea name="instruction" rows={2} maxLength={2000} placeholder={help} />
        </label>
        <SubmitButton pendingLabel="Writing…">
          {hasAny
            ? "Write a new set"
            : kind === "hooks"
              ? "Write my openers"
              : "Write my pitches"}
        </SubmitButton>
      </form>
    </div>
  );
}

export default async function PitchPage({ searchParams }: { searchParams: Promise<NoticeParams> }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: pitchRows }, { data: hookRows }, { data: variants }] = await Promise.all([
    supabase
      .from("pitches")
      .select("id, name, body, angle, written_by, facts_used, approved_at, is_default")
      .eq("workspace_id", session.workspaceId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("hooks")
      .select("id, name, body, angle, written_by, approved_at, is_default")
      .eq("workspace_id", session.workspaceId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true }),
    // Which angle each line is attached to. A line you cannot see the blast
    // radius of is one nobody dares edit.
    supabase
      .from("campaign_variants")
      .select("name, pitch_id, hook_id")
      .eq("workspace_id", session.workspaceId),
  ]);

  const pitches = pitchRows ?? [];
  const hooks = hookRows ?? [];
  const manage = canManage(session.role);

  const usedBy = new Map<string, string[]>();
  for (const variant of variants ?? []) {
    for (const id of [variant.pitch_id, variant.hook_id]) {
      if (!id) continue;
      usedBy.set(id, [...(usedBy.get(id) ?? []), variant.name]);
    }
  }

  const noDefault = (rows: Array<{ is_default: boolean; approved_at: string | null }>) =>
    rows.length > 0 && !rows.some((row) => row.is_default && row.approved_at);

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Opener and pitch"
        lede="The two lines a campaign is really made of. The opener is the shape of the connection request; the pitch is what goes out the moment somebody asks what this is. Several of each, because one is an opinion nobody can check."
      />

      <PageNotice error={params.error} notice={params.notice} />

      {noDefault(hooks) || noDefault(pitches) ? (
        <div className="notice warning">
          {noDefault(hooks) ? "No approved opener is set as the default. " : ""}
          {noDefault(pitches)
            ? "No approved pitch is set as the default, so anybody in a campaign with no angle has their follow-up held instead of sent. "
            : ""}
          Approve one of each and mark it default.
        </div>
      ) : null}

      <Section
        id="hooks"
        title={hooks.length ? `Openers — ${hooks.filter((h) => h.approved_at).length} of ${hooks.length} approved` : "Openers"}
        description="The first thing a stranger reads from you. These are shapes, never text to paste: the note is still written for the person receiving it, or everyone in the batch gets the same sentence."
      >
        {hooks.length ? (
          <div className="stack-3">
            {hooks.map((hook) => (
              <CopyCard
                key={hook.id}
                row={hook}
                kind="hooks"
                manage={manage}
                usedBy={usedBy.get(hook.id) ?? []}
                max={HOOK_MAX_CHARS}
              />
            ))}
          </div>
        ) : (
          <Empty title="Nobody has written your openers down">
            Your strategies each carry three opening angles, and until now nothing read them. Write a
            set here and they become lines you can approve, retire and attach to an angle one at a
            time.
          </Empty>
        )}
        {manage ? (
          <WriteBox
            kind="hooks"
            hasAny={hooks.length > 0}
            help={
              hooks.length
                ? "Lead with the measurement problem rather than the admin."
                : "Optional."
            }
          />
        ) : null}
      </Section>

      <Section
        id="pitches"
        title={pitches.length ? `Pitches — ${pitches.filter((p) => p.approved_at).length} of ${pitches.length} approved` : "Pitches"}
        description="The offer itself, in one line. An angle owns its prospect end to end, so the pitch somebody hears belongs to the angle their invitation was written for."
      >
        {pitches.length ? (
          <div className="stack-3">
            {pitches.map((pitch) => (
              <CopyCard
                key={pitch.id}
                row={pitch}
                kind="pitches"
                manage={manage}
                usedBy={usedBy.get(pitch.id) ?? []}
                max={PITCH_MAX_CHARS}
              />
            ))}
          </div>
        ) : (
          <Empty title="Nobody has written your offer down">
            Right now a prospect who replies and asks what this is gets whatever the agent can
            assemble from your business profile — a slightly different offer every time, and one
            nobody has read.
          </Empty>
        )}
        {manage ? (
          <WriteBox
            kind="pitches"
            hasAny={pitches.length > 0}
            help={
              pitches.length
                ? "Lead with the money they are leaving on the table, not the technology."
                : "Optional."
            }
          />
        ) : null}
      </Section>
    </>
  );
}
