import { localDate, rollCounters, type AccountRecord } from "@le/linkedin";

/**
 * An account row's counters as the worker will read them today.
 *
 * The daily counters are only zeroed by the worker, and only on its first
 * action of the rep's new day (`resetCountersIfNeeded`). Until then the row
 * still holds yesterday's numbers, stamped with yesterday's date. Every screen
 * that read the row as it stood therefore spent each morning reporting
 * yesterday's sends as today's: "Invitations today 10 of 10" in amber on the
 * overview, and "Today's invitation allowance is used up" on the campaign page,
 * about an account the worker was about to send from at full allowance.
 *
 * So the screen applies the same rollover the worker applies, from the same
 * stamp and the same local date. Only forwards, exactly as the worker: a stamp
 * later than the rep's today is left counting into that later day.
 */
export function countersForToday<T extends AccountRecord>(account: T, timezone: string, now: Date = new Date()): T {
  // The worker's own rollover (`rollCounters`), not a copy of it: the week is
  // LinkedIn's rolling seven days, and a screen that zeroed it on Monday would
  // promise invitations the send path then refuses.
  return rollCounters(account, localDate(now, timezone));
}
