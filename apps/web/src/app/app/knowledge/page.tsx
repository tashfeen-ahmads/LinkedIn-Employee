import { revalidatePath } from "next/cache";
import { KNOWLEDGE_BUDGET_CHARS, selectKnowledge } from "@le/agents";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";

/**
 * The only product facts the Reply Agent is allowed to state.
 *
 * Nothing wrote to this table and no screen showed it, which meant the base was
 * always empty — and the classifier is told to hand off any product question
 * the knowledge base does not answer. Autopilot could therefore never answer a
 * real question about the product, which is most of what a prospect asks.
 */

function canManage(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

async function saveDocument(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title || !content) return;

  const session = await requireSession();
  if (!canManage(session.role)) return;

  const supabase = await createClient();
  if (id) {
    await supabase
      .from("knowledge_documents")
      .update({ title, content })
      .eq("id", id)
      .eq("workspace_id", session.workspaceId);
  } else {
    await supabase.from("knowledge_documents").insert({
      workspace_id: session.workspaceId,
      title,
      content,
      source: "written here",
    });
  }

  revalidatePath("/app/knowledge");
}

async function deleteDocument(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const session = await requireSession();
  if (!canManage(session.role)) return;

  const supabase = await createClient();
  await supabase.from("knowledge_documents").delete().eq("id", id).eq("workspace_id", session.workspaceId);

  revalidatePath("/app/knowledge");
}

export default async function KnowledgePage() {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("knowledge_documents")
    .select("id, title, content, source, created_at")
    .eq("workspace_id", session.workspaceId)
    .order("created_at", { ascending: true });

  const docs = rows ?? [];
  const manage = canManage(session.role);
  // Shown before it bites: the same selection the writer will do, so a
  // document that will not reach the agent says so here rather than silently
  // going unread.
  const { omitted } = selectKnowledge(docs);
  const used = docs.reduce((total, doc) => total + doc.title.length + doc.content.length, 0);

  return (
    <>
      <h1 style={{ fontSize: "1.6rem" }}>Knowledge</h1>
      <p className="small muted" style={{ maxWidth: "62ch" }}>
        The only product facts the agent may state. Anything a prospect asks that is not answered here
        is handed to you instead of guessed at — so this page is the difference between autopilot
        answering a question and forwarding it.
      </p>

      {omitted.length ? (
        <div className="notice warning" style={{ marginTop: "1rem" }}>
          Too long to send to the agent, so it has not read{" "}
          {omitted.length === 1 ? "this document" : "these documents"}: {omitted.join(", ")}. Split{" "}
          {omitted.length === 1 ? "it" : "them"} into shorter pages and the agent will use{" "}
          {omitted.length === 1 ? "it" : "them"}.
        </div>
      ) : null}

      {manage ? (
        <section className="card" style={{ marginTop: "1.25rem" }}>
          <h3>Add a page</h3>
          <p className="small muted" style={{ marginTop: 0 }}>
            One subject per page: pricing, security, integrations, the objection you hear most. Short
            and factual beats long and persuasive — the agent quotes it, it does not summarise it.
          </p>
          <form action={saveDocument}>
            <label className="field">
              <span>Title</span>
              <input name="title" required placeholder="Pricing" />
            </label>
            <label className="field">
              <span>What the agent may say about it</span>
              <textarea name="content" rows={6} required placeholder="We charge per seat per month…" />
            </label>
            <button className="btn" type="submit">
              Add
            </button>
          </form>
        </section>
      ) : null}

      <section style={{ marginTop: "1.75rem" }}>
        <h2 style={{ fontSize: "1.15rem" }}>
          {docs.length} {docs.length === 1 ? "page" : "pages"}
          <span className="small muted" style={{ fontWeight: 400 }}>
            {" "}
            · {Math.round((used / KNOWLEDGE_BUDGET_CHARS) * 100)}% of what fits in one prompt
          </span>
        </h2>

        {docs.length === 0 ? (
          <p className="small muted" style={{ marginTop: "1rem" }}>
            Nothing here yet, so every product question a prospect asks will come to you. Start with
            pricing and the two objections you answer most.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
            {docs.map((doc) => (
              <article key={doc.id} className="card">
                {manage ? (
                  <form action={saveDocument}>
                    <input type="hidden" name="id" value={doc.id} />
                    <label className="field">
                      <span>Title</span>
                      <input name="title" defaultValue={doc.title} required />
                    </label>
                    <label className="field">
                      <span>Content</span>
                      <textarea name="content" rows={6} defaultValue={doc.content} required />
                    </label>
                    <button className="btn secondary small" type="submit">
                      Save
                    </button>
                  </form>
                ) : (
                  <>
                    <h3 style={{ marginTop: 0 }}>{doc.title}</h3>
                    <p className="small" style={{ whiteSpace: "pre-wrap" }}>
                      {doc.content}
                    </p>
                  </>
                )}
                {manage ? (
                  <form action={deleteDocument} style={{ marginTop: "0.5rem" }}>
                    <input type="hidden" name="id" value={doc.id} />
                    <button className="btn secondary small" type="submit">
                      Delete
                    </button>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
