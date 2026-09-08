/**
 * Safety caps for LinkedIn actions. These are product rules, not tunables:
 * see docs/02-product-spec.md section 4. Per-account overrides may only go lower.
 *
 * Numbers follow the vendor consensus recorded in docs/06-research.md section 2:
 * LinkedIn's weekly invitation ceiling is unpublished and adaptive, observed at
 * roughly 100/week, so we sit under it rather than at it. Unipile applies no
 * limits of its own and simply passes LinkedIn's through, which makes this file
 * the only thing standing between a campaign and a restricted account.
 */
export const LINKEDIN_LIMITS = {
  /** Connection requests per day on day 1 of a new account. */
  invitesPerDayStart: 10,
  /** Connection requests per day after the warm-up ramp. */
  invitesPerDayMax: 35,
  /** Days over which invitesPerDayStart ramps to invitesPerDayMax. */
  warmupDays: 35,
  /** Hard weekly ceiling for connection requests, all campaigns combined. */
  invitesPerWeek: 100,
  /** Messages per day (follow-ups + replies). */
  messagesPerDay: 50,
  /** Minimum gap between two actions on one account, milliseconds. */
  minGapMs: 2 * 60_000,
  /** Maximum gap added as random jitter, milliseconds. */
  maxGapMs: 9 * 60_000,
  /**
   * Withdraw pending invites older than this many days. LinkedIn permits one
   * withdrawal pass per week and only on invites at least 14 days old, so the
   * sweep runs weekly and this threshold stays above that floor.
   */
  withdrawAfterDays: 21,
  /** Do not contact anyone a teammate contacted within this window. */
  teamDedupeDays: 90,
  /** Acceptance rate below which the account is flagged for review. */
  minHealthyAcceptanceRate: 0.3,
} as const;

export const DEFAULT_WORKING_HOURS = { start: 8, end: 18, days: [1, 2, 3, 4, 5] } as const;

/** Phrases that end a sequence immediately. Matched case-insensitively as substrings. */
export const OPT_OUT_PHRASES = [
  "not interested",
  "stop messaging",
  "stop contacting",
  "remove me",
  "unsubscribe",
  "do not contact",
  "don't contact",
  "leave me alone",
] as const;

export const MODELS = {
  /** Customer-visible writing: profiles, campaign copy, reply drafts. */
  writer: "claude-opus-5",
  /** High-volume classification and scoring. */
  classifier: "claude-haiku-4-5",
} as const;
