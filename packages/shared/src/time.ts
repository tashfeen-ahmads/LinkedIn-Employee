export interface WorkingHours {
  start: number;
  end: number;
  /** 0 = Sunday. */
  days: number[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface ZonedParts {
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

/**
 * What time it is somewhere, for a rep's own working hours.
 *
 * The rate limiter and the slot finder each grew their own copy of this, which
 * means a timezone edge case has to be found and fixed twice. One
 * implementation, one place to be wrong.
 */
export function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekday = WEEKDAYS.indexOf(weekdayName as (typeof WEEKDAYS)[number]);

  return {
    // Intl renders midnight as 24 in some locales under hour12: false.
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

/**
 * Whether an instant falls inside working hours in the given zone.
 *
 * Minutes count: a slot that starts at 16:45 is inside a day ending at 17:00,
 * and one that starts at 17:15 is not.
 */
export function isWithinWorkingHours(date: Date, hours: WorkingHours, timezone: string): boolean {
  const { hour, minute, weekday } = zonedParts(date, timezone);
  if (!hours.days.includes(weekday)) return false;
  const minutesIntoDay = hour * 60 + minute;
  return minutesIntoDay >= hours.start * 60 && minutesIntoDay <= hours.end * 60;
}

/** Milliseconds until midnight in the given zone. */
export function msUntilNextLocalMidnight(now: Date, timezone: string): number {
  const { hour, minute, second } = zonedParts(now, timezone);
  return 86_400_000 - (hour * 3_600_000 + minute * 60_000 + second * 1000);
}

/**
 * How much of today's working window is still ahead, in the given zone.
 *
 * Exists so a day's allowance can be *spread* rather than merely capped. The
 * ramp says how many invitations an account may send today and nothing said
 * when — so the pacing loop placed the whole day's worth two to nine minutes
 * apart and a brand-new account's first ten connection requests went out
 * inside an hour and a quarter, at five in the afternoon. LinkedIn throttled
 * it and kept throttling it for five days. A daily ceiling with no pacing
 * underneath it is a burst with a maximum size.
 *
 * Zero outside the window, and zero on a non-working day, because there is no
 * room to spread into. Callers fall back to the ordinary gap there rather than
 * dividing by nothing.
 */
export function workingMsLeftToday(now: Date, hours: WorkingHours, timezone: string): number {
  const { hour, minute, second, weekday } = zonedParts(now, timezone);
  if (!hours.days.includes(weekday)) return 0;
  const intoDay = hour * 3_600_000 + minute * 60_000 + second * 1000;
  const end = hours.end * 3_600_000;
  if (intoDay >= end) return 0;
  // Before the window opens, the whole of it is ahead; inside it, what is left.
  return end - Math.max(intoDay, hours.start * 3_600_000);
}
