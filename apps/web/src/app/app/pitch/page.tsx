import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PITCH_MAX_CHARS } from "@le/shared";
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
  const session = await requireManager("change the pitch");
  const instruction = String(formData.get("instruction") ?? "").trim();

  // Ninety seconds, not the ten a queue-and-return route needs: this one runs
  // the writer on the request thread so the person who clicked sees what it
  // produced. Cut off at ten, a working agent reads as a broken service.
  const result = await callWorker<{ ok: boolean; reason?: string; written?: number }>(
    "/jobs/write-pitch",
    { workspaceId: session.workspaceId, userId: session.userId, instruction: instruction || undefined },
    90_000,
  );

  if (!result.ok) redirect(errorQuery("/app/pitch", result.error));
  if (result.data && result.data.ok === false) {
    redirect(errorQuery("/app/pitch", result.data.reason ?? "The agent could not write a pitch."));
  }

  revalidatePath("/app/pitch");
  redirect(
    noticeQuery(
      "/app/pitch",
      `Written ${result.data?.written ?? 0}. Read them before approving — they go to real people.`,
    ),
  );
}

/** Save an edit. The trigger on the table clears that row's approval for us. */
async function saveEdit(formData: FormData) {
  "use server";
  const session = await requireManager("change the pitch");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim() || "Pitch";
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) redirect(errorQuery("/app/pitch", "A pitch cannot be empty."));

  // The same ceiling the agent is held to. Checked here because this box is
  // typed into by a person, and a long line is not refused by LinkedIn — it is
  // delivered, skimmed and ignored.
  if (body.length > PITCH_MAX_CHARS) {
    redirect(
      errorQuery(
        "/app/pitch",
        `That is ${body.length} characters. A pitch is read in a chat window, so ${PITCH_MAX_CHARS} is the ceiling.`,
      ),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("pitches")
    .update({ name, body, written_by: "human", facts_used: [] as never })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery("/app/pitch", `That did not save: ${error.message}`));

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Saved. Editing clears the approval, so approve it again to send it."));
}

/** The one place a pitch becomes sendable. */
async function approve(formData: FormData) {
  "use server";
  const session = await requireManager("approve the pitch");

  const id = String(formData.get("id") ?? "");
  // The exact words being approved travel with the click. Approving by id
  // alone approves whatever the row holds by the time the update lands, which
  // on a page somebody left open for an hour is not the text they read.
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) redirect(errorQuery("/app/pitch", "There is nothing to approve."));

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("pitches")
    .update({ approved_at: new Date().toISOString(), approved_by: session.userId })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .eq("body", body)
    .select("id");

  if (error) redirect(errorQuery("/app/pitch", `That did not save: ${error.message}`));
  if (!data?.length) {
    redirect(errorQuery("/app/pitch", "That pitch changed while you were reading it. Read it again, then approve."));
  }

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Approved."));
}

async function unapprove(formData: FormData) {
  "use server";
  const session = await requireManager("change the pitch");
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  await supabase
    .from("pitches")
    .update({ approved_at: null, approved_by: null })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Paused. It will not be sent to anybody."));
}

/** Which one a prospect with no angle hears. Exactly one, enforced by an index. */
async function makeDefault(formData: FormData) {
  "use server";
  const session = await requireManager("change the pitch");
  const id = String(formData.get("id") ?? "");

  const supabase = await createClient();
  // Cleared first: the unique index allows one default per workspace, so
  // setting a second without clearing the first is a constraint violation
  // rendered to somebody as "that did not save".
  await supabase
    .from("pitches")
    .update({ is_default: false })
    .eq("workspace_id", session.workspaceId)
    .eq("is_default", true);
  const { error } = await supabase
    .from("pitches")
    .update({ is_default: true })
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery("/app/pitch", `That did not save: ${error.message}`));

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "That is now what anyone with no angle hears."));
}

