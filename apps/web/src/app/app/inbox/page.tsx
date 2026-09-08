import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";

/**
 * The approval inbox. Every draft the Reply Agent held back lands here with the
 * reason it was held, the conversation so far, and anything the agent could not
 * answer from the knowledge base.
 */

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

  await fetch(`${process.env.WORKER_URL ?? "http://localhost:4000"}/jobs/send-reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: session.workspaceId, draftId }),
  }).catch(() => {
    // Approved rows are picked up by the worker's sweep if this call fails.
  });

  revalidatePath("/app/inbox");
}

async function dismissDraft(formData: FormData) {
  "use server";
  const draftId = String(formData.get("draftId"));
  const conversationId = String(formData.get("conversationId"));
  const session = await requireSession();
  const supabase = await createClient();

  await supabase
    .from("reply_drafts")
    .update({ status: "dismissed", resolved_by: session.userId, resolved_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("workspace_id", session.workspaceId);
  await supabase
    .from("conversations")
    .update({ needs_human: false, needs_human_reason: null })
    .eq("id", conversationId)
    .eq("workspace_id", session.workspaceId);

  revalidatePath("/app/inbox");
}

export default async function InboxPage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: drafts } = await supabase
    .from("reply_drafts")
    .select("id, conversation_id, body, proposes_meeting, unanswered_questions, created_at")
    .eq("workspace_id", session.workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);

  if (!drafts?.length) {
    return (
      <>
        <h1 style={{ fontSize: "1.6rem" }}>Inbox</h1>
        <p className="muted">Nothing waiting. Replies needing a human decision appear here.</p>
      </>
    );
  }

  const conversationIds = drafts.map((d) => d.conversation_id);
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, prospect_id, needs_human_reason")
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
  const conversationById = new Map((conversations ?? []).map((c) => [c.id, c]));

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Inbox</h1>
      <p className="muted">
        {drafts.length} {drafts.length === 1 ? "reply needs" : "replies need"} your decision. Edit
        anything before you send it.
      </p>

      <div style={{ display: "grid", gap: "1rem", marginTop: "1.5rem" }}>
        {drafts.map((draft) => {
          const conversation = conversationById.get(draft.conversation_id);
          const prospect = conversation ? prospectById.get(conversation.prospect_id) : undefined;
          const thread = (messages ?? []).filter((m) => m.conversation_id === draft.conversation_id);
          const questions = Array.isArray(draft.unanswered_questions)
            ? (draft.unanswered_questions as string[])
            : [];

          return (
            <article key={draft.id} className="card">
              <header style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <div>
                  <strong>
                    {prospect ? `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim() : "Prospect"}
                  </strong>
                  <p className="small muted" style={{ margin: 0 }}>
                    {[prospect?.title, prospect?.company].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                  {conversation?.needs_human_reason ? (
                    <span className="pill warning">{conversation.needs_human_reason}</span>
                  ) : null}
                  {draft.proposes_meeting ? <span className="pill accent">Proposes a meeting</span> : null}
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

              <form action={approveDraft}>
                <input type="hidden" name="draftId" value={draft.id} />
                <label className="field">
                  <span>Reply</span>
                  <textarea name="body" rows={4} defaultValue={draft.body} />
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button className="btn" type="submit">
                    Send
                  </button>
                </div>
              </form>
              <form action={dismissDraft} style={{ marginTop: "0.5rem" }}>
                <input type="hidden" name="draftId" value={draft.id} />
                <input type="hidden" name="conversationId" value={draft.conversation_id} />
                <button className="btn secondary small" type="submit">
                  Dismiss, I will handle it on LinkedIn
                </button>
              </form>
            </article>
          );
        })}
      </div>
    </>
  );
}
