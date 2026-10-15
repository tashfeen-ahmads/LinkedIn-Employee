import type { Db } from "@le/db";

/** How many documents a writer is handed before `selectKnowledge` budgets them. */
export const KNOWLEDGE_DOC_LIMIT = 20;

/**
 * The knowledge documents a writer reads, in the order `/app/knowledge` lists
 * them: oldest first, then by id so two documents saved in the same instant
 * still sort the same way every time.
 *
 * The order is the whole point (rule 11). `selectKnowledge` keeps whole
 * documents until the budget runs out, so which ones fit depends on which come
 * first. Read in no fixed order, two replies in the same conversation could be
 * written from different pricing pages, and the knowledge page's "left out"
 * warning would describe a selection the agent never made.
 */
export function knowledgeQuery(db: Db, workspaceId: string) {
  return db
    .from("knowledge_documents")
    .select("title, content")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(KNOWLEDGE_DOC_LIMIT);
}

/**
 * The knowledge a writer working for one brand may read.
 *
 * A workspace can run several agents, each a separate brand or product, and
 * a document attached to one of them is that brand's facts: its prices, its
 * guarantees, its customers. Handed to another brand's reply, it is answered
 * from as confidently as the right page would be, and a prospect is quoted a
 * price for a product they were never offered. So the campaign's agent reads
 * its own documents plus the workspace-level ones (`agent_id` null, shared by
 * every agent), and a conversation with no agent reads only the shared ones —
 * never another agent's.
 *
 * Two queries rather than one `or()`, merged back into `knowledgeQuery`'s
 * order (oldest first, then id), because the order is what `selectKnowledge`
 * budgets by (rule 11) and the union's first twenty are always among the
 * first twenty of each half. Nothing here shortens a document; leaving whole
 * ones out is still `selectKnowledge`'s job, and it names what it left out.
 */
export async function knowledgeFor(
  db: Db,
  workspaceId: string,
  agentId: string | null,
): Promise<Array<{ title: string; content: string }>> {
  const scoped = (owner: string | null) => {
    const q = db
      .from("knowledge_documents")
      .select("id, title, content, created_at")
      .eq("workspace_id", workspaceId);
    return (owner ? q.eq("agent_id", owner) : q.is("agent_id", null))
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(KNOWLEDGE_DOC_LIMIT);
  };
  const [shared, own] = await Promise.all([
    scoped(null),
    agentId ? scoped(agentId) : Promise.resolve({ data: [] as never[] }),
  ]);
  const rows = [...(shared.data ?? []), ...(own.data ?? [])] as Array<{
    id: string;
    title: string;
    content: string;
    created_at: string;
  }>;
  rows.sort((a, b) =>
    a.created_at === b.created_at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.created_at < b.created_at ? -1 : 1,
  );
  return rows.slice(0, KNOWLEDGE_DOC_LIMIT).map(({ title, content }) => ({ title, content }));
}
