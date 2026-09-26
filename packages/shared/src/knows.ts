/**
 * What a workspace's agent has accumulated, said as a sentence.
 *
 * The argument for this product is not feature parity. A sequence in a tool
 * like Dripify is a text file: a competitor retypes it in ten minutes, and so
 * does the customer, which is why those tools churn. A workspace that has run
 * this for six months holds something that cannot be retyped — the lines a
 * human approved, the angles that were actually tested, and the record of
 * everybody already spoken to, which rule 24 depends on outliving every
 * campaign.
 *
 * None of that was visible anywhere. It accrued silently while the screens
 * showed rates and counts, so the one thing that makes leaving expensive was
 * the one thing nobody could see.
 *
 * Pure, for the reason every prose function here is: the agent screen says it
 * today and the renewal email will say it later, and two assemblies of one
 * claim disagree.
 */

export interface AgentKnowledge {
  /** Openers a person has approved. */
  openers: number;
  /** Offer lines a person has approved. */
  offers: number;
  /** Angles that have been run against each other with enough sends to read. */
  anglesTested: number;
  /** People this workspace has contacted, ever. The dedupe record (rule 24). */
  peopleContacted: number;
  /** Documents the agent is allowed to answer product questions from. */
  knowledgeDocuments: number;
  /** Replies it has drafted and a person has sent. */
  repliesSent: number;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The clauses, in the order they become true for a workspace.
 *
 * Each is omitted at zero rather than printed as one, for the daily report's
 * reason: "0 angles tested" reads as a failure on a workspace three days old,
 * and leaving it out reads as "not yet", which is the truth. An empty list is
 * a workspace that has genuinely accumulated nothing, and it gets a sentence
 * about what will accumulate rather than an apology for what has not.
 */
export function describeKnowledge(k: AgentKnowledge): string[] {
  const parts: string[] = [];
  if (k.openers > 0) parts.push(`${plural(k.openers, "approved opener")}`);
  if (k.offers > 0) parts.push(`${plural(k.offers, "approved offer line")}`);
  if (k.anglesTested > 0) parts.push(`${plural(k.anglesTested, "angle")} tested against each other`);
  if (k.knowledgeDocuments > 0) {
    parts.push(`${plural(k.knowledgeDocuments, "document")} it can answer questions from`);
  }
  if (k.repliesSent > 0) parts.push(`${plural(k.repliesSent, "reply", "replies")} you approved and sent`);
  return parts;
}

/**
 * The whole claim, including the part that is a promise rather than a boast.
 *
 * `peopleContacted` is deliberately its own sentence. It is not a feature, it
 * is the reason nobody here gets written to twice (rule 24) — and it is the
 * single most expensive thing to walk away from, because leaving means losing
 * the only list of who must never be approached again.
 */
export function knowledgeSentences(k: AgentKnowledge): string[] {
  const parts = describeKnowledge(k);
  const lines: string[] = [];

  lines.push(
    parts.length === 0
      ? "Your agent has not been given anything yet. Every line you approve and every angle you test stays here and makes the next campaign better than the last."
      : `Your agent has ${joinClauses(parts)}.`,
  );

  if (k.peopleContacted > 0) {
    lines.push(
      `It also remembers ${plural(k.peopleContacted, "person", "people")} you have already spoken to, and will not write to any of them twice — in this campaign or any future one.`,
    );
  }

  return lines;
}

function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
