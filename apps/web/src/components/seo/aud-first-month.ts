import { DEFAULT_WORKING_HOURS, LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";

/**
 * The numbers the /for/* pages quote for a new account's first month, computed
 * from the sender's own `dailyInviteCap` rather than retyped, so a page can
 * never promise a ramp the sender does not run.
 *
 * Server-only: @le/linkedin cannot be bundled for the browser.
 *
 * A first send on a Monday (5 January 2026) lines the weeks up; only the
 * distance from the first send matters to the cap. Each week is the sum of the
 * daily caps on the default working days, clamped by the weekly ceiling.
 */
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const FIRST_SEND = new Date("2026-01-05T09:00:00Z");
const WORKING_OFFSETS = DEFAULT_WORKING_HOURS.days.map((weekday) => (weekday + 6) % 7);

/** The most a new account can send in each of its first four weeks. */
export const FIRST_MONTH_WEEKS: readonly number[] = Array.from({ length: 4 }, (_, week) => {
  const caps = WORKING_OFFSETS.map((offset) =>
    dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + (week * 7 + offset) * DAY_MS)),
  );
  return Math.min(
    caps.reduce((a, b) => a + b, 0),
    LINKEDIN_LIMITS.invitesPerWeek,
  );
});

export const FIRST_MONTH_TOTAL = FIRST_MONTH_WEEKS.reduce((a, b) => a + b, 0);

/** The daily cap on the first working day of week four (day 21 from the first send). */
export const WEEK_FOUR_DAILY = dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + 21 * DAY_MS));

/** The window the first message after an acceptance lands in, in minutes. */
export const FOLLOW_UP_MINUTES = {
  min: Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / MINUTE_MS),
  max: Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / MINUTE_MS),
} as const;
