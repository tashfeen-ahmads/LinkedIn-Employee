import { LINKEDIN_LIMITS } from "@le/shared";

export interface WorkingHours {
  start: number;
  end: number;
  /** 0 = Sunday. */
  days: number[];
}

export interface AccountUsage {
  connectedAt: Date;
  invitesToday: number;
  invitesThisWeek: number;
  messagesToday: number;
  lastActionAt: Date | null;
  workingHours: WorkingHours;
  /** IANA zone used to evaluate workingHours. */
  timezone: string;
}

export type ActionKind = "invite" | "message";

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: DenyReason; retryAfterMs: number };

export type DenyReason =
  | "daily_invite_cap"
  | "weekly_invite_cap"
  | "daily_message_cap"
  | "outside_working_hours"
  | "too_soon";

/**
 * Daily invite allowance for an account, ramping linearly from
 * invitesPerDayStart on the connection day to invitesPerDayMax after warmupDays.
 * A brand-new account that blasts its full allowance on day one is the single
 * biggest cause of restrictions, so the ramp is not optional.
 */
export function dailyInviteCap(connectedAt: Date, now: Date = new Date()): number {
  const { invitesPerDayStart, invitesPerDayMax, warmupDays } = LINKEDIN_LIMITS;
  const days = Math.floor((now.getTime() - connectedAt.getTime()) / 86_400_000);
  if (days >= warmupDays) return invitesPerDayMax;
  if (days <= 0) return invitesPerDayStart;
  const step = (invitesPerDayMax - invitesPerDayStart) / warmupDays;
  return Math.floor(invitesPerDayStart + step * days);
}

/** Hour and weekday of `now` in the given IANA time zone. */
export function zonedParts(now: Date, timezone: string): { hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
  return { hour: hour % 24, weekday: weekday < 0 ? 0 : weekday };
}

export function isWithinWorkingHours(now: Date, hours: WorkingHours, timezone: string): boolean {
  const { hour, weekday } = zonedParts(now, timezone);
  if (!hours.days.includes(weekday)) return false;
  return hour >= hours.start && hour < hours.end;
}

/** Milliseconds until the next working-hours window opens. */
export function msUntilWorkingHours(now: Date, hours: WorkingHours, timezone: string): number {
  const step = 15 * 60_000;
  for (let ms = step; ms <= 8 * 86_400_000; ms += step) {
    if (isWithinWorkingHours(new Date(now.getTime() + ms), hours, timezone)) return ms;
  }
  return 86_400_000;
}

/** Randomized gap between two actions, so cadence never looks mechanical. */
export function nextGapMs(random: () => number = Math.random): number {
  const { minGapMs, maxGapMs } = LINKEDIN_LIMITS;
  return Math.round(minGapMs + random() * (maxGapMs - minGapMs));
}

/**
 * The single gate every LinkedIn action passes through. Denies rather than
 * queues: the caller reschedules using retryAfterMs.
 */
export function checkAction(kind: ActionKind, usage: AccountUsage, now: Date = new Date()): Decision {
  if (!isWithinWorkingHours(now, usage.workingHours, usage.timezone)) {
    return {
      allowed: false,
      reason: "outside_working_hours",
      retryAfterMs: msUntilWorkingHours(now, usage.workingHours, usage.timezone),
    };
  }

  if (usage.lastActionAt) {
    const elapsed = now.getTime() - usage.lastActionAt.getTime();
    if (elapsed < LINKEDIN_LIMITS.minGapMs) {
      return { allowed: false, reason: "too_soon", retryAfterMs: LINKEDIN_LIMITS.minGapMs - elapsed };
    }
  }

  const untilTomorrow = msUntilNextLocalMidnight(now, usage.timezone);

  if (kind === "invite") {
    if (usage.invitesThisWeek >= LINKEDIN_LIMITS.invitesPerWeek) {
      return { allowed: false, reason: "weekly_invite_cap", retryAfterMs: untilTomorrow };
    }
    if (usage.invitesToday >= dailyInviteCap(usage.connectedAt, now)) {
      return { allowed: false, reason: "daily_invite_cap", retryAfterMs: untilTomorrow };
    }
    return { allowed: true };
  }

  if (usage.messagesToday >= LINKEDIN_LIMITS.messagesPerDay) {
    return { allowed: false, reason: "daily_message_cap", retryAfterMs: untilTomorrow };
  }
  return { allowed: true };
}

export function msUntilNextLocalMidnight(now: Date, timezone: string): number {
  const { hour } = zonedParts(now, timezone);
  const hoursLeft = 24 - hour;
  return hoursLeft * 3_600_000 - (now.getTime() % 3_600_000);
}
