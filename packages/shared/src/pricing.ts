/**
 * What a model call costs, so the product can answer the only question that
 * decides whether the pricing works: what does a booked meeting cost to
 * produce.
 *
 * Every call's tokens were already recorded and `cost_usd` was left null, so
 * nothing anywhere could add them up.
 *
 * These are list prices in US dollars per million tokens, and they are the one
 * thing in this repo that changes without anyone here doing anything. Check
 * them against the published pricing before quoting a margin to anyone. A
 * model missing from this table costs `null`, never zero: an unpriced model
 * silently costing nothing is how a spend report stays reassuring while the
 * bill grows.
 */
export interface ModelPrice {
  input: number;
  output: number;
  /** A cache read, which is why the stable context sits behind a breakpoint. */
  cacheRead: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  "claude-opus-5": { input: 15, output: 75, cacheRead: 1.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

const PER_MILLION = 1_000_000;

export interface TokenUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/** Dollars, or null when we do not know what this model costs. */
export function estimateCostUsd(usage: TokenUsage): number | null {
  const price = MODEL_PRICING[usage.model];
  if (!price) return null;

  // Cache reads are billed separately and are not also input tokens; the API
  // reports them as their own count.
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead) /
    PER_MILLION
  );
}

/**
 * Money, shown at a precision that does not round a real cost away.
 *
 * One reply costs a fraction of a cent. Two decimal places turn that into
 * "$0.00", and a reader concludes the model is free — which is the wrong
 * conclusion to reach from a true number badly rounded.
 */
export function formatUsd(amount: number | null): string {
  if (amount === null) return "unpriced";
  if (amount === 0) return "$0";
  if (Math.abs(amount) < 0.01) {
    // Enough significant digits that the value is never displayed as nothing.
    return `$${amount.toFixed(Math.max(2, Math.ceil(-Math.log10(Math.abs(amount))) + 1))}`;
  }
  return `$${amount.toFixed(2)}`;
}

/**
 * The share of input that came from cache. Prompt caching is the reason the
 * business profile and rep bio sit in a cached block, and this is the only
 * number that says whether it is working.
 */
export function cacheHitRate(inputTokens: number, cacheReadTokens: number): number | null {
  const total = inputTokens + cacheReadTokens;
  return total === 0 ? null : cacheReadTokens / total;
}
