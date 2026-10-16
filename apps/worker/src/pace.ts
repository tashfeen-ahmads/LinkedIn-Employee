import { LINKEDIN_LIMITS } from "@le/shared";
import type { WorkerContext } from "./context.js";

/**
 * When this account last sent an invitation, from any of its campaigns, or
 * null if it never has.
 *
 * The pace is between invitations (rule 64), and it is read here rather than
 * off `last_action_at`, which moves on every profile view and message too. A
 * view taken minutes before a warmed person's window closed made the gap look
 * fresh, pushed their invitation past the window, and they were viewed again.
 * One reading, so the loop that places invitations and the send path that
 * holds them to the pace cannot disagree.
 */
export async function lastInviteAt(db: WorkerContext["db"], accountId: string): Promise<Date | null> {
  const ids = await accountCampaignIds(db, accountId);
  if (!ids.length) return null;
  const { data } = await db
    .from("campaign_prospects")
    .select("invited_at")
    .in("campaign_id", ids)
    .not("invited_at", "is", null)
    .order("invited_at", { ascending: false })
    .limit(1);
  const at = data?.[0]?.invited_at ? new Date(data[0].invited_at) : null;
  return at && Number.isFinite(at.getTime()) ? at : null;
}

export async function accountCampaignIds(db: WorkerContext["db"], accountId: string): Promise<string[]> {
  const { data } = await db.from("campaigns").select("id").eq("linkedin_account_id", accountId);
  return (data ?? []).map((c) => c.id);
}

/**
 * People on this account viewed recently enough to count and still waiting
 * for their invitation, other than `exceptId`. Each needs a floor's worth of
 * room before the next view's window closes (rule 64).
 */
export async function warmedWaitingOnAccount(
  db: WorkerContext["db"],
  accountId: string,
  exceptId: string,
): Promise<number> {
  const ids = await accountCampaignIds(db, accountId);
  if (!ids.length) return 0;
  const since = new Date(Date.now() - LINKEDIN_LIMITS.warmUpToInviteMaxMs).toISOString();
  const { data } = await db
    .from("campaign_prospects")
    .select("id")
    .in("campaign_id", ids)
    .eq("status", "queued")
    .gte("warmed_at", since);
  return (data ?? []).filter((row) => row.id !== exceptId).length;
}