export default async function PitchPage({ searchParams }: { searchParams: Promise<NoticeParams> }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: rows }, { data: variants }, { count: knowledgeCount }] = await Promise.all([
    supabase
      .from("pitches")
      .select("id, name, body, angle, written_by, facts_used, approved_at, is_default")
      .eq("workspace_id", session.workspaceId)
      .order("is_default", { ascending: false })
      .order("name", { ascending: true }),
    // Which angle each one is attached to. A line you cannot see the blast
    // radius of is one nobody dares edit.
    supabase
      .from("campaign_variants")
      .select("name, pitch_id")
      .eq("workspace_id", session.workspaceId),
    supabase
      .from("knowledge_documents")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", session.workspaceId),
  ]);

  const pitches = rows ?? [];
  const manage = canManage(session.role);
  const approved = pitches.filter((p) => p.approved_at).length;
  const hasDefault = pitches.some((p) => p.is_default && p.approved_at);

  const anglesFor = new Map<string, string[]>();
  for (const variant of variants ?? []) {
    if (!variant.pitch_id) continue;
    anglesFor.set(variant.pitch_id, [...(anglesFor.get(variant.pitch_id) ?? []), variant.name]);
  }

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Your pitch"
        lede={`The offer itself, in one line. The invitation and the first message deliberately do not pitch — this is what goes out the moment somebody asks what this is. ${PITCH_MAX_CHARS} characters, because it is read in a chat window on a phone.`}
      />

      <PageNotice error={params.error} notice={params.notice} />

      {pitches.length && !hasDefault ? (
        <div className="notice warning">
          No approved pitch is set as the default, so anybody in a campaign with no angle hears
          nothing — their follow-up is held instead of sent. Approve one and mark it default.
        </div>
      ) : null}

      {pitches.length ? (
        <Section
          id="pitches"
          title={`${approved} of ${pitches.length} approved`}
          description="Each one is a different bet, not a rewording. An angle owns its prospect end to end, so the line somebody hears is the one belonging to the angle their invitation was written for."
        >
          <div className="stack-3">
            {pitches.map((pitch) => {
              const facts = Array.isArray(pitch.facts_used) ? (pitch.facts_used as string[]) : [];
              const angles = anglesFor.get(pitch.id) ?? [];
              return (
                <article key={pitch.id} className="card">
                  <div className="stack-3">
                    {manage ? (
                      <form action={saveEdit} className="stack-3">
                        <input type="hidden" name="id" value={pitch.id} />
                        <label className="field">
                          <span>Name</span>
                          <input type="text" name="name" defaultValue={pitch.name} maxLength={40} required />
                        </label>
                        <label className="field">
                          <span>The line</span>
                          <textarea
                            name="body"
                            rows={2}
                            defaultValue={pitch.body}
                            maxLength={PITCH_MAX_CHARS}
                            required
                          />
                          <span className="hint">
                            {pitch.body.length} of {PITCH_MAX_CHARS} characters. No links — the
                            destination is substituted per campaign at send time. Editing un-approves
                            it, because an approval is a statement about particular words.
                          </span>
                        </label>
                        <SubmitButton className="btn secondary small" pendingLabel="Saving…">
                          Save
                        </SubmitButton>
                      </form>
                    ) : (
                      <>
                        <h3>{pitch.name}</h3>
                        <p className="prose">{pitch.body}</p>
                      </>
                    )}

                    {pitch.angle ? (
                      // What bet this line places. Unsaid, five lines read as
                      // one sentence written five ways and nobody can tell
                      // whether two of them are the same bet.
                      <p className="small muted">Bet: {pitch.angle}</p>
                    ) : null}

                    <p className="tiny subtle">
                      {pitch.is_default ? "Default · " : ""}
                      {pitch.approved_at ? "Approved" : "Not approved"} ·{" "}
                      {pitch.written_by === "agent" ? "written by the agent" : "written by hand"}
                      {angles.length ? ` · used by ${angles.join(", ")}` : " · not attached to an angle"}
                    </p>

                    {facts.length ? (
                      <ul className="tiny muted stack-2">
                        {facts.map((fact) => (
                          <li key={fact}>{fact}</li>
                        ))}
                      </ul>
                    ) : (
                      /*
                       * Empty grounding is reported rather than hidden — rule
                       * 16's habit. A pitch citing nothing looks exactly like
                       * one citing everything, and the difference is whether a
                       * prospect is about to be told something nobody can check.
                       */
                      <p className="tiny muted">
                        {pitch.written_by === "human"
                          ? "You wrote this one, so nothing in it is checked against your knowledge base."
                          : "The agent named no source for what this says. Read it before approving."}
                      </p>
                    )}

                    {manage ? (
                      <div className="form-row">
                        {pitch.approved_at ? (
                          <form action={unapprove}>
                            <input type="hidden" name="id" value={pitch.id} />
                            <SubmitButton className="btn secondary small" pendingLabel="Pausing…">
                              Pause
                            </SubmitButton>
                          </form>
                        ) : (
                          <form action={approve}>
                            <input type="hidden" name="id" value={pitch.id} />
                            <input type="hidden" name="body" value={pitch.body} />
                            <SubmitButton className="btn small" pendingLabel="Approving…">
                              Approve
                            </SubmitButton>
                          </form>
                        )}
                        {pitch.approved_at && !pitch.is_default ? (
                          <form action={makeDefault}>
                            <input type="hidden" name="id" value={pitch.id} />
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
            })}
          </div>
        </Section>
      ) : (
        <Section id="none" title="You have no pitch yet">
          <Empty title="Nobody has written your offer down">
            Right now a prospect who replies and asks what this is gets whatever the agent can
            assemble from your business profile — a slightly different offer every time, and one
            nobody has read.
            {knowledgeCount === 0
              ? " It is written from your business profile and your knowledge base, and your knowledge base is empty: it will still write them, they will just have fewer facts to stand on."
              : ""}
          </Empty>
        </Section>
      )}

      {manage ? (
        <Section
          id="write"
          title={pitches.length ? "Ask for a different set" : "Have the agent write them"}
          description={
            pitches.length
              ? "Say what to change. Approved lines are kept — they may already be attached to an angle whose results are the reason the test was run."
              : "It reads your business profile, your knowledge base and the opening angles you approved on Strategies, and states nothing it was not given."
          }
        >
          <div className="card">
            <form action={generate} className="stack-3">
              <label className="field">
                <span>{pitches.length ? "What should be different?" : "Anything it should know"}</span>
                <textarea
                  name="instruction"
                  rows={3}
                  maxLength={2000}
                  placeholder={
                    pitches.length
                      ? "Lead with the money they are leaving on the table, not the technology."
                      : "Optional."
                  }
                />
              </label>
              <SubmitButton pendingLabel="Writing…">
                {pitches.length ? "Write a new set" : "Write my pitches"}
              </SubmitButton>
            </form>
          </div>
        </Section>
      ) : null}
    </>
  );
}
