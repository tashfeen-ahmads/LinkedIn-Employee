/**
 * A spend figure on the operator console, said honestly about unpriced calls.
 *
 * A model missing from the price table costs null, never zero (CLAUDE.md,
 * conventions). The database sums only the calls it could price, so a group
 * made entirely of unpriced calls arrived as `0` and printed as "$0.00", which
 * is the flattering direction to be wrong in: it reads as free. A group with
 * some unpriced calls is a floor, and says so.
 */
export function formatSpend(spendUsd: number, calls: number, unpricedCalls: number): string {
  const unpriced = Math.max(0, Math.min(unpricedCalls, calls));
  if (calls > 0 && unpriced === calls) return "unpriced";
  const amount = spendUsd === 0 ? "$0.00" : spendUsd < 0.01 ? "<$0.01" : `$${spendUsd.toFixed(2)}`;
  return unpriced > 0 ? `${amount}+` : amount;
}

/** The note that goes beside a figure `formatSpend` marked as a floor. */
export function unpricedNote(unpricedCalls: number): string | null {
  if (unpricedCalls <= 0) return null;
  return `${unpricedCalls.toLocaleString("en-US")} call${unpricedCalls === 1 ? "" : "s"} used a model missing from the price table, so the figure is a floor.`;
}
