import { DEFAULT_WORKING_HOURS } from "@le/shared";
import type { AccountUsage, WorkingHours } from "./rate-limit.js";

/**
 * A `linkedin_accounts` row, as far as the limiter is concerned.
 *
 * Here rather than in the worker because the worker is no longer the only thing
 * that asks the limiter a question. A screen that says "sending is paused until
 * Monday" has to reach the same answer the loop reaches, from the same row and
 * the same function — two readings of the same rule drift, and the one on the
 * screen is the one somebody believes.
 */
export interface AccountRecord {
  id: string;
  workspace_id: string;
  user_id: string;
  provider_account_id: string | null;
  status: string;
  connected_at: string | null;
  /** Day zero of the warm-up ramp; null until the account has sent anything. */
  first_action_at: string | null;
  invites_today: number;
  invites_this_week: number;
  messages_today: number;
  /** Profile views spent today, reset with the other daily counters. */
  profile_views_today?: number | null;
  counters_reset_on: string | null;
  last_action_at: string | null;
  working_hours: unknown;
  /**
   * While this is in the future the account sends no invitations at all.
   *
   * Not the limiter's business — the limiter is the pace *we* chose, and this
   * is LinkedIn refusing outright with "please try again later". Kept on the
   * account rather than the campaign because that is what the platform is
   * forming an opinion about: a second campaign on the same account must not
   * walk into the same wall.
   */
  invites_paused_until?: string | null;
  invites_paused_reason?: string | null;
  /** Consecutive account-wide refusals since the last accepted invitation. */
  invite_throttle_streak?: number | null;
  /**
   * Invitations by the rep's own date, for the last eight days (migration
   * 0042). The weekly ceiling is read from this, not from the calendar week.
   * Absent on a row selected without it, which falls back to the total.
   */
  invites_by_day?: unknown;
  /** The plan, for the monthly note allowance (`noteAllowance`, migration 0045). */
  has_sales_navigator?: boolean | null;
  has_premium?: boolean | null;
  /** The rep's local month in which LinkedIn refused a note. */
  notes_exhausted_month?: string | null;
}

/**
 * Every column `toUsage` reads. Selecting less silently produces undefined
 * fields and a limiter that decides on nothing, so the list lives beside the
 * function that needs it rather than being retyped at each call site.
 */
export const ACCOUNT_USAGE_COLUMNS =
  "id, workspace_id, user_id, provider_account_id, status, connected_at, first_action_at, invites_today, invites_this_week, messages_today, counters_reset_on, last_action_at, working_hours, profile_views_today, invites_paused_until, invites_paused_reason, invite_throttle_streak, invites_by_day, has_sales_navigator, has_premium, notes_exhausted_month";

export function parseWorkingHours(value: unknown): WorkingHours {
  if (value && typeof value === "object") {
    const v = value as Partial<WorkingHours>;
    if (typeof v.start === "number" && typeof v.end === "number" && Array.isArray(v.days)) {
      return { start: v.start, end: v.end, days: v.days };
    }
  }
  return { ...DEFAULT_WORKING_HOURS, days: [...DEFAULT_WORKING_HOURS.days] };
}

export function toUsage(account: AccountRecord, timezone: string): AccountUsage {
  return {
    connectedAt: account.connected_at ? new Date(account.connected_at) : new Date(),
    firstActionAt: account.first_action_at ? new Date(account.first_action_at) : null,
    invitesToday: account.invites_today,
    // The rolling week, never the calendar's: see `invitesInLastWeek`.
    invitesThisWeek: invitesInLastWeek(account, account.counters_reset_on),
    messagesToday: account.messages_today,
    // Null until the column has been written once, which is every account on
    // the deployment the day this ships. Reading that as "unknown, so refuse"
    // would stop every warm-up; reading it as zero is the truth — nobody had
    // spent a view before there was a counter for it.
    profileViewsToday: account.profile_views_today ?? 0,
    lastActionAt: account.last_action_at ? new Date(account.last_action_at) : null,
    workingHours: parseWorkingHours(account.working_hours),
    timezone,
  };
}

/**
 * How many days LinkedIn's weekly invitation limit looks back.
 *
 * docs/06-research.md section 2 records the limit as a rolling seven days. The
 * counter used to be zeroed on the calendar Monday instead, so a campaign
 * launched on a Wednesday sent a hundred Wednesday to Friday and another
 * hundred Monday to Wednesday — a hundred and seventy inside seven consecutive
 * days, from an account the screen said was well within its week. A rolling
 * window is never looser than a calendar week and usually stricter, which is
 * the direction rule 4 allows a cap to move.
 */
export const INVITE_WEEK_DAYS = 7;

/** A YYYY-MM-DD date moved by whole days, in the same YYYY-MM-DD shape. */
export function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** The per-day record as numbers by date, or null when the row does not carry one. */
export function invitesByDay(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [day, count] of Object.entries(value as Record<string, unknown>)) {
    const n = typeof count === "number" ? count : Number(count);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(n) && n > 0) out[day] = n;
  }
  return out;
}

/**
 * Invitations in the seven days ending on `today` (the rep's own date), as the
 * weekly ceiling counts them. The one definition: the pacing loop, the send
 * path and every screen read the week through this.
 *
 * From the per-day record when the row has one, which is written in the same
 * SQL statement as every other counter (rule 2). The stored total is kept as a
 * floor: the worker rewrites it when the day rolls over, and a send counted in
 * the moment between that read and that write is in the per-day record and in
 * the total but not in both readings of it — taking the larger is the reading
 * that never lets the account past its week.
 *
 * Without a per-day record (a row selected without the column) the total is
 * all there is. Everything in it was sent on or before `counters_reset_on`, so
 * once that date is a full week behind `today` none of it is inside the
 * window any more.
 */
export function invitesInLastWeek(
  account: Pick<AccountRecord, "invites_this_week" | "counters_reset_on" | "invites_by_day">,
  today: string | null,
): number {
  const total = Number.isFinite(account.invites_this_week) ? account.invites_this_week : 0;
  const stamp = account.counters_reset_on;
  const byDay = invitesByDay(account.invites_by_day);
  if (!today) return total;
  const from = shiftDate(today, -(INVITE_WEEK_DAYS - 1));
  if (byDay) {
    let sum = 0;
    for (const [day, n] of Object.entries(byDay)) if (day >= from && day <= today) sum += n;
    // The total only describes the stamped day's window; read against a later
    // day it would carry invitations that have already left the week.
    return stamp === today ? Math.max(sum, total) : sum;
  }
  if (stamp && stamp < from) return 0;
  return total;
}

/**
 * An account row's counters rolled over to the rep's `today`: the daily ones
 * to zero and the week to what is still inside it.
 *
 * Pure and shared, because two things apply it and they must agree. The worker
 * writes the result back before it asks the limiter anything; every screen
 * applies it on read, so a row the worker has not touched since yesterday is
 * reported as the worker is about to see it. Only forwards: a stamp later than
 * `today` is left counting into that later day. Returns the row unchanged when
 * there is nothing to roll.
 */
export function rollCounters<T extends AccountRecord>(account: T, today: string): T {
  const stamp = account.counters_reset_on;
  if (stamp === today) return account;
  if (stamp && stamp > today) return account;
  return {
    ...account,
    invites_today: 0,
    messages_today: 0,
    // Reset with the rest of them. Left out, the warm-up allowance is spent
    // once and never refilled.
    profile_views_today: 0,
    counters_reset_on: today,
    invites_this_week: invitesInLastWeek(account, today),
  };
}
