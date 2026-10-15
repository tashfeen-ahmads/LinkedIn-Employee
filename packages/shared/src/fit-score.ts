/**
 * The fit score: how well one person matches one strategy, as a whole number
 * out of 100 (rule 26).
 *
 * The scorer is a model and `callStructured` casts rather than parses, so the
 * zod bounds on its schema describe the answer to the model and enforce
 * nothing. A 4.2 on a 0..10 scale, a 140, a -5 or a NaN all reached the
 * prospects table as written, where every screen prints the number beside
 * "out of 100" and the queue cut-off compares against it.
 */

/**
 * Nobody scoring below this against the strategy is added to a campaign.
 * One definition: the targeting job filters by it and the campaign and
 * prospects screens say it in words, so the two can never disagree.
 */
export const MIN_FIT_TO_QUEUE = 60;

export const FIT_SCORE_MAX = 100;

/**
 * A score fit to store: an integer in 0..100. Anything that is not a finite
 * number is 0, never a guess, and `usable` is false so the caller can treat it
 * as unscored (disqualified) rather than as a very poor match that happened to
 * be read correctly.
 */
export function clampFitScore(value: unknown): { score: number; usable: boolean } {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return { score: 0, usable: false };
  return { score: Math.min(FIT_SCORE_MAX, Math.max(0, Math.round(n))), usable: true };
}

/** The cut-off said in words, for the screens that explain the list. */
export function fitCutoffSentence(): string {
  return `Only people scoring ${MIN_FIT_TO_QUEUE} or more out of ${FIT_SCORE_MAX} against the strategy are added.`;
}
