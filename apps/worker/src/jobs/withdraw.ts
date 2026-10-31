import { LINKEDIN_LIMITS, isWithinWorkingHours } from "@le/shared";
import { classifyProviderError, localDayStart, parseWorkingHours, type PendingInvitation } from "@le/linkedin";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { outreachPause } from "../platform.js";

/**
 * Keep every account's pile of unanswered invitations small, every working day.
 *
 * LinkedIn stops taking new invitations from an account carrying a large
 * backlog, and it counts every invitation the rep ever sent. On 30 October
 * four of the five sending accounts were refused all day under piles of 150
 * to 258. Nothing had ever been withdrawn on any account, for three reasons
 * this file exists to make impossible again:
 *
 *  - The withdrawal went to the wrong address (`/users/invite/{id}` rather
 *    than `/users/invite/sent/{id}`), every call was refused, and a refused
 *    withdrawal was skipped without a word.
 *  - It ran at three in the morning across the whole deployment, fifty in all,
 *    so one account's pile spent everybody's night.
 *  - It trusted our own rows. A row says `invited` until the hourly poll sees
 *    the acceptance, so the sweep could pull back an invitation somebody had
 *    just accepted, and close a person who said yes.
 *
 * So, for each active account, hourly and only inside its owner's working
 * hours (a withdrawal at 3am is a robot's hour):
 *
 *  1. LinkedIn's own list of what is still pending is read first, and is the
 *     only thing ever withdrawn from. An account whose list cannot be read is
 *     left alone: acting blind is how a yes gets withdrawn.
 *  2. Nora's own invitations go once `withdrawAfterDays` (14) old, matched to
 *     the list by invitation id or by the person. One not on the list has been
 *     answered and is left for the acceptance poll.
 *  3. With `withdraw_old_invites` on, the rep's other invitations go once
 *     LinkedIn says they are `withdrawOutsideAfterDays` (21) old. Never one
 *     whose age is unknown.
 *  4. Oldest first, at most `withdrawPerAccountPerHour` a run and
 *     `withdrawPerAccountPerDay` a day, counted from the account's own record
 *     so a restart never resets it.
 *  5. A refusal that says LinkedIn is pushing back stops the account for the
 *     rest of its day. Every refusal is recorded in LinkedIn's words, never
 *     skipped silently.
 *
 * The operator's pause stops this too (rule 59): it is an action on somebody's
 * LinkedIn, and a pause that cannot be read counts as on.
 */
export interface WithdrawTally {
  withdrawn: number;
  outside: number;
  failed: number;
}

export const WITHDRAWN_EVENT = "linkedin.invitations_withdrawn";
export const WITHDRAW_REFUSED_EVENT = "linkedin.withdraw_refused";

type Account = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  provider_account_id: string | null;
  working_hours: unknown;
};

export async function withdrawStaleInvites(ctx: WorkerContext, now: Date = new Date()): Promise<WithdrawTally> {
  const tally: WithdrawTally = { withdrawn: 0, outside: 0, failed: 0 };
  if (await outreachPause(ctx.db)) return tally;

  const { data: accounts, error } = await ctx.db
    .from("linkedin_accounts")
    .select("id, workspace_id, user_id, provider_account_id, working_hours")
    .eq("status", "active");
  if (error) throw new Error(`could not read accounts: ${error.message}`);

  // Read separately so a database without migration 0063 still withdraws
  // Nora's own; an unreadable switch is off.
  const { data: switches } = await ctx.db.from("workspaces").select("id, withdraw_old_invites");
  const cleanup = new Set((switches ?? []).filter((w) => w.withdraw_old_invites === true).map((w) => w.id));

  for (const account of (accounts ?? []) as Account[]) {
    if (!account.provider_account_id) continue;
    // One account's failure never costs another its turn.
    const result = await withdrawForAccount(ctx, account, cleanup.has(account.workspace_id), now).catch((err) => {
      console.error("invitation withdrawal failed", { accountId: account.id, err });
      return null;
    });
    if (!result) continue;
    tally.withdrawn += result.withdrawn;
    tally.outside += result.outside;
    tally.failed += result.failed;
  }
  return tally;
}

