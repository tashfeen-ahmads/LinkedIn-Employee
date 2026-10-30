import { LINKEDIN_LIMITS } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

/**
 * Keep every account's pile of unanswered invitations small.
 *
 * LinkedIn refuses new invitations from an account carrying a large backlog,
 * and it counts every invitation the rep ever sent. On 30 October four of the
 * five accounts that were sending were refused all day: one held 258 pending
 * invitations of which this product had sent nine, another 165. The sweep
 * withdrew only Nora's own, only after three weeks, and only fifty a night
 * across the whole deployment, so one busy account spent the night's work and
 * the backlogs never shrank.
 *
 * Now, per account and per night:
 *  - Nora's own invitations are withdrawn at `withdrawAfterDays` (14), the
 *    earliest LinkedIn allows, and the prospect is closed as expired.
 *  - When an owner has turned on `withdraw_old_invites`, invitations sent
 *    outside Nora are withdrawn too, once LinkedIn says they are at least
 *    `withdrawOutsideAfterDays` old. Never one whose age is unknown: unknown
 *    is not old, and these are the rep's own.
 *  - At most `withdrawPerAccountPerNight` in all, so one pile never costs
 *    another account its turn and no account withdraws in a burst.
 *
 * Only for an active account: a withdrawal is an action on somebody's
 * LinkedIn, and an account that is not working is not ours to act on.
 */
export async function withdrawStaleInvites(
  ctx: WorkerContext,
  now: Date = new Date(),
): Promise<{ withdrawn: number; outside: number }> {
  const tally = { withdrawn: 0, outside: 0 };
  const { data: accounts, error } = await ctx.db
    .from("linkedin_accounts")
    .select("id, workspace_id, provider_account_id, status")
    .eq("status", "active");
  if (error) throw new Error(`could not read accounts: ${error.message}`);

  // Read separately so a deployment without migration 0063 still withdraws
  // its own invitations; an unreadable switch is off.
  const { data: switches } = await ctx.db.from("workspaces").select("id, withdraw_old_invites");
  const cleanup = new Set((switches ?? []).filter((w) => w.withdraw_old_invites === true).map((w) => w.id));

  for (const account of accounts ?? []) {
    if (!account.provider_account_id) continue;
    let budget = LINKEDIN_LIMITS.withdrawPerAccountPerNight;
    const own = await withdrawOwn(ctx, account, now, budget);
    tally.withdrawn += own;
    budget -= own;
    if (budget > 0 && cleanup.has(account.workspace_id)) {
      const outside = await withdrawOutside(ctx, account, now, budget).catch((err) => {
        console.error("could not clean up old invitations", { accountId: account.id, err });
        return 0;
      });
      tally.outside += outside;
    }
  }
  return tally;
}

type Account = { id: string; workspace_id: string; provider_account_id: string | null };

async function withdrawOwn(ctx: WorkerContext, account: Account, now: Date, budget: number): Promise<number> {
  const cutoff = new Date(now.getTime() - LINKEDIN_LIMITS.withdrawAfterDays * 86_400_000).toISOString();
  const { data: campaigns } = await ctx.db
    .from("campaigns")
    .select("id")
    .eq("workspace_id", account.workspace_id)
    .eq("linkedin_account_id", account.id);
  const ids = (campaigns ?? []).map((c) => c.id);
  if (!ids.length) return 0;

  const { data: stale } = await ctx.db
    .from("campaign_prospects")
    .select("id, invitation_id")
    .in("campaign_id", ids)
    .eq("status", "invited")
    .not("invitation_id", "is", null)
    .lt("invited_at", cutoff)
    .order("invited_at", { ascending: true })
    .limit(budget);

  let withdrawn = 0;
  for (const row of stale ?? []) {
    const result = await ctx.linkedin.withdrawInvitation({
      accountId: account.provider_account_id!,
      invitationId: row.invitation_id!,
    });
    if (!result.ok) continue;
    withdrawn += 1;
    await ctx.db
      .from("campaign_prospects")
      .update({ status: "closed", status_reason: "invitation expired", closed_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "invited");
  }
  return withdrawn;
}

async function withdrawOutside(ctx: WorkerContext, account: Account, now: Date, budget: number): Promise<number> {
  const provider = ctx.linkedin as typeof ctx.linkedin & {
    listPendingInvitations?: typeof ctx.linkedin.listPendingInvitations;
  };
  if (typeof provider.listPendingInvitations !== "function") return 0;
  const { invitations } = await provider.listPendingInvitations({
    accountId: account.provider_account_id!,
    limit: 500,
  });
  const cutoff = now.getTime() - LINKEDIN_LIMITS.withdrawOutsideAfterDays * 86_400_000;
  const old = invitations
    .filter((row) => row.invitationId && row.sentAt && Date.parse(row.sentAt) <= cutoff)
    .sort((a, b) => Date.parse(a.sentAt!) - Date.parse(b.sentAt!))
    .slice(0, budget);
  if (!old.length) return 0;

  let withdrawn = 0;
  for (const row of old) {
    const result = await ctx.linkedin.withdrawInvitation({
      accountId: account.provider_account_id!,
      invitationId: row.invitationId!,
    });
    if (!result.ok) continue;
    withdrawn += 1;
    // One of Nora's own that the sweep above had not reached: its prospect is
    // closed the same way, so no screen reports it as still waiting.
    await ctx.db
      .from("campaign_prospects")
      .update({ status: "closed", status_reason: "invitation expired", closed_at: now.toISOString() })
      .eq("workspace_id", account.workspace_id)
      .eq("invitation_id", row.invitationId!)
      .eq("status", "invited");
  }
  if (withdrawn) {
    await recordEvent(ctx.db, {
      workspaceId: account.workspace_id,
      name: "linkedin.invitations_withdrawn",
      subjectType: "linkedin_account",
      subjectId: account.id,
      payload: { withdrawn, olderThanDays: LINKEDIN_LIMITS.withdrawOutsideAfterDays },
    }).catch((err) => console.error("could not record withdrawn invitations", err));
  }
  return withdrawn;
}
