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

/** How long a refused withdrawal is remembered and not asked again. */
const REFUSAL_MEMORY_MS = 7 * 86_400_000;
/** Extra asks a run may make past its budget when some are refused. */
const MAX_EXTRA_ATTEMPTS = 2;
/**
 * How long a provider call may take before the run moves on. The hourly chain
 * runs one job at a time, so a call that hangs would stop acceptances, replies
 * and repairs behind it, silently (the pending-list endpoint has hung before).
 */
const LIST_DEADLINE_MS = 30_000;
const WITHDRAW_DEADLINE_MS = 15_000;
/** A failure that is the provider's or the network's, not about the invitation. */
const TRANSIENT = /\b5\d\d\b|timed? ?out|did not answer|fetch failed|network|ECONN|socket|ETIMEDOUT|EAI_AGAIN/i;
/** Outcomes: a person in any other status is somebody Nora is still working with. */
const TERMINAL_STATUSES = new Set(["closed", "failed", "opted_out"]);

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the provider did not answer within ${Math.round(ms / 1000)}s`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
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
  const { data: switches } = await ctx.db.from("workspaces").select("id").eq("withdraw_old_invites", true);
  const cleanup = new Set((switches ?? []).map((w) => w.id));

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
  const dayStart = localDayStart(now, timezone).getTime();
  const { data: history, error: historyError } = await ctx.db
    .from("events")
    .select("name, payload, created_at")
    .eq("subject_id", account.id)
    .in("name", [WITHDRAWN_EVENT, WITHDRAW_REFUSED_EVENT])
    .gte("created_at", new Date(now.getTime() - REFUSAL_MEMORY_MS).toISOString());
  if (historyError) return none;
  const today = (history ?? []).filter((e) => Date.parse(e.created_at) >= dayStart);
  if (today.some((e) => e.name === WITHDRAW_REFUSED_EVENT && (e.payload as { stop?: boolean } | null)?.stop)) {
    return none;
  }
  const doneToday = today
    .filter((e) => e.name === WITHDRAWN_EVENT)
    .reduce((sum, e) => sum + Number((e.payload as { withdrawn?: number } | null)?.withdrawn ?? 0), 0);
  // An invitation LinkedIn refused to withdraw this week is not asked about
  // again: oldest first, the same refusals would take every slot every hour
  // and the account's pile would never move.
  const refusedIds = new Set(
    (history ?? [])
      .filter((e) => e.name === WITHDRAW_REFUSED_EVENT)
      .map((e) => (e.payload as { invitationId?: string } | null)?.invitationId)
      .filter((id): id is string => Boolean(id)),
  );
  const budget = Math.min(LINKEDIN_LIMITS.withdrawPerAccountPerHour, LINKEDIN_LIMITS.withdrawPerAccountPerDay - doneToday);
  if (budget <= 0) return none;

  // LinkedIn's own answer to "what is still pending". Never acted on blind.
  const { invitations, truncated } = await withDeadline(
    ctx.linkedin.listPendingInvitations({ accountId: account.provider_account_id!, limit: 500 }),
    LIST_DEADLINE_MS,
  );

  const picks = (await chooseWithdrawals(ctx, account, invitations, truncated, cleanupOn, now)).filter(
    (pick) => !refusedIds.has(pick.invitationId),
  );
  const tally = { withdrawn: 0, outside: 0, failed: 0 };
  let stopped = false;
  let blindTried = false;
  // Up to the budget withdrawn, and never more than a couple of extra asks
  // when some are refused: a run is a handful of calls, never a sweep.
  for (const pick of picks.slice(0, budget + MAX_EXTRA_ATTEMPTS)) {
    if (tally.withdrawn + tally.outside >= budget) break;
    // A blind try (see `chooseWithdrawals`) at most once a run.
    if (pick.blind && blindTried) continue;
    if (pick.blind) blindTried = true;
    const result = await withDeadline(
      ctx.linkedin.withdrawInvitation({ accountId: account.provider_account_id!, invitationId: pick.invitationId }),
      WITHDRAW_DEADLINE_MS,
    ).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err), health: undefined }));
    if (!result.ok) {
      tally.failed += 1;
      const kind = classifyProviderError(result.error);
      // LinkedIn pushing back on the account: nothing more from it today.
      stopped = Boolean(result.health) || (kind.kind === "retry_later" && kind.scope === "account");
      // Remembered (not asked again this week) only when LinkedIn refused this
      // invitation itself. A pushback, a server error or a timeout says
      // nothing about the invitation, and parking it for a week over one bad
      // minute would stall the pile.
      const aboutThisOne = !stopped && kind.kind === "permanent" && !TRANSIENT.test(result.error ?? "");
      await recordEvent(ctx.db, {
        workspaceId: account.workspace_id,
        name: WITHDRAW_REFUSED_EVENT,
        subjectType: "linkedin_account",
        subjectId: account.id,
        payload: {
          stop: stopped,
          invitationId: aboutThisOne ? pick.invitationId : null,
          provider: (result.error ?? "").slice(0, 300),
        },
      }).catch((err) => console.error("could not record a refused withdrawal", err));
      if (stopped) break;
      continue;
    }
    if (pick.rowIds.length) {
      tally.withdrawn += 1;
      await ctx.db
        .from("campaign_prospects")
        .update({ status: "closed", status_reason: "invitation expired", closed_at: now.toISOString() })
        .in("id", pick.rowIds)
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
    // The owner's number moves the moment the pile does, not an hour later;
    // never from a list that was cut short, which would understate it.
    if (!truncated) {
      await ctx.db
        .from("linkedin_accounts")
        .update({ pending_invites: Math.max(0, invitations.length - total), pending_invites_at: now.toISOString() })
        .eq("id", account.id);
    }
  }
  return tally;
}

interface Pick {
  invitationId: string;
  /** Nora's own rows for this invitation (one person can sit on two), closed once it is withdrawn. */
  rowIds: string[];
  /** For ordering: oldest first. */
  sentMs: number;
  /** Not on LinkedIn's list because the list was cut short: tried by its stored id. */
  blind?: boolean;
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

  const { data: campaigns, error: campaignsError } = await ctx.db
    .from("campaigns")
    .select("id")
    .eq("workspace_id", account.workspace_id)
    .eq("linkedin_account_id", account.id);
  // Unreadable is not "Nora sent nothing": acting on that would treat Nora's
  // own invitations as the rep's.
  if (campaignsError) throw new Error(`could not read campaigns: ${campaignsError.message}`);
  const campaignIds = (campaigns ?? []).map((c) => c.id);

  // Every row this account's campaigns hold, a thousand at a time: a read cut
  // at the server's row cap would leave people out of "Nora is still working
  // with them" and their invitations would be treated as the rep's.
  type Row = { id: string; prospect_id: string; status: string; invitation_id: string | null; invited_at: string | null };
  const rows: Row[] = [];
  if (campaignIds.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await ctx.db
        .from("campaign_prospects")
        .select("id, prospect_id, status, invitation_id, invited_at")
        .in("campaign_id", campaignIds)
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(`could not read this account's invitations: ${error.message}`);
      rows.push(...((data ?? []) as Row[]));
      if (!data || data.length < 1000) break;
    }
  }

  // In slices: two thousand ids in one `in` filter is a URL no server takes.
  const personOf = new Map<string, string | null>();
  const prospectIds = [...new Set(rows.map((r) => r.prospect_id))];
  for (let i = 0; i < prospectIds.length; i += 200) {
    const { data: people, error: peopleError } = await ctx.db
      .from("prospects")
      .select("id, provider_id")
      .in("id", prospectIds.slice(i, i + 200));
    if (peopleError) throw new Error(`could not read prospects: ${peopleError.message}`);
    for (const p of people ?? []) personOf.set(p.id, p.provider_id);
  }

  // Nora's own waiting invitations, grouped by the invitation they map to, so
  // two rows for one person are both closed when it goes.
  const picksById = new Map<string, Pick>();
  for (const row of rows) {
    if (row.status !== "invited") continue;
    const sentMs = row.invited_at ? Date.parse(row.invited_at) : Number.NaN;
    if (!Number.isFinite(sentMs) || sentMs > ownCutoff) continue;
    const person = personOf.get(row.prospect_id);
    const listed =
      (row.invitation_id ? byInvitation.get(row.invitation_id) : undefined) ?? (person ? byPerson.get(person) : undefined);
    // Not on LinkedIn's list: answered, or expired. A complete list means the
    // acceptance poll will move it; a list cut short cannot say, so the stored
    // id is tried, once a run, and LinkedIn refuses it if it is not pending.
    const invitationId = listed?.invitationId ?? (truncated ? row.invitation_id : null);
    if (!invitationId) continue;
    const existing = picksById.get(invitationId);
    if (existing) {
      existing.rowIds.push(row.id);
      existing.sentMs = Math.min(existing.sentMs, sentMs);
    } else {
      picksById.set(invitationId, { invitationId, rowIds: [row.id], sentMs, blind: !listed });
    }
  }
  const picks: Pick[] = [...picksById.values()];

  if (cleanupOn) {
    // Anybody Nora is still working with, at any stage before an outcome, is
    // Nora's to decide by its own rule. Withdrawing the rep's invitation to a
    // person Nora is about to invite would have LinkedIn refuse Nora's as a
    // resend, and that refusal reads as the whole account being held.
    const engaged = new Set(
      rows
        .filter((r) => !TERMINAL_STATUSES.has(r.status))
        .map((r) => personOf.get(r.prospect_id))
        .filter((id): id is string => Boolean(id)),
    );
    for (const invitation of pending) {
      if (!invitation.invitationId || picksById.has(invitation.invitationId)) continue;
      if (invitation.providerId && engaged.has(invitation.providerId)) continue;
      const sentMs = invitation.sentAt ? Date.parse(invitation.sentAt) : Number.NaN;
      // Unknown age is never old.
      if (!Number.isFinite(sentMs) || sentMs > outsideCutoff) continue;
      picks.push({ invitationId: invitation.invitationId, rowIds: [], sentMs });
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
