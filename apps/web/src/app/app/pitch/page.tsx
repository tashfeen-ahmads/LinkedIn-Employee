import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { HOOK_MAX_CHARS, PITCH_MAX_CHARS, usesPitch } from "@le/shared";
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
      `Wrote ${result.data?.written ?? 0} ${kind.many}. Read them before approving. They go to real people.`,
    ),
  );
}

/**
 * Write the name and words from the edit form, and return the words.
 *
 * Shared by Save and "Save & approve" so the two can never disagree about what
 * was saved. The body is only rewritten when it changed: rewriting identical
 * words would mark a line the agent wrote as written by hand and throw away
 * the grounding it recorded, for an edit nobody made.
 */
async function writeEdit(formData: FormData, action: string) {
  const session = await requireManager(action);
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
  const { error: nameError } = await supabase
    .from(kind.table)
    .update({ name })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);
  if (nameError) redirect(errorQuery("/app/pitch", "That did not save. Please try again."));

  // Branched rather than given a union payload: `facts_used` exists on one
  // table and not the other, and a shared object would have to lie about that.
  const { error } =
    kind.table === "pitches"
      ? await supabase
          .from("pitches")
          .update({ body, written_by: "human", facts_used: [] as never })
          .eq("id", id)
          .eq("workspace_id", session.workspaceId)
          .neq("body", body)
      : await supabase
          .from("hooks")
          .update({ body, written_by: "human" })
          .eq("id", id)
          .eq("workspace_id", session.workspaceId)
          .neq("body", body);

  if (error) redirect(errorQuery("/app/pitch", "That did not save. Please try again."));
  return { session, supabase, kind, id, body };
}

/** Save an edit. The trigger on the table clears that row's approval for us. */
async function saveEdit(formData: FormData) {
  "use server";
  await writeEdit(formData, "change the copy");
  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Saved. Editing clears the approval, so approve it again before it is used."));
}

/**
 * The one place a line becomes sendable: save what is in the box, then
 * approve exactly those words.
 *
 * Approve used to be its own form carrying the body as rendered, so an edit
 * typed and not yet saved was dropped and the old text approved. The words
 * approved are now the words on screen, and the update still matches on them
 * so a concurrent edit between the two writes is refused rather than approved.
 */
async function approve(formData: FormData) {
  "use server";
  const { session, supabase, kind, id, body } = await writeEdit(formData, "approve copy");

  const { error, data } = await supabase
    .from(kind.table)
    .update({ approved_at: new Date().toISOString(), approved_by: session.userId })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .eq("body", body)
    .select("id");

  if (error) redirect(errorQuery("/app/pitch", "That did not save. Please try again."));
  if (!data?.length) {
    redirect(errorQuery("/app/pitch", "That line changed while you were reading it. Read it again, then approve."));
  }

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Saved and approved."));
}

