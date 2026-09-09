import { normalizeLinkedInUrl, type IntentSignal, type ProspectCandidate } from "@le/shared";

/**
 * Intent score from observable signals. Deliberately not an LLM call: the score
 * shown on a lead card must be explainable, reproducible, and cheap enough to
 * run over thousands of rows. Weights are the product's opinion about which
 * signals actually predict a reply.
 */
const SIGNAL_WEIGHTS: Record<IntentSignal["type"], number> = {
  new_role: 30,
  company_hiring: 20,
  recent_funding: 20,
  posted_recently: 10,
  engaged_with_content: 25,
  viewed_profile: 25,
  follows_company: 15,
  open_to_work: 5,
  other: 5,
};

export interface IntentResult {
  score: number;
  /** The signals that contributed, strongest first, for display on the lead card. */
  contributing: IntentSignal[];
}

export function intentScore(signals: IntentSignal[], now: Date = new Date()): IntentResult {
  const contributing = [...signals].sort(
    (a, b) => weightOf(b, now) - weightOf(a, now),
  );
  const total = contributing.reduce((sum, s) => sum + weightOf(s, now), 0);
  return { score: Math.min(100, Math.round(total)), contributing };
}

/** A signal decays to nothing over 90 days: intent is perishable. */
function weightOf(signal: IntentSignal, now: Date): number {
  const base = SIGNAL_WEIGHTS[signal.type] * signal.weight;
  const observed = Date.parse(signal.observedAt);
  if (Number.isNaN(observed)) return base * 0.5;
  const ageDays = (now.getTime() - observed) / 86_400_000;
  if (ageDays <= 7) return base;
  if (ageDays >= 90) return 0;
  return base * (1 - (ageDays - 7) / 83);
}

/**
 * Final ranking. Fit decides whether to contact at all; intent decides who to
 * contact first. A perfect-fit prospect with no signals still outranks a
 * poor-fit prospect who just changed jobs.
 */
export function rankScore(fitScore: number, intent: number): number {
  return Math.round(fitScore * 0.7 + intent * 0.3);
}

export function dedupeCandidates(candidates: ProspectCandidate[]): ProspectCandidate[] {
  const seen = new Set<string>();
  const out: ProspectCandidate[] = [];
  for (const c of candidates) {
    const key = normalizeLinkedInUrl(c.linkedinUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