async function withdrawForAccount(
  ctx: WorkerContext,
  account: Account,
  cleanupOn: boolean,
  now: Date,
): Promise<WithdrawTally> {
  const none = { withdrawn: 0, outside: 0, failed: 0 };
  const { data: owner } = account.user_id
    ? await ctx.db.from("profiles").select("timezone").eq("id", account.user_id).maybeSingle()
    : { data: null };
  const timezone = validZone(owner?.timezone);
  if (!isWithinWorkingHours(now, parseWorkingHours(account.working_hours), timezone)) return none;

  // Today's record, in the owner's own day. Unreadable is not "nothing yet":
  // the day's ceiling is the promise, so the account waits for the next run.
  const dayStart = localDayStart(now, timezone).toISOString();
  const { data: today, error: todayError } = await ctx.db
    .from("events")
    .select("name, payload")
    .eq("subject_id", account.id)
    .in("name", [WITHDRAWN_EVENT, WITHDRAW_REFUSED_EVENT])
    .gte("created_at", dayStart);
  if (todayError) return none;
  if ((today ?? []).some((e) => e.name === WITHDRAW_REFUSED_EVENT && (e.payload as { stop?: boolean } | null)?.stop)) {
    return none;
  }
  const doneToday = (today ?? [])
    .filter((e) => e.name === WITHDRAWN_EVENT)
    .reduce((sum, e) => sum + Number((e.payload as { withdrawn?: number } | null)?.withdrawn ?? 0), 0);
  const budget = Math.min(LINKEDIN_LIMITS.withdrawPerAccountPerHour, LINKEDIN_LIMITS.withdrawPerAccountPerDay - doneToday);
  if (budget <= 0) return none;

  // LinkedIn's own answer to "what is still pending". Never acted on blind.
  const { invitations, truncated } = await ctx.linkedin.listPendingInvitations({
    accountId: account.provider_account_id!,
    limit: 500,
  });

  const picks = await chooseWithdrawals(ctx, account, invitations, truncated, cleanupOn, now);
  const tally = { withdrawn: 0, outside: 0, failed: 0 };
  let stopped = false;
  for (const pick of picks.slice(0, budget)) {
    const result = await ctx.linkedin.withdrawInvitation({
      accountId: account.provider_account_id!,
      invitationId: pick.invitationId,
    });
    if (!result.ok) {
      tally.failed += 1;
      const kind = classifyProviderError(result.error);
      // LinkedIn pushing back on the account: nothing more from it today.
      stopped = Boolean(result.health) || (kind.kind === "retry_later" && kind.scope === "account");
      await recordEvent(ctx.db, {
        workspaceId: account.workspace_id,
        name: WITHDRAW_REFUSED_EVENT,
        subjectType: "linkedin_account",
        subjectId: account.id,
        payload: { stop: stopped, provider: (result.error ?? "").slice(0, 300) },
      }).catch((err) => console.error("could not record a refused withdrawal", err));
      if (stopped) break;
      continue;
    }
    if (pick.rowId) {
      tally.withdrawn += 1;
      await ctx.db
        .from("campaign_prospects")
        .update({ status: "closed", status_reason: "invitation expired", closed_at: now.toISOString() })
        .eq("id", pick.rowId)
        .eq("status", "invited");
    } else {
      tally.outside += 1;
    }
  }

  const total = tally.withdrawn + tally.outside;
  if (total) {
    await recordEvent(ctx.db, {
      workspaceId: account.workspace_id,
      name: WITHDRAWN_EVENT,
      subjectType: "linkedin_account",
      subjectId: account.id,
      payload: { withdrawn: total, own: tally.withdrawn, outside: tally.outside },
    }).catch((err) => console.error("could not record withdrawn invitations", err));
    // The owner's number moves the moment the pile does, not an hour later.
    await ctx.db
      .from("linkedin_accounts")
      .update({ pending_invites: Math.max(0, invitations.length - total), pending_invites_at: now.toISOString() })
      .eq("id", account.id);
  }
  return tally;
}