async function unapprove(formData: FormData) {
  "use server";
  const session = await requireManager("change the copy");
  const kind = kindOf(formData);
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  const { error } = await supabase
    .from(kind.table)
    .update({ approved_at: null, approved_by: null })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  // A pause that did not happen, reported as one, leaves a line going out to
  // people that somebody believes is stopped.
  if (error) redirect(errorQuery("/app/pitch", "That did not pause, so it is still in use. Please try again."));
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
  // Which default this row competes with. The index allows one default per
  // agent, and one for the lines no agent owns (migration 0031); clearing every
  // default in the workspace, as this did, wiped each agent's own default line
  // whenever somebody set the workspace's here.
  const { data: target } = await supabase
    .from(kind.table)
    .select("id, agent_id, approved_at")
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!target) redirect(errorQuery("/app/pitch", `That ${kind.one} is gone.`));
  if (!target.approved_at) {
    redirect(errorQuery("/app/pitch", `Approve that ${kind.one} before making it the default.`));
  }

  // Cleared first: setting a second default in the same scope without
  // clearing the first is a constraint violation.
  const clear = supabase
    .from(kind.table)
    .update({ is_default: false })
    .eq("workspace_id", session.workspaceId)
    .eq("is_default", true);
  await (target.agent_id ? clear.eq("agent_id", target.agent_id) : clear.is("agent_id", null));
  const { error } = await supabase
    .from(kind.table)
    .update({ is_default: true })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery("/app/pitch", "That did not save. Please try again."));

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

  const details = (
    <>
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
    </>
  );

  if (!manage) {
    return (
      <article className="card">
        <div className="stack-3">
          <h3>{row.name}</h3>
          <p className="prose">{row.body}</p>
          {details}
        </div>
      </article>
    );
  }

  /*
   * One form for everything done to this line, so every button submits what is
   * in the boxes. Approve used to be a separate form carrying the body as it
   * was rendered, which dropped an unsaved edit and approved the old words.
   */
  return (
    <article className="card">
      <form action={saveEdit} className="stack-3">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={row.id} />
        <label className="field">
          <span>Name</span>
          <input type="text" name="name" defaultValue={row.name} maxLength={40} required autoComplete="off" />
        </label>
        <label className="field">
          <span>{kind === "hooks" ? "The opening line" : "The line"}</span>
          <textarea name="body" rows={2} defaultValue={row.body} maxLength={max} required />
          <span className="hint">
            Up to {max} characters. No links.
            {kind === "hooks"
              ? " It is the shape of the note, not the whole of it: the writer still says one specific thing about the person."
              : " The destination is substituted per campaign at send time."}{" "}
            Editing un-approves it, because an approval is a statement about particular words.
          </span>
        </label>

        {details}

        <div className="form-row">
          {row.approved_at ? (
            <>
              <SubmitButton className="btn secondary small" pendingLabel="Saving…">
                Save
              </SubmitButton>
              <SubmitButton className="btn secondary small" pendingLabel="Pausing…" formAction={unapprove}>
                Pause
              </SubmitButton>
              {!row.is_default ? (
                <SubmitButton
                  className="btn secondary small"
                  pendingLabel="Setting…"
                  formAction={makeDefault}
                >
                  Make default
                </SubmitButton>
              ) : null}
            </>
          ) : (
            <>
              {/* Save first: Enter in a field submits the first button, and a
                  keystroke must not approve copy that goes to real people. */}
              <SubmitButton className="btn secondary small" pendingLabel="Saving…">
                Save
              </SubmitButton>
              <SubmitButton className="btn small" pendingLabel="Approving…" formAction={approve}>
                Save and approve
              </SubmitButton>
            </>
          )}
        </div>
      </form>
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

  const [{ data: pitchRows }, { data: hookRows }, { data: variants }, { data: liveCampaigns }] = await Promise.all([
    supabase
      .from("pitches")
      .select("id, name, body, angle, written_by, facts_used, approved_at, is_default, agent_id")
      .eq("workspace_id", session.workspaceId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true }),
    supabase
      .from("hooks")
      .select("id, name, body, angle, written_by, approved_at, is_default, agent_id")
      .eq("workspace_id", session.workspaceId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true }),
    // Which angle each line is attached to. A line you cannot see the blast
    // radius of is one nobody dares edit.
    supabase
      .from("campaign_variants")
      .select("name, pitch_id, hook_id")
      .eq("workspace_id", session.workspaceId),
    // Campaigns that can still send a follow-up, for whether any of their
    // steps is built from `{{pitch}}` at all.
    supabase
      .from("campaigns")
      .select("id")
      .eq("workspace_id", session.workspaceId)
      .in("status", ["draft", "running", "paused"])
      .limit(500),
  ]);
  const liveIds = (liveCampaigns ?? []).map((c) => c.id);
  const { data: liveSteps } = liveIds.length
    ? await supabase.from("campaign_steps").select("message").in("campaign_id", liveIds).limit(2000)
    : { data: [] as Array<{ message: string }> };
  /*
   * Only a step built from `{{pitch}}` is ever held for want of one (rule 40).
   * The warning said every workspace without a default would have its
   * follow-ups held, including the ones whose steps never mention the pitch,
   * which is most of them: replies are drafted without one, and a follow-up
   * written in full sends as written.
   */
  const pitchInUse = (liveSteps ?? []).some((step) => usesPitch(step.message ?? ""));

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

  // An approved line on an agent is used by that agent's campaigns before any
  // workspace default (`loadPitch`), and every campaign built from a strategy
  // carries the workspace's agent. So only with none of those approved is
  // anything held — reading `is_default` alone warned every workspace whose
  // agent's lines were approved where they are used.
  const noDefault = (rows: Array<{ is_default: boolean; approved_at: string | null; agent_id: string | null }>) =>
    rows.length > 0 && !rows.some((row) => row.approved_at && (row.is_default || row.agent_id));

  return (
    <>
      <PageHeader
        eyebrow="Setup"
        title="Opener and pitch"
        lede="The opener is the idea each connection note is built on. The pitch is the one-line offer Nora makes when somebody asks what you do. Keep a few of each, and approve each one before it is used."
      />

      <PageNotice error={params.error} notice={params.notice} />

      {noDefault(hooks) || (noDefault(pitches) && pitchInUse) ? (
        <div className="notice warning">
          {noDefault(hooks) ? "No approved opener is set as the default. " : ""}
          {noDefault(pitches) && pitchInUse
            ? "No approved pitch is set as the default, and a campaign step is built from {{pitch}}, so anybody in a campaign with no angle has that follow-up held instead of sent. "
            : ""}
          {noDefault(hooks) && noDefault(pitches) && pitchInUse
            ? "Approve one of each and mark it default."
            : "Approve one and mark it default."}
        </div>
      ) : null}

      <Section
        id="hooks"
        title={hooks.length ? `Openers: ${hooks.filter((h) => h.approved_at).length} of ${hooks.length} approved` : "Openers"}
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
        title={pitches.length ? `Pitches: ${pitches.filter((p) => p.approved_at).length} of ${pitches.length} approved` : "Pitches"}
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
            assemble from your business profile: a slightly different offer every time, and one
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
