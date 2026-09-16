import type { Db } from "@le/db";
import type { AccountHealth, ConnectedAccount, LinkedInProvider } from "@le/linkedin";
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
  /** Day zero of the warm-up ramp; null until the account has sent anything. */
  first_action_at: string | null;
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
  "id, workspace_id, user_id, provider_account_id, status, connected_at, first_action_at, invites_today, invites_this_week, messages_today, counters_reset_on, last_action_at, working_hours";

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
    firstActionAt: account.first_action_at ? new Date(account.first_action_at) : null,
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
    // Any paused state, not only `warning`. A LinkedIn restriction is usually
    // temporary and this poll is the only thing that watches for it lifting —
    // restoring nothing but warnings left a recovered account paused for good,
    // with no path back except disconnecting and starting again.
    if (account.status !== "active" && account.status !== "connecting") {
      await db
        .from("linkedin_accounts")
        .update({ status: "active", status_detail: null, paused_at: null })
        .eq("id", account.id);
      await recordEvent(db, {
        workspaceId: account.workspace_id,
        name: "linkedin.account.recovered",
        subjectType: "linkedin_account",
        subjectId: account.id,
        payload: { from: account.status },
      });
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
 * The provider does not have this account, so stop saying it is connected.
 *
 * Health is polled nightly, which is the right cadence for "LinkedIn has
 * restricted this account" and far too slow for this: a job that has just been
 * told the account does not exist knows it now, and every job until the small
 * hours would otherwise fail exactly the same way while the Team page shows a
 * healthy connection. Telling the rep to reconnect on a screen that says
 * `active` is a contradiction they cannot act on.
 */
export async function markAccountGone(
  db: Db,
  account: { id: string; workspace_id: string },
): Promise<void> {
  await db
    .from("linkedin_accounts")
    .update({
      status: "reauth_required",
      status_detail:
        "LinkedIn's provider no longer has this account. Reconnect it to start sending again.",
      paused_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  await recordEvent(db, {
    workspaceId: account.workspace_id,
    name: "linkedin.account.reauth_required",
    subjectType: "linkedin_account",
    subjectId: account.id,
    payload: { health: "reauth_required", reason: "provider no longer has the account" },
  });
}

/**
 * Makes the row agree with what the provider actually has.
 *
 * `bindAccounts` deliberately only touches a row that is waiting to be
 * connected, so a replayed or forged delivery cannot re-point a working
 * account at something else. That left no way back from the opposite problem:
 * a row that says `active`, holding an id the provider no longer has. Every
 * job then fails against it — "LinkedIn's provider refused the search", over
 * and over — while the Team page shows a healthy account, usage bars and no
 * button that does anything. That is exactly what happened here, and the only
 * fix was editing the database by hand.
 *
 * Safe to do on the pull path and not on the push path, which is the whole
 * distinction: this runs on a list we fetched from the provider ourselves,
 * over an authenticated call the rep started, rather than on something we were
 * sent. The binding rule is untouched — `mine` has already been filtered to
 * accounts carrying this rep's own user id as their reference, and nothing
 * here looks at any other row.
 */
export async function reconcileAccount(
  db: Db,
  workspaceId: string,
  userId: string,
  mine: ConnectedAccount[],
): Promise<{ changed?: boolean; lost?: boolean }> {
  const { data: row } = await db
    .from("linkedin_accounts")
    .select("id, provider_account_id, status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return {};

  if (mine.length === 0) {
    // Nothing to reconcile against unless we are claiming to hold something.
    if (!row.provider_account_id) return {};
    await db
      .from("linkedin_accounts")
      .update({
        status: "reauth_required",
        status_detail:
          "LinkedIn's provider no longer has this account. Reconnect it to start sending again.",
      })
      .eq("id", row.id);
    return { lost: true };
  }

  // Prefer the one already held: several accounts for one rep is a mess to be
  // reported rather than silently resolved by picking differently each time.
  const account = mine.find((a) => a.providerAccountId === row.provider_account_id) ?? mine[0];
  if (!account) return {};
  const changed = account.providerAccountId !== row.provider_account_id;
  if (!changed && row.status === "active") return { changed: false };

  await db
    .from("linkedin_accounts")
    .update({
      provider_account_id: account.providerAccountId,
      display_name: account.displayName ?? null,
      status: account.status === "ok" ? "active" : "reauth_required",
      status_detail: null,
      // Stamped only when the account itself changed. The warm-up ramp reads
      // `first_action_at`, not this, so a refresh cannot hand an account a
      // fresh allowance — but a connection date that moves every time someone
      // presses a button is a lie on the screen either way.
      ...(changed ? { connected_at: new Date().toISOString(), paused_at: null } : {}),
    })
    .eq("id", row.id);
  return { changed };
}

/**
 * Asks the provider about every account that is not working, and repairs the
 * ones it can.
 *
 * `reconcileAccount` was only ever reached by a rep pressing a button, which
 * made the common failure permanent for anyone who did not find it. A rep
 * reconnects, the provider issues a *new* account with a new id, and our row
 * still holds the old one — so their provider dashboard shows a healthy
 * connection while this product shows "reauth required" and every job fails.
 * The two screens disagree and the one that is right is the one we are not
 * looking at.
 *
 * The nightly health poll made this worse rather than better: it asks about
 * the id we hold, gets a 404 because that account is gone, and marks the row
 * dead. It never asks the only question that would have fixed it — does the
 * provider have an account for this rep at all?
 *
 * One list for the whole deployment, then each unhealthy row reconciled
 * against it. The binding rule is untouched: `reconcileAccount` is handed only
 * the accounts carrying that rep's own user id as their reference.
 */
export async function recoverAccounts(
  db: Db,
  provider: LinkedInProvider,
): Promise<{ checked: number; repaired: number }> {
  const { data: rows } = await db
    .from("linkedin_accounts")
    .select("id, workspace_id, user_id, status, provider_account_id")
    .in("status", ["connecting", "reauth_required", "restricted", "warning", "disconnected"]);

  if (!rows?.length) return { checked: 0, repaired: 0 };

  let accounts: ConnectedAccount[];
  try {
    accounts = await provider.listAccounts();
  } catch (err) {
    // Asked and could not be answered is not the same as "the provider has
    // nothing", and treating it as the latter would mark every account in the
    // deployment dead over one bad minute.
    console.error("could not list provider accounts for recovery", err);
    return { checked: rows.length, repaired: 0 };
  }

  let repaired = 0;
  for (const row of rows) {
    const mine = accounts.filter((a) => a.reference === row.user_id);
    // Nothing for this rep: leave the row exactly as it is. The reason it is
    // already unhealthy is the reason it should stay that way, and overwriting
    // a specific status_detail with a generic one loses the only explanation
    // anybody has.
    if (mine.length === 0) continue;

    const result = await reconcileAccount(db, row.workspace_id, row.user_id, mine);
    if (result.changed) {
      repaired++;
      await recordEvent(db, {
        workspaceId: row.workspace_id,
        name: "linkedin.account.recovered",
        subjectType: "linkedin_account",
        subjectId: row.id,
        payload: { from: row.status, reason: "the provider had a different account for this rep" },
      });
    }
  }
  return { checked: rows.length, repaired };
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
