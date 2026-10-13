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
