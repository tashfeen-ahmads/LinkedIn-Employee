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
  /**
   * Acceptance rate below which an account is flagged for review by the
   * nightly sweep. Low acceptance is the signal LinkedIn itself watches.
   */
  minHealthyAcceptanceRate: 0.3,
} as const;

/**
 * The name the pacing loop stamps its heartbeat under.
 *
 * One string, because the loop writes it and three screens read it, and a
 * heartbeat filed under a name nobody queries is a heartbeat that does not
 * exist.
 */
export const PACING_LOOP = "campaign-tick";

/**
 * The name the worker stamps the moment it starts.
 *
 * Written straight to Postgres, before and regardless of the queue, because it
 * is the one signal that separates the failures the pacing heartbeat cannot
 * tell apart: a process that is not running, a process that is running but
 * cannot reach its queue, and a deployment still serving the previous build.
 * Those are three different things to do about it and the pacing stamp reports
 * all three as the same absence -- it can only be written by a loop that needs
 * the queue in order to run at all.
 */
export const BOOT_BEAT = "worker-boot";

/**
 * How long the pacing loop may go unheard before a screen says so.
 *
 * It wakes every five minutes; three missed wake-ups is a gap no amount of
 * normal jitter explains, and short enough that somebody watching a launch
 * finds out during the launch.
 */
export const PACING_STALE_MS = 15 * 60_000;

/**
 * The name nightly maintenance stamps when it finishes a run.
 *
 * Maintenance is where the promises this product makes outside a campaign are
 * actually kept: data erased at the retention limit, invitations withdrawn
 * before they sour an account's acceptance rate, approved replies that were
 * never dispatched picked back up, accounts repaired. All of it at 3am, none of
 * it on a screen. A month of it not running looks exactly like a month of it
 * running and finding nothing to do.
 */
export const MAINTENANCE_BEAT = "maintenance";

/**
 * How long maintenance may go unheard before a screen says so.
 *
 * It runs once a night, so two missed nights is the first gap that cannot be a
 * late start or a restart during the run.
 */
export const MAINTENANCE_STALE_MS = 50 * 60 * 60 * 1000;

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

/**
 * The two model roles this product uses, per provider.
 *
 * `writer` is customer-visible prose — profiles, campaign copy, reply drafts —
 * where a clumsy sentence is what a prospect judges the sender by. `classifier`
 * is high-volume triage, where the job is a label and the deciding factor is
 * cost per thousand.
 *
 * Which provider answers is a deployment choice (`createLlmClient` in
 * @le/agents, decided by whichever API key is present). Both rows live here so
 * MODEL_PRICING can be checked against every model the product can call — an
 * unpriced model reports its spend as unknown forever.
 */
export const MODELS = {
  // Both roles on gpt-5-mini by choice, not by default: gpt-5's output costs
  // five times as much, and the first campaigns run in approval mode where a
  // human reads every draft before it sends. That review is the quality gate
  // the eval cannot be — it scores the classifier, never the prose. If drafts
  // start reading like a template, `writer` is the one word to change.
  openai: { writer: "gpt-5-mini", classifier: "gpt-5-mini" },
  anthropic: { writer: "claude-opus-5", classifier: "claude-haiku-4-5" },
} as const;

export type LlmProvider = keyof typeof MODELS;

/**
 * The most characters LinkedIn accepts in a connection request note.
 *
 * 200, not 300. 300 is the Premium number, and it was written into the prompt,
 * the schema, the second check in `personalizeInvites` and the comment above
 * that check — four places agreeing with each other and with LinkedIn's
 * documentation for an account this deployment does not have. A free account
 * gets 200, and LinkedIn does not truncate what is over it, it refuses the
 * whole invitation:
 *
 *   400: Too many characters — The provided content exceeds the character
 *   limit. — errors/too_many_characters
 *
 * Which is a live campaign's first send failing against a real person, on a
 * list somebody reviewed, for a reason no screen could explain. Sixteen of the
 * first twenty-three notes written here were between 200 and 278 characters:
 * inside the cap that was wrong, outside the one that is real.
 *
 * Deliberately not per-account. Detecting Premium reliably is a request we
 * would have to make and trust, and being wrong costs a refused invitation off
 * a capped daily allowance. 200 is the number that works for every account,
 * and a Premium account losing 100 characters it could have used is not a
 * failure anybody sees.
 */
export const INVITE_NOTE_MAX_CHARS = 200;

/**
 * How long a pitch may be.
 *
 * A pitch is spoken into a chat window, not read on a landing page. Ninety
 * characters is what somebody actually takes in on a phone two seconds after
 * asking "what is this?" — one line, one idea. A paragraph there is skimmed and
 * then ignored, and a skimmed pitch looks exactly like one that was never sent.
 *
 * It is a hard limit rather than guidance for the same reason the invite note's
 * is: the model will happily write 400 characters of excellent prose, and the
 * only place that gets noticed is in front of a prospect.
 */
export const PITCH_MAX_CHARS = 90;

/** How many the agent writes in one go: enough to compare, few enough to read. */
export const PITCH_VARIANTS_MIN = 4;
export const PITCH_VARIANTS_MAX = 5;
