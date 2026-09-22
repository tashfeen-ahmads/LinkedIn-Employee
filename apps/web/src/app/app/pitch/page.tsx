import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";

/**
 * The offer, written once and made to everybody.
 *
 * The invitation may not pitch and the first message after an acceptance may
 * not either — both are right, and both were already enforced. What the product
 * never had was the pitch itself. When a prospect replied and asked what this
 * was, the Reply Agent argued for the product from the business profile and
 * reached a slightly different conclusion every time, so no two people were
 * ever made the same offer and nobody had read any of them.
 *
 * The agent writes it, a person approves it, and an unapproved pitch is never
 * sent: the same division rule 9 draws for customer profiles.
 */

function canManage(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

/** Ask the agent for one, or for a revision of the one on screen. */
async function generate(formData: FormData) {
  "use server";
  const session = await requireSession();
  if (!canManage(session.role)) redirect(errorQuery("/app/pitch", "You do not have permission to change the pitch."));

  const instruction = String(formData.get("instruction") ?? "").trim();

  // Ninety seconds, not the ten a queue-and-return route needs: this one runs
  // the writer on the request thread so the person who clicked sees what it
  // produced. Cut off at ten, a working agent is reported as a broken service.
  const result = await callWorker<{ ok: boolean; reason?: string }>(
    "/jobs/write-pitch",
    { workspaceId: session.workspaceId, userId: session.userId, instruction: instruction || undefined },
    90_000,
  );

  if (!result.ok) redirect(errorQuery("/app/pitch", result.error));
  if (result.data && result.data.ok === false) {
    redirect(errorQuery("/app/pitch", result.data.reason ?? "The agent could not write a pitch."));
  }

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Written. Read it before you approve it — it goes to everybody."));
}

/** Save an edit. The trigger on the table clears the approval for us. */
async function saveEdit(formData: FormData) {
  "use server";
  const session = await requireSession();
  if (!canManage(session.role)) redirect(errorQuery("/app/pitch", "You do not have permission to change the pitch."));

  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(errorQuery("/app/pitch", "A pitch cannot be empty."));

  const supabase = await createClient();
  const { error } = await supabase
    .from("pitches")
    .upsert(
      {
        workspace_id: session.workspaceId,
        body,
        written_by: "human",
        // Written by hand, so it cites nothing the agent was given. Kept
        // honest rather than inheriting the previous draft's grounding.
        facts_used: [] as never,
        approved_at: null,
        approved_by: null,
      },
      { onConflict: "workspace_id" },
    );

  if (error) redirect(errorQuery("/app/pitch", `That did not save: ${error.message}`));

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Saved. It is not sent until you approve it."));
}

/** The one place a pitch becomes sendable. */
async function approve(formData: FormData) {
  "use server";
  const session = await requireSession();
  if (!canManage(session.role)) redirect(errorQuery("/app/pitch", "You do not have permission to approve the pitch."));

  // The exact words being approved travel with the click. Approving by
  // workspace id alone would approve whatever the row holds by the time the
  // update lands, which on a page somebody left open for an hour is not the
  // text they read.
  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(errorQuery("/app/pitch", "There is nothing to approve."));

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("pitches")
    .update({ approved_at: new Date().toISOString(), approved_by: session.userId })
    .eq("workspace_id", session.workspaceId)
    .eq("body", body)
    .select("id");

  if (error) redirect(errorQuery("/app/pitch", `That did not save: ${error.message}`));
  if (!data?.length) {
    redirect(errorQuery("/app/pitch", "The pitch changed while you were reading it. Read it again, then approve."));
  }

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Approved. The agent will make this offer from now on."));
}

async function unapprove() {
  "use server";
  const session = await requireSession();
  if (!canManage(session.role)) redirect(errorQuery("/app/pitch", "You do not have permission to change the pitch."));

  const supabase = await createClient();
  await supabase
    .from("pitches")
    .update({ approved_at: null, approved_by: null })
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/pitch");
  redirect(noticeQuery("/app/pitch", "Paused. The agent will answer from your business profile until you approve it again."));
}

export default async function PitchPage({ searchParams }: { searchParams: Promise<NoticeParams> }) {
  const params = await searchParams;
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: pitch }, { count: knowledgeCount }] = await Promise.all([
    supabase
      .from("pitches")
      .select("body, written_by, facts_used, approved_at, updated_at")
      .eq("workspace_id", session.workspaceId)
      .maybeSingle(),
    supabase
      .from("knowledge_documents")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", session.workspaceId),
  ]);

  const manage = canManage(session.role);
  const facts = Array.isArray(pitch?.facts_used) ? (pitch.facts_used as string[]) : [];
  const approved = Boolean(pitch?.approved_at);

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Your pitch"
        lede="The offer itself, written once and made to everyone who replies. The invitation and the first message deliberately do not pitch — this is what goes out the moment somebody asks what this is."
      />

      <PageNotice error={params.error} notice={params.notice} />

      {pitch ? (
        <Section
          id="pitch"
          title={approved ? "Approved and in use" : "Written, not yet approved"}
          description={
            approved
              ? "Every prospect who replies is made this offer, in the agent's own wording for that conversation."
              : "Nothing is sent while it sits here. Until you approve it, the agent argues for your product from your business profile — differently in every conversation."
          }
          action={
            manage && approved ? (
              <form action={unapprove}>
                <SubmitButton className="btn secondary small" pendingLabel="Pausing…">
                  Pause it
                </SubmitButton>
              </form>
            ) : null
          }
        >
          <div className="card">
            <div className="stack-3">
            {manage ? (
              <form action={saveEdit} className="stack-3">
                <label className="field">
                  <span className="sr-only">The pitch</span>
                  <textarea name="body" rows={7} defaultValue={pitch.body} maxLength={600} required />
                  <span className="hint">
                    Three to five sentences, under 600 characters. No links — the destination is
                    substituted per campaign at send time. Editing this un-approves it, because an
                    approval is a statement about particular words.
                  </span>
                </label>
                <div className="form-row">
                  <SubmitButton className="btn secondary" pendingLabel="Saving…">
                    Save changes
                  </SubmitButton>
                </div>
              </form>
            ) : (
              <p className="prewrap prose">{pitch.body}</p>
            )}

            <p className="tiny subtle">
              {pitch.written_by === "agent" ? "Written by the agent" : "Written by hand"} ·{" "}
              {pitch.body.length} characters
              {approved ? " · approved" : " · not approved"}
            </p>

            {manage && !approved ? (
              <form action={approve}>
                <input type="hidden" name="body" value={pitch.body} />
                <SubmitButton pendingLabel="Approving…">Approve this pitch</SubmitButton>
              </form>
            ) : null}
            </div>
          </div>

          <article className="card">
            <h3>What it claims</h3>
            {facts.length ? (
              <ul className="small stack-2">
                {facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            ) : (
              /*
               * Empty grounding is reported rather than hidden — rule 16's
               * habit. A pitch citing nothing looks exactly like one that cites
               * everything, and the difference is whether a real prospect is
               * about to be told something nobody can check.
               */
              <p className="small muted">
                {pitch.written_by === "human"
                  ? "You wrote this one, so nothing here is checked against your knowledge base. Read the claims yourself."
                  : "The agent listed no source for anything it said here. Read every claim before approving it — a pitch that cites nothing looks the same as one that cites everything."}
              </p>
            )}
          </article>
        </Section>
      ) : (
        <Section id="none" title="You have no pitch yet">
          <Empty title="Nobody has written your offer down">
            Right now a prospect who replies and asks what this is gets whatever the agent can
            assemble from your business profile — a slightly different offer every time, and one
            nobody has read.
            {knowledgeCount === 0
              ? " It is written from your business profile and your knowledge base, and your knowledge base is empty: it will still write one, it will just have fewer facts to stand on."
              : ""}
          </Empty>
        </Section>
      )}

      {manage ? (
        <Section
          id="write"
          title={pitch ? "Ask for a different one" : "Have the agent write it"}
          description={
            pitch
              ? "Say what to change. It rewrites the pitch above rather than starting from nothing, so the sentence you liked survives."
              : "It reads your business profile and your knowledge base, and states nothing it was not given."
          }
        >
          <div className="card">
            <form action={generate} className="stack-3">
              <label className="field">
                <span>{pitch ? "What should be different?" : "Anything it should know"}</span>
                <textarea
                  name="instruction"
                  rows={3}
                  maxLength={2000}
                  placeholder={
                    pitch
                      ? "Shorter. Lead with the money they are leaving on the table, not the technology."
                      : "Optional."
                  }
                />
              </label>
              <SubmitButton pendingLabel="Writing…">
                {pitch ? "Rewrite it" : "Write my pitch"}
              </SubmitButton>
            </form>
          </div>
        </Section>
      ) : null}
    </>
  );
}
