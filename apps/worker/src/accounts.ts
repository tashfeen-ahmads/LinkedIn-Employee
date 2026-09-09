import type { Db } from "@le/db";
import type { AccountHealth, LinkedInProvider } from "@le/linkedin";
import type { AccountUsage, WorkingHours } from "@le/linkedin";
import { accountPausedEmail } from "@le/email";
import type { EmailProvider } from "@le/email";
import { recordEvent } from "./context.js";
import { trySend } from "./email.js";

export interface AccountRecord {
  id: string;
  workspace_id: string;
  user_id: string;
  provider_account_id: string | null;
  status: string;
  connected_at: string | null;
  invites_today: number;
  invites_this_week: number;
  messages_today: number;
  counters_reset_on: string | null;
  last_action_at: string | null;
  working_hours: unknown;
}

const DEFAULT_HOURS: WorkingHours = { start: 8, end: 18, days: [1, 2, 3, 4, 5] };

/**
 * Every column `toUsage` reads. Selecting less silently produces undefined
 * fields and a limiter that decides on nothing, so the list lives beside the
 * function that needs it rather than being retyped at each call site.
 */
export const ACCOUNT_USAGE_COLUMNS =
  "id, workspace_id, user_id, provider_account_id, status, connected_at, invites_today, invites_this_week, messages_today, counters_reset_on, last_action_at, working_hours";

export function parseWorkingHours(value: unknown): WorkingHours {
  if (value && typeof value === "object") {
    const v = value as Partial<WorkingHours>;
    if (typeof v.start === "number" && typeof v.end === "number" && Array.isArray(v.days)) {
      return { start: v.start, end: v.end, days: v.days };
    }
  }
  return DEFAULT_HOURS;
}

export function toUsage(account: AccountRecord, timezone: string): AccountUsage {
  return {
    connectedAt: account.connected_at ? new Date(account.connected_at) : new Date(),
    invitesToday: account.invites_today,
    invitesThisWeek: account.invites_this_week,
    messagesToday: account.messages_today,
    lastActionAt: account.last_action_at ? new Date(account.last_action_at) : null,
    workingHours: parseWorkingHours(account.working_hours),
    timezone,
  };
}

/**
 * Increment the counters that the rate limiter reads. Done after a successful
 * action so a provider failure does not consume a rep's daily allowance.
 *
 * One statement in the database rather than a read and a write here. Two
 * actions in flight both read the same number and both write it back plus one,
 * so a send goes uncounted and the account passes its cap — the one thing these
 * counters exist to prevent. Doing it in SQL also removes the standing rule
 * that the worker may never run as more than one instance.
 */
export async function recordAction(db: Db, accountId: string, kind: "invite" | "message"): Promise<void> {
  const { error } = await db.rpc("record_linkedin_action", { p_account_id: accountId, p_kind: kind });
  // Loudly: an uncounted action is an account creeping past its daily cap, and
  // the next check would happily allow another.
  if (error) throw new Error(`could not record ${kind} against account ${accountId}: ${error.message}`);
}

/**
 * Any non-ok health signal pauses the account immediately. Reps are told; the
 * scheduler stops handing this account work until a human resolves it.
 */
export async function applyHealth(
  db: Db,
  account: { id: string; workspace_id: string; status: string },
  health: AccountHealth,
  notify?: { email: EmailProvider | null; appUrl: string },
): Promise<boolean> {
  if (health === "ok") {
    if (account.status === "warning") {
      await db.from("linkedin_accounts").update({ status: "active", status_detail: null }).eq("id", account.id);
    }
    return true;
  }
  if (health === "unknown") return true;

  const status = health === "warning" ? "warning" : health === "restricted" ? "restricted" : "reauth_required";
  await db
    .from("linkedin_accounts")
    .update({ status, status_detail: `provider reported ${health}`, paused_at: new Date().toISOString() })
    .eq("id", account.id);
  await recordEvent(db, {
    workspaceId: account.workspace_id,
    name: health === "reauth_required" ? "linkedin.account.reauth_required" : "linkedin.account.paused",
    subjectType: "linkedin_account",
    subjectId: account.id,
    payload: { health },
  });

  // Tell the rep now. Otherwise they find out days later by noticing that
  // nothing happened.
  if (notify && health !== "warning") {
    const { data: owner } = await db
      .from("linkedin_accounts")
      .select("user_id")
      .eq("id", account.id)
      .maybeSingle();
    if (owner) {
      const { data: profile } = await db
        .from("profiles")
        .select("email")
        .eq("id", owner.user_id)
        .maybeSingle();
      if (profile?.email) {
        await trySend(
          notify.email,
          accountPausedEmail({
            to: profile.email,
            appUrl: notify.appUrl,
            status,
            detail: `The provider reported the account as ${health}.`,
          }),
        );
      }
    }
  }
  // A warning still lets the current action finish; anything worse stops it.
  return health === "warning";
}

/**
 * Resets the daily counters on a new day, and the weekly ones when the last
 * reset fell in an earlier week.
 *
 * Comparing week numbers rather than checking for Monday matters: an account
 * idle over a weekend would never see a Monday reset and would stay capped for
 * a full extra week.
 */
export async function resetCountersIfNeeded(db: Db, account: AccountRecord, today: string): Promise<AccountRecord> {
  if (account.counters_reset_on === today) return account;

  const newWeek =
    !account.counters_reset_on || isoWeekStart(account.counters_reset_on) !== isoWeekStart(today);

  const update = {
    invites_today: 0,
    messages_today: 0,
    counters_reset_on: today,
    ...(newWeek ? { invites_this_week: 0 } : {}),
  };
  await db.from("linkedin_accounts").update(update).eq("id", account.id);
  return { ...account, ...update };
}

/** The Monday of the week a YYYY-MM-DD date falls in, as YYYY-MM-DD. */
export function isoWeekStart(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  // getUTCDay: 0 = Sunday, so Sunday belongs to the week that began six days ago.
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday);
  return parsed.toISOString().slice(0, 10);
}

export async function pollHealth(
  db: Db,
  provider: LinkedInProvider,
  account: { id: string; workspace_id: string; status: string; provider_account_id: string | null },
  notify?: { email: EmailProvider | null; appUrl: string },
): Promise<void> {
  if (!account.provider_account_id) return;
  const health = await provider.getAccountHealth(account.provider_account_id);
  await applyHealth(db, account, health, notify);
}
