export interface KnowledgeDoc {
  title: string;
  content: string;
}

export interface KnowledgeSelection {
  included: KnowledgeDoc[];
  /** Titles left out, so the prompt can say what the agent has not read. */
  omitted: string[];
}

/**
 * How much of the knowledge base goes into the cached system prompt. Roughly
 * ten thousand tokens: enough for a product one-pager, a pricing summary and a
 * security FAQ, and small enough that every reply is not paying for a wiki.
 */
export const KNOWLEDGE_BUDGET_CHARS = 40_000;

/**
 * Chooses which documents the writer sees.
 *
 * Whole documents or nothing. Truncating one would hand the model half a
 * pricing page with no sign that it is half, and it would answer confidently
 * from the part it could see — which is worse than not answering, because a
 * wrong price reaches the prospect looking like a right one. A document too big
 * for the budget on its own is reported as omitted, never trimmed to fit.
 */
export function selectKnowledge(
  docs: readonly KnowledgeDoc[],
  budget: number = KNOWLEDGE_BUDGET_CHARS,
): KnowledgeSelection {
  const included: KnowledgeDoc[] = [];
  const omitted: string[] = [];
  let used = 0;

  for (const doc of docs) {
    const cost = doc.title.length + doc.content.length;
    if (used + cost <= budget) {
      included.push(doc);
      used += cost;
    } else {
      // Skipped, not stopped: one oversized document must not starve the
      // shorter ones after it.
      omitted.push(doc.title);
    }
  }

  return { included, omitted };
}

/** The knowledge section of the prompt, including what was left out. */
export function renderKnowledge(docs: readonly KnowledgeDoc[]): string {
  const { included, omitted } = selectKnowledge(docs);
  if (included.length === 0 && omitted.length === 0) {
    return "(empty — you may not state any product fact beyond the business profile)";
  }

  const body = included.map((d) => `## ${d.title}\n${d.content}`).join("\n\n");
  if (omitted.length === 0) return body;

  // Named rather than hidden: the agent has to know these exist so it hands
  // off a question about them instead of guessing.
  const note = `\n\n(Not included here, and you have not read them: ${omitted.join(", ")}. If the prospect asks about any of these, say the salesperson will confirm.)`;
  return included.length ? body + note : note.trim();
}
