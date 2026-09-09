import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker } from "@/lib/worker";

/**
 * Everything waiting on a person.
 *
 * Driven by the conversation, not by the draft. A conversation can be held for
 * a human with no draft at all — the Reply Agent could not write one, or the
 * calendar refused a booking — and while this page listed drafts, those were
 * invisible: a warm reply that the product itself decided needed attention,
 * that nobody was ever shown.
 */

/** No prompt wrote this one; recording a version would be a lie. */
const MANUAL_PROMPT_VERSION = "manual";

async function approveDraft(formData: FormData) {
  "use server";
  const draftId = String(formData.get("draftId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!draftId || !body) return;

  const session = await requireSession();
  const supabase = await createClient();

  // The edited body is what gets sent; the worker reads the row, not the form.
  await supabase
    .from("reply_drafts")
    .update({ body, status: "approved", resolved_by: session.userId, resolved_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("workspace_id", session.workspaceId);

  // If this fails, the worker's maintenance sweep re-enqueues approved drafts,
  // so an approved reply is never silently lost.
  await callWorker("/jobs/send-reply", { workspaceId: session.workspaceId, draftId });

  revalidatePath("/app/inbox");
}

/** A reply a person wrote themselves, for a conversation with no draft. */
async function sendManualReply(formData: FormData) {
  "use server";
  const conversationId = String(formData.get("conversationId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!conversationId || !body) return;

  const session = await requireSession();
  const supabase = await createClient();

  const { data: draft } = await supabase
    .from("reply_drafts")
    .insert({
      workspace_id: session.workspaceId,
      conversation_id: conversationId,
      body,
      prompt_version: MANUAL_PROMPT_VERSION,
      status: "approved",
      resolved_by: session.userId,
      resolved_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (!draft) return;

  // Sent through the same path as everything else, so it still passes the rate
  // limiter and lands in the message history. Rule 1 in CLAUDE.md.
  await callWorker("/jobs/send-reply", { workspaceId: session.workspaceId, draftId: draft.id });

  revalidatePath("/app/inbox");
}

async function dismissDraft(formData: FormData) {
  "use server";
  const draftId = String(formData.get("draftId"));
  const conversationId = String(formData.get("conversationId"));
  const session = await requireSession();
  const supabase = await createClient();

  if (draftId) {
    await supabase
      .from("reply_drafts")
      .update({ status: "dismissed", resolved_by: session.userId, resolved_at: new Date().toISOString() })
      .eq("id", draftId)
      .eq("workspace_id", session.workspaceId);
  }
  await clearConversationHold(conversationId, session.workspaceId, "reply");

  revalidatePath("/app/inbox");
}

async function markBooked(formData: FormData) {
  "use server";
  const conversationId = String(formData.get("conversationId"));
  const session = await requireSession();
  await clearConversationHold(conversationId, session.workspaceId, "booking");
  revalidatePath("/app/inbox");
}

/**
 * Clears one kind of hold. Scoped by kind for the same reason the worker's is:
 * dismissing a draft says nothing about whether a meeting reached a diary.
 */
async function clearConversationHold(conversationId: string, workspaceId: string, kind: "reply" | "booking") {
  const supabase = await createClient();
  await supabase
    .from("conversations")
    .update({ needs_human: false, needs_human_reason: null, needs_human_kind: null })
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .eq("needs_human_kind", kind);
}

export default async function InboxPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const [{ data: held }, { data: drafts }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, prospect_id, needs_human_reason, needs_human_kind, last_message_at")
      .eq("workspace_id", session.workspaceId)
      .eq("needs_human", true)
      .order("last_message_at", { ascending: true })
      .limit(100),
    supabase
      .from("reply_drafts")
      .select("id, conversation_id, body, proposes_meeting, unanswered_questions, created_at")
      .eq("workspace_id", session.workspaceId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  // A pending draft on a conversation nobody flagged still needs a decision, so
  // the list is the union rather than either one alone.
  const draftByConversation = new Map((drafts ?? []).map((d) => [d.conversation_id, d]));
  const conversationIds = [
    ...new Set([...(held ?? []).map((c) => c.id), ...(drafts ?? []).map((d) => d.conversation_id)]),
  ];

  if (conversationIds.length === 0) {
    return (
      <>
        <h1 style={{ fontSize: "1.6rem" }}>Inbox</h1>
        <p className="muted">Nothing waiting. Anything needing a human decision appears here.</p>
      </>
    );
  }

  const heldById = new Map((held ?? []).map((c) => [c.id, c]));
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, prospect_id")
    .in("id", conversationIds);
  const { data: prospects } = await supabase
    .from("prospects")
    .select("id, first_name, last_name, title, company, linkedin_url")
    .in("id", (conversations ?? []).map((c) => c.prospect_id));
  const { data: messages } = await supabase
    .from("messages")
    .select("conversation_id, direction, body, created_at")
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: true });

  const prospectById = new Map((prospects ?? []).map((p) => [p.id, p]));
  const prospectByConversation = new Map(
    (conversations ?? []).map((c) => [c.id, prospectById.get(c.prospect_id)]),
  );

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Inbox</h1>
      <p className="muted">
        {conversationIds.length}{" "}
        {conversationIds.length === 1 ? "conversation needs" : "conversations need"} your decision.
      </p>

      <div style={{ display: "grid", gap: "1rem", marginTop: "1.5rem" }}>
        {conversationIds.map((conversationId) => {
          const hold = heldById.get(conversationId);
          const draft = draftByConversation.get(conversationId);
          const prospect = prospectByConversation.get(conversationId);
          const thread = (messages ?? []).filter((m) => m.conversation_id === conversationId);
          const questions = Array.isArray(draft?.unanswered_questions)
            ? (draft.unanswered_questions as string[])
            : [];
          const booking = hold?.needs_human_kind === "booking";

          return (
            <article key={conversationId} className="card">
              <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <strong>
                    {prospect
                      ? `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() || "Prospect"
                      : "Prospect"}
                  </strong>
                  <p className="small muted" style={{ margin: 0 }}>
                    {[prospect?.title, prospect?.company].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                  {hold?.needs_human_reason ? (
                    <span className={`pill ${booking ? "danger" : "warning"}`}>{hold.needs_human_reason}</span>
                  ) : null}
                  {draft?.proposes_meeting ? <span className="pill accent">Proposes a meeting</span> : null}
                </div>
              </header>

              <div
                style={{
                  margin: "1rem 0",
                  padding: "0.75rem",
                  background: "var(--surface)",
                  borderRadius: 8,
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {thread.map((message, index) => (
                  <p key={index} className="small" style={{ margin: "0 0 0.6rem" }}>
                    <span className="muted">{message.direction === "outbound" ? "You: " : "Them: "}</span>
                    {message.body}
                  </p>
                ))}
              </div>

              {questions.length ? (
                <div className="notice warning" style={{ marginBottom: "1rem" }}>
                  The agent could not answer: {questions.join("; ")}
                </div>
              ) : null}

              {booking ? (
                <>
                  <p className="small">
                    They accepted a time and the calendar write failed, so this meeting is in nobody&apos;s
                    diary. Put it in yours, then mark it done.
                  </p>
                  <form action={markBooked}>
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <button className="btn" type="submit">
                      I have booked it
                    </button>
                  </form>
                </>
              ) : draft ? (
                <>
                  <form action={approveDraft}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <label className="field">
                      <span>Reply</span>
                      <textarea name="body" rows={4} defaultValue={draft.body} />
                    </label>
                    <button className="btn" type="submit">
                      Send
                    </button>
                  </form>
                  <form action={dismissDraft} style={{ marginTop: "0.5rem" }}>
                    <input type="hidden" name="draftId" value={draft.id} />
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <button className="btn secondary small" type="submit">
                      Dismiss, I will handle it on LinkedIn
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p className="small muted">
                    The agent did not write a reply for this one. Yours goes out through the same
                    account and the same daily limits.
                  </p>
                  <form action={sendManualReply}>
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <label className="field">
                      <span>Your reply</span>
                      <textarea name="body" rows={4} required />
                    </label>
                    <button className="btn" type="submit">
                      Send
                    </button>
                  </form>
                  <form action={dismissDraft} style={{ marginTop: "0.5rem" }}>
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <button className="btn secondary small" type="submit">
                      Dismiss, I will handle it on LinkedIn
                    </button>
                  </form>
                </>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
