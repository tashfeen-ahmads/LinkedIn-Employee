import type { Db } from "@le/db";
import type { AccountHealth, LinkedInProvider } from "@le/linkedin";
import type { AccountUsage, WorkingHours } from "@le/linkedin";
import { recordEvent } from "./context.js";

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
 */
export async function recordAction(db: Db, accountId: string, kind: "invite" | "message"): Promise<void> {
  const { data } = await db
    .from("linkedin_accounts")
    .select("invites_today, invites_this_week, messages_today")
    .eq("id", accountId)
    .single();
  if (!data) return;

  await db
    .from("linkedin_accounts")
    .update({
      invites_today: kind === "invite" ? data.invites_today + 1 : data.invites_today,
      invites_this_week: kind === "invite" ? data.invites_this_week + 1 : data.invites_this_week,
      messages_today: kind === "message" ? data.messages_today + 1 : data.messages_today,
      last_action_at: new Date().toISOString(),
    })
    .eq("id", accountId);
}

/**
 * Any non-ok health signal pauses the account immediately. Reps are told; the
 * scheduler stops handing this account work until a human resolves it.
 */
export async function applyHealth(
  db: Db,
  account: { id: string; workspace_id: string; status: string },
  health: AccountHealth,
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
  // A warning still lets the current action finish; anything worse stops it.
  return health === "warning";
}

/** Reset daily counters at the rep's local midnight, weekly ones on Monday. */
export async function resetCountersIfNeeded(db: Db, account: AccountRecord, today: string): Promise<AccountRecord> {
  if (account.counters_reset_on === today) return account;
  const isMonday = new Date(`${today}T00:00:00Z`).getUTCDay() === 1;
  const update = {
    invites_today: 0,
    messages_today: 0,
    counters_reset_on: today,
    ...(isMonday ? { invites_this_week: 0 } : {}),
  };
  await db.from("linkedin_accounts").update(update).eq("id", account.id);
  return { ...account, ...update };
}

export async function pollHealth(
  db: Db,
  provider: LinkedInProvider,
  account: { id: string; workspace_id: string; status: string; provider_account_id: string | null },
): Promise<void> {
  if (!account.provider_account_id) return;
  const health = await provider.getAccountHealth(account.provider_account_id);
  await applyHealth(db, account, health);
}