interface Pick {
  invitationId: string;
  /** Nora's own row for this invitation, closed once it is withdrawn. */
  rowId: string | null;
  /** For ordering: oldest first. */
  sentMs: number;
}

/**
 * What to withdraw from this account, oldest first, taken only from what
 * LinkedIn says is still pending.
 */
async function chooseWithdrawals(
  ctx: WorkerContext,
  account: Account,
  pending: PendingInvitation[],
  truncated: boolean,
  cleanupOn: boolean,
  now: Date,
): Promise<Pick[]> {
  const ownCutoff = now.getTime() - LINKEDIN_LIMITS.withdrawAfterDays * 86_400_000;
  const outsideCutoff = now.getTime() - LINKEDIN_LIMITS.withdrawOutsideAfterDays * 86_400_000;
  const byInvitation = new Map(pending.filter((p) => p.invitationId).map((p) => [p.invitationId!, p]));
  const byPerson = new Map(pending.filter((p) => p.providerId && p.invitationId).map((p) => [p.providerId!, p]));

  // Every invitation this account sent through Nora that is still waiting.
  const { data: campaigns } = await ctx.db
    .from("campaigns")
    .select("id")
    .eq("workspace_id", account.workspace_id)
    .eq("linkedin_account_id", account.id);
  const campaignIds = (campaigns ?? []).map((c) => c.id);
  const { data: rows } = campaignIds.length
    ? await ctx.db
        .from("campaign_prospects")
        .select("id, prospect_id, invitation_id, invited_at")
        .in("campaign_id", campaignIds)
        .eq("status", "invited")
        .limit(2000)
    : { data: [] as Array<{ id: string; prospect_id: string; invitation_id: string | null; invited_at: string | null }> };
  const own = rows ?? [];
  const { data: people } = own.length
    ? await ctx.db.from("prospects").select("id, provider_id").in("id", [...new Set(own.map((r) => r.prospect_id))])
    : { data: [] as Array<{ id: string; provider_id: string | null }> };
  const personOf = new Map((people ?? []).map((p) => [p.id, p.provider_id]));

  const picks: Pick[] = [];
  const claimed = new Set<string>();
  for (const row of own) {
    const sentMs = row.invited_at ? Date.parse(row.invited_at) : Number.NaN;
    if (!Number.isFinite(sentMs) || sentMs > ownCutoff) continue;
    const listed =
      (row.invitation_id ? byInvitation.get(row.invitation_id) : undefined) ??
      (personOf.get(row.prospect_id) ? byPerson.get(personOf.get(row.prospect_id)!) : undefined);
    // Not on LinkedIn's list: answered, or expired. A complete list means the
    // acceptance poll will move it; a truncated one cannot say, so the stored
    // id is tried and LinkedIn refuses it if it is not pending.
    const invitationId = listed?.invitationId ?? (truncated ? row.invitation_id : null);
    if (!invitationId || claimed.has(invitationId)) continue;
    claimed.add(invitationId);
    picks.push({ invitationId, rowId: row.id, sentMs });
  }

  if (cleanupOn) {
    // Anybody Nora is still waiting on is Nora's to decide, by its own rule.
    const waitingOn = new Set(own.map((r) => personOf.get(r.prospect_id)).filter((id): id is string => Boolean(id)));
    for (const invitation of pending) {
      if (!invitation.invitationId || claimed.has(invitation.invitationId)) continue;
      if (invitation.providerId && waitingOn.has(invitation.providerId)) continue;
      const sentMs = invitation.sentAt ? Date.parse(invitation.sentAt) : Number.NaN;
      // Unknown age is never old.
      if (!Number.isFinite(sentMs) || sentMs > outsideCutoff) continue;
      claimed.add(invitation.invitationId);
      picks.push({ invitationId: invitation.invitationId, rowId: null, sentMs });
    }
  }

  return picks.sort((a, b) => a.sentMs - b.sentMs);
}

function validZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}
