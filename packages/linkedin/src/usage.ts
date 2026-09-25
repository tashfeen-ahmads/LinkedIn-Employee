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
}

/**
 * Every column `toUsage` reads. Selecting less silently produces undefined
 * fields and a limiter that decides on nothing, so the list lives beside the
 * function that needs it rather than being retyped at each call site.
 */
export const ACCOUNT_USAGE_COLUMNS =
  "id, workspace_id, user_id, provider_account_id, status, connected_at, first_action_at, invites_today, invites_this_week, messages_today, counters_reset_on, last_action_at, working_hours, invites_paused_until, invites_paused_reason, invite_throttle_streak";

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
    invitesThisWeek: account.invites_this_week,
    messagesToday: account.messages_today,
    lastActionAt: account.last_action_at ? new Date(account.last_action_at) : null,
    workingHours: parseWorkingHours(account.working_hours),
    timezone,
  };
}
