import { LINKEDIN_LIMITS } from "./constants.js";

/**
 * What the caps add up to on a normal working week, said once.
 *
 * The daily cap ramps from 10 to 35 over 35 days, and every screen said so. But
 * the weekly cap is 100 across any seven days, and on a five-day week that is
 * 20 a day: from the day the ramp reaches 20, the week decides and the daily
 * number is a ceiling nobody can reach. Owners watched an account sit at 20
 * and read the ramp as broken. These numbers are computed from the caps
 * (rule 4), never typed, so they change if a cap ever does.
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

/** The one sentence every screen uses for the pace. */
export const RAMP_SENTENCE = `${LINKEDIN_LIMITS.invitesPerDayStart} invitations a day at first, growing to ${SUSTAINED_INVITES_PER_DAY} a day over ${WEEKS_TO_SUSTAINED} weeks, never more than ${LINKEDIN_LIMITS.invitesPerWeek} a week`;
