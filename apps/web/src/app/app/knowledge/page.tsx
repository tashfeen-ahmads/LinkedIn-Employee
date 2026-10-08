import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorQuery, noticeQuery } from "@/lib/worker";
import { PageNotice } from "@/components/page-notice";
import { PageHeader, Section, Empty } from "@/components/page";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
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
  const { error } = id
    ? await supabase
        .from("knowledge_documents")
        .update({ title, content })
        .eq("id", id)
        .eq("workspace_id", session.workspaceId)
    : await supabase.from("knowledge_documents").insert({
        workspace_id: session.workspaceId,
        title,
        content,
        source: "written here",
      });

  if (error) redirect(errorQuery("/app/knowledge", `That did not save: ${error.message}`));
  revalidatePath("/app/knowledge");
  // Said out loud. It saved before this too — it just never told anybody, which
  // from the other side of the screen is the same as a button that does nothing.
  redirect(noticeQuery("/app/knowledge", id ? "Page updated." : "Page added."));
}

async function deleteDocument(formData: FormData) {
  "use server";
  const id = String(formData.get("id"));
  const session = await requireSession();
  if (!canManage(session.role)) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("knowledge_documents")
    .delete()
    .eq("id", id)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery("/app/knowledge", `That did not delete: ${error.message}`));
  revalidatePath("/app/knowledge");
  redirect(noticeQuery("/app/knowledge", "Page deleted."));
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const params = await searchParams;
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
      <PageHeader
        eyebrow="Pipeline"
        title="Knowledge base"
        lede="The only things the agent may state. Anything a prospect asks that is not answered here is handed to you rather than guessed at — so this page is the difference between autopilot answering a question and forwarding it."
      />
      <PageNotice error={params.error} notice={params.notice} />

      {omitted.length ? (
        <div className="notice warning">
          Too long to send to the agent, so it has not read{" "}
          {omitted.length === 1 ? "this document" : "these documents"}: {omitted.join(", ")}. Split{" "}
          {omitted.length === 1 ? "it" : "them"} into shorter pages and the agent will use{" "}
          {omitted.length === 1 ? "it" : "them"}.
        </div>
      ) : null}

      {manage ? (
        <Section
          title="Add a page"
          description="One subject per page: pricing, security, integrations, the objection you hear most. Short and factual beats long and persuasive — the agent quotes it, it does not summarise it."
        >
          <div className="card">
            <form action={saveDocument}>
              <label className="field">
                <span>Title</span>
                <input name="title" required placeholder="Pricing" />
              </label>
              <label className="field">
                <span>What the agent may say about it</span>
                <textarea name="content" rows={6} required placeholder="We charge per seat per month…" />
              </label>
              <SubmitButton pendingLabel="Adding…">Add</SubmitButton>
            </form>
          </div>
        </Section>
      ) : null}

      {/* Framed, so this list is spaced like every other list in the product
          rather than by a bare `<section>` plus the sheet's post-h2 margin. */}
      <Section
        title={`${docs.length} ${docs.length === 1 ? "page" : "pages"}`}
        description={`${Math.round((used / KNOWLEDGE_BUDGET_CHARS) * 100)}% of what fits in one prompt`}
      >

        {docs.length === 0 ? (
          <Empty title="Nothing here yet">
            Every product question a prospect asks will come to you until there is. Start with
            pricing and the two objections you answer most.
          </Empty>
        ) : (
          <div className="grid">
            {docs.map((doc) => (
              <article key={doc.id} className="card">
                {manage ? (
                  <form action={saveDocument} aria-label={doc.title}>
                    <input type="hidden" name="id" value={doc.id} />
                    <label className="field">
                      <span>Title</span>
                      <input name="title" defaultValue={doc.title} required />
                    </label>
                    <label className="field">
                      <span>Content</span>
                      <textarea name="content" rows={6} defaultValue={doc.content} required />
                    </label>
                    <SubmitButton className="btn secondary small" pendingLabel="Saving…">
                      Save
                    </SubmitButton>
                  </form>
                ) : (
                  <>
                    <h3>{doc.title}</h3>
                    <p className="small prewrap">
                      {doc.content}
                    </p>
                  </>
                )}
                {manage ? (
                  <form action={deleteDocument} aria-label={`Delete ${doc.title}`}>
                    <input type="hidden" name="id" value={doc.id} />
                    <ConfirmButton confirmLabel="Delete for good" pendingLabel="Deleting…">
                      Delete
                    </ConfirmButton>
                  </form>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
