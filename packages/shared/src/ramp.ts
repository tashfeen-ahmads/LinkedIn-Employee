import { LINKEDIN_LIMITS } from "./constants.js";

/**
 * What the caps add up to on a normal working week, said once.
 *
 * The daily cap ramps from 10 to 35 over 35 days, and the limiter really does
 * allow 35 on a single day (two campaigns on one account, or a raised campaign
 * cap). But the weekly cap is 100 across any seven days, and on a five-day week
 * that averages 20 a day, so an account that sends every working day sits near
 * 20 and owners read the ramp as broken. The sentence says both: the ceiling,
 * and what the week averages. Computed from the caps (rule 4), never typed.
 */
export const WORKING_DAYS_PER_WEEK = 5;

/** What a warmed account sends on a working day, under the weekly cap. */
export const SUSTAINED_INVITES_PER_DAY = Math.min(
  LINKEDIN_LIMITS.invitesPerDayMax,
  Math.floor(LINKEDIN_LIMITS.invitesPerWeek / WORKING_DAYS_PER_WEEK),
);

/** The daily cap on day `days` after the first action: the same line as `dailyInviteCap`. */
export function rampCapOnDay(days: number): number {
  const { invitesPerDayStart, invitesPerDayMax, warmupDays } = LINKEDIN_LIMITS;
  if (days >= warmupDays) return invitesPerDayMax;
  if (days <= 0) return invitesPerDayStart;
  return Math.floor(invitesPerDayStart + ((invitesPerDayMax - invitesPerDayStart) / warmupDays) * days);
}

/** Days from the first send until the ramp reaches the sustained pace. */
export const DAYS_TO_SUSTAINED = (() => {
  for (let d = 0; d <= LINKEDIN_LIMITS.warmupDays; d += 1) if (rampCapOnDay(d) >= SUSTAINED_INVITES_PER_DAY) return d;
  return LINKEDIN_LIMITS.warmupDays;
})();

export const WEEKS_TO_SUSTAINED = Math.max(1, Math.round(DAYS_TO_SUSTAINED / 7));

/** Whole weeks until the daily cap reaches its ceiling. */
export const WEEKS_TO_CEILING = Math.round(LINKEDIN_LIMITS.warmupDays / 7);

/** The one sentence every screen uses for the pace. */
export const RAMP_SENTENCE = `${LINKEDIN_LIMITS.invitesPerDayStart} invitations a day at first, rising to ${LINKEDIN_LIMITS.invitesPerDayMax} over ${WEEKS_TO_CEILING} weeks, and never more than ${LINKEDIN_LIMITS.invitesPerWeek} a week, about ${SUSTAINED_INVITES_PER_DAY} a working day`;
