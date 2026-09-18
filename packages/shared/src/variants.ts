/**
 * Testing one angle against another, honestly.
 *
 * The thing under test here is not a message. Every prospect gets a note
 * written from their own headline, title and company, so no two people ever
 * receive the same words and an A/B test of literal text would be comparing
 * two sets of one-off sentences. What a campaign can actually hold constant
 * and vary is the **angle**: the pain the writer is told to lean on, the reason
 * for reaching out, the hook. That is what `personalizeInvites` is given, and
 * that is what a variant is.
 */

export interface VariantOutcome {
  /** Invitations actually sent from this angle. The denominator. */
  sent: number;
  accepted: number;
  replied: number;
  meetings: number;
}

export interface VariantStanding extends VariantOutcome {
  id: string;
  name: string;
  /** Accepted ÷ sent, or null when nothing has been sent from it yet. */
  acceptanceRate: number | null;
  /**
   * The range the true rate plausibly sits in, given how little has been sent.
   *
   * A rate on its own invites a decision this data cannot support: three
   * acceptances from four invitations reads as 75% and is worth almost nothing.
   * The interval is what makes the thinness visible.
   */
  low: number;
  high: number;
  /** True when no other enabled variant's interval sits entirely above this one's. */
  leading: boolean;
}

/**
 * Below this, a variant is not compared to anything.
 *
 * Not a statistical threshold — the interval already handles uncertainty — but
 * a product one: LinkedIn acceptance runs at roughly a quarter to a third, so a
 * dozen invitations is two or three acceptances, and a screen that ranks angles
 * on that teaches people to trust a number that is mostly noise. Angles are
 * also expensive to switch: a rep who kills the better angle on eight sends has
 * lost more than the test was ever going to win.
 */
export const MIN_SENDS_TO_COMPARE = 20;

/**
 * Wilson score interval for a proportion.
 *
 * The obvious interval — rate ± 1.96·sqrt(p(1-p)/n) — is wrong in exactly the
 * situation this screen lives in. At 0 of 8 it gives ±0, a claim of perfect
 * certainty from no evidence at all, and at small n it routinely runs below 0
 * or above 1. Wilson is the standard correction, it stays inside [0, 1], and it
 * is honest at the extremes where an early campaign spends all of its time.
 */
export function wilson(successes: number, trials: number, z = 1.96): { low: number; high: number } {
  if (trials <= 0) return { low: 0, high: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = p + z2 / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
  };
}

/**
 * Where each angle stands, and whether anything can yet be said about it.
 *
 * `leading` is deliberately weak: it means no other variant is clearly ahead,
 * not that this one is winning. Several variants can lead at once, and early on
 * they all will — which is the correct reading of a test that has not run long
 * enough to separate anything.
 */
export function standings(
  variants: Array<{ id: string; name: string; enabled: boolean } & VariantOutcome>,
): VariantStanding[] {
  const comparable = variants.filter((v) => v.enabled && v.sent >= MIN_SENDS_TO_COMPARE);

  return variants.map((v) => {
    const { low, high } = wilson(v.accepted, v.sent);
    // Beaten only by a variant whose whole interval sits above this one's — and
    // only when both have sent enough to be compared at all. Overlapping
    // intervals are two angles this campaign cannot yet tell apart, and saying
    // otherwise is the failure this module exists to avoid.
    const beaten = comparable.some(
      (other) => other.id !== v.id && wilson(other.accepted, other.sent).low > high,
    );
    return {
      id: v.id,
      name: v.name,
      sent: v.sent,
      accepted: v.accepted,
      replied: v.replied,
      meetings: v.meetings,
      acceptanceRate: v.sent > 0 ? v.accepted / v.sent : null,
      low,
      high,
      leading: !beaten,
    };
  });
}

/**
 * Whether the campaign can yet say one angle is doing better than another.
 *
 * Separate from `standings` because it answers the question a person actually
 * asks — "can I act on this?" — and the answer is usually no for the first
 * week. A screen that never says no trains people to read noise as signal.
 */
export function comparisonReady(variants: VariantOutcome[]): boolean {
  const live = variants.filter((v) => v.sent > 0);
  return live.length >= 2 && live.every((v) => v.sent >= MIN_SENDS_TO_COMPARE);
}

/**
 * Which variant the next prospect gets.
 *
 * Round-robin over the counts a campaign already has, never random. Random
 * assignment of fifty prospects across two angles lands 32/18 often enough to
 * matter, and the difference it invents is then read as a result. Balanced by
 * construction is free, and it is the only way the comparison above means
 * anything.
 *
 * Taking the existing counts rather than restarting at zero is what makes
 * "Find more" work: a second batch of fifty continues the rotation instead of
 * handing the first angle another even split.
 */
export function nextVariant<T extends { id: string }>(
  enabled: T[],
  assignedSoFar: Map<string, number>,
): T | null {
  if (enabled.length === 0) return null;
  let chosen = enabled[0]!;
  let fewest = assignedSoFar.get(chosen.id) ?? 0;
  for (const variant of enabled.slice(1)) {
    const count = assignedSoFar.get(variant.id) ?? 0;
    // Strictly fewer, so ties keep the declared order and the assignment is
    // reproducible: a test that shuffles on ties cannot be reasoned about from
    // the outside.
    if (count < fewest) {
      chosen = variant;
      fewest = count;
    }
  }
  return chosen;
}

/**
 * Assigns a whole batch, keeping the rotation balanced across the campaign.
 */
export function assignVariants<T extends { id: string }>(
  enabled: T[],
  count: number,
  assignedSoFar: Map<string, number> = new Map(),
): Array<T | null> {
  const running = new Map(assignedSoFar);
  const out: Array<T | null> = [];
  for (let i = 0; i < count; i++) {
    const chosen = nextVariant(enabled, running);
    if (chosen) running.set(chosen.id, (running.get(chosen.id) ?? 0) + 1);
    out.push(chosen);
  }
  return out;
}
