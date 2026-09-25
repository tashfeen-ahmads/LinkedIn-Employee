/**
 * What a provider refusal actually means: try this person again later, or never.
 *
 * Every provider error used to mean the same thing — `failProspect`, status
 * `failed`, `next_action_at` null, the person gone from the campaign for good.
 * That is right for "this member cannot be invited" and catastrophically wrong
 * for what LinkedIn actually says most of the time, which is:
 *
 *     422 cannot_resend_yet — You have reached a temporary provider limit.
 *     Please try again later.
 *
 * Seven real prospects were burned on that sentence in twenty-five minutes on
 * a single morning, each one recorded as a permanent failure on an error whose
 * own words are "please try again later". The rep reads seven failures and
 * concludes the list was bad. The list was fine; the account was throttled.
 *
 * So the classification is deliberately conservative in one direction: a
 * refusal we do not recognise is treated as **permanent**. Retrying an unknown
 * error against LinkedIn for ever is how an account gets restricted, and a
 * restricted account is the one failure this product cannot come back from.
 * Adding a slug here is a small, reviewable change; guessing is not.
 */

/** Try again later, and how long to leave the account alone meanwhile. */
export interface RetryLater {
  kind: "retry_later";
  /** How long invitations should stop. */
  cooldownMs: number;
  /**
   * Who the refusal is actually about.
   *
   * `account` is LinkedIn slowing this account down, and everything queued on
   * it has to wait. `prospect` is LinkedIn saying something about one person —
   * "an invitation has already been sent recently to this recipient" — and
   * pausing the whole account on it is a misreading that stops twenty-five
   * other invitations over one.
   *
   * That is not hypothetical: one `already_invited_recently` put a live
   * account into a twenty-four hour account-wide hold, and nobody else on the
   * list could be written to.
   */
  scope: "account" | "prospect";
  /** Plain words for the screen, not the raw provider string. */
  summary: string;
}

/** This person, or this action, is not going to work. Stop asking. */
export interface Permanent {
  kind: "permanent";
}

export type ProviderErrorKind = RetryLater | Permanent;

const HOUR = 60 * 60_000;

/**
 * How long to stop inviting after each kind of throttle.
 *
 * Long on purpose. A rejected invitation is not free: it is a request LinkedIn
 * logs against an account it has already decided to slow down, and the reflex
 * to "retry in five minutes" is what turns a temporary limit into a permanent
 * restriction. Hours, not minutes.
 */
const COOLDOWNS = {
  /** The account-wide invitation throttle. The common one, and the worst to rush. */
  providerLimit: 6 * HOUR,
  /** This specific person was invited recently; the account itself is fine. */
  recentlyInvited: 24 * HOUR,
  /** An explicit rate limit or a 429. */
  rateLimited: 2 * HOUR,
} as const;

/** Never wait longer than this, however many times running LinkedIn refuses. */
const MAX_COOLDOWN_MS = 72 * HOUR;

/**
 * The wait after the nth consecutive account-wide refusal.
 *
 * Doubling, because a flat cooldown is right once and wrong for ever after.
 * An account LinkedIn keeps refusing was probed again every six hours with no
 * end — a constant knock on a door that has been shut, which is how a
 * temporary limit becomes a permanent restriction. Six hours, twelve,
 * twenty-four, forty-eight, then capped at three days.
 *
 * Capped rather than unbounded, and it never stops probing altogether: a
 * throttle that has lifted has to be discovered somehow, and repair must never
 * wait for somebody to find a button. The knocking gets quieter; it does not
 * stop.
 *
 * `streak` is the number of refusals *before* this one, so the first refusal
 * of a run passes 0 and gets the base cooldown unchanged. That keeps the
 * common case — one throttle, one wait — exactly as it was.
 */
export function backOff(baseMs: number, streak: number): number {
  const safe = Number.isFinite(streak) && streak > 0 ? Math.floor(streak) : 0;
  // Bounded before the shift, because 1 << 31 is negative and a negative
  // cooldown is a hold that has already expired — the opposite of the rule.
  const doublings = Math.min(safe, 8);
  return Math.min(baseMs * 2 ** doublings, MAX_COOLDOWN_MS);
}

/**
 * Matched on the provider's own error slugs first, its prose second.
 *
 * The slug (`errors/cannot_resend_yet`) is the stable half and the sentence is
 * the half that gets reworded, so the slug is checked first and the prose is
 * the fallback for a slug Unipile has not documented. Both are lowercased
 * because neither is a contract.
 */
const RETRYABLE: ReadonlyArray<{
  match: RegExp;
  cooldownMs: number;
  scope: "account" | "prospect";
  summary: string;
}> = [
  {
    // "You have reached a temporary provider limit. Please try again later."
    match: /errors\/cannot_resend_yet|temporary provider limit/,
    cooldownMs: COOLDOWNS.providerLimit,
    scope: "account",
    summary: "LinkedIn is temporarily refusing invitations from this account",
  },
  {
    // "An invitation has already been sent recently to this recipient."
    //
    // About the recipient, not the account. Everyone else on the list can
    // still be written to, and holding them over this is how one awkward row
    // silences a campaign.
    match: /errors\/already_invited_recently|already been sent recently/,
    cooldownMs: COOLDOWNS.recentlyInvited,
    scope: "prospect",
    summary: "LinkedIn says this person was invited recently",
  },
  {
    match: /errors\/rate_limit|too many requests|\b429\b/,
    cooldownMs: COOLDOWNS.rateLimited,
    scope: "account",
    summary: "LinkedIn rate-limited this account",
  },
  {
    // Unipile's transport gave out rather than LinkedIn refusing. Nothing was
    // decided about this person, so deciding "failed" on their behalf is the
    // one reading that is certainly wrong.
    match: /\b(502|503|504)\b|gateway timeout|service unavailable|socket hang up|etimedout|econnreset/,
    cooldownMs: 15 * 60_000,
    scope: "account",
    summary: "The provider did not answer",
  },
];

/**
 * Reads a provider error and says whether the prospect gets another go.
 *
 * `undefined` and an empty string are permanent: a failure that said nothing
 * about itself is not evidence that retrying is safe.
 */
export function classifyProviderError(error: string | null | undefined): ProviderErrorKind {
  if (!error) return { kind: "permanent" };
  const text = error.toLowerCase();
  for (const rule of RETRYABLE) {
    if (rule.match.test(text)) {
      return {
        kind: "retry_later",
        cooldownMs: rule.cooldownMs,
        scope: rule.scope,
        summary: rule.summary,
      };
    }
  }
  return { kind: "permanent" };
}

/**
 * What the rep is told while an account is held back.
 *
 * "7 failed" reads as seven bad prospects and a list that did not work. It was
 * neither: the people are real, the campaign is fine, and LinkedIn is asking
 * for time. The sentence has to say that, because the rep's next move depends
 * on which it is.
 */
export function describeCooldown(summary: string, until: Date, waiting: number): string {
  const people = waiting === 1 ? "1 person is" : `${waiting} people are`;
  return `${summary}. ${people} waiting and will be invited automatically after ${until.toISOString()}. Nothing is lost.`;
}
