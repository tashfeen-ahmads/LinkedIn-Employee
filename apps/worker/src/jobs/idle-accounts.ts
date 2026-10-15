import { IDLE_RELEASE_DAYS, IDLE_RELEASE_DETAIL, isIdleForRelease } from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";

export interface IdleReleaseRun {
  /** Accounts that were connected and checked. */
  checked: number;
  /** Accounts released at the provider and marked here. */
  released: number;
  /** Accounts the provider refused to release, with its reason. */
  refused: Array<{ accountId: string; error: string }>;
}

/**
 * Release LinkedIn accounts nobody is using (rule 63).
 *
 * Every connected account is billed by the provider every month, sending or
 * not. An account with no running campaign whose rep has not sent, received,
 * built a campaign, connected or signed in for IDLE_RELEASE_DAYS is
 * disconnected at the provider and marked `disconnected` here with
 * IDLE_RELEASE_DETAIL, which is what the screens read to tell the rep to
 * reconnect. Reconnecting is the ordinary Connect button.
 *
 * Every lookup must answer before anything is released. A query that failed
 * is not "no activity", and releasing on it would cut a rep's live
 * conversations off for nothing — the same disease as a check reporting `ok`
 * because it could not look (rule 17). So any error throws, the nightly step
 * records it, and nobody is released that night.
 */
export async function releaseIdleAccounts(ctx: WorkerContext, now: Date = new Date()): Promise<IdleReleaseRun> {
  const { db } = ctx;
  const { data: rows, error } = await db
    .from("linkedin_accounts")
    .select("id, workspace_id, user_id, status, provider_account_id, connected_at, last_action_at")
    .neq("status", "connecting");
  if (error) throw new Error(`could not read accounts: ${error.message}`);

  const held = (rows ?? []).filter((row) => Boolean(row.provider_account_id));
  if (held.length === 0) return { checked: 0, released: 0, refused: [] };
  const ids = held.map((row) => row.id);
  const cutoff = new Date(now.getTime() - IDLE_RELEASE_DAYS * 86_400_000).toISOString();

  const [campaigns, conversations, seen] = await Promise.all([
    db
      .from("campaigns")
      .select("linkedin_account_id, status, created_at, updated_at, launched_at")
      .in("linkedin_account_id", ids),
    // Only recent messages matter, and only whether there was one.
    db
      .from("conversations")
      .select("linkedin_account_id, last_message_at")
      .in("linkedin_account_id", ids)
      .gte("last_message_at", cutoff),
    db.rpc("account_last_seen", { p_user_ids: [...new Set(held.map((row) => row.user_id))] }),
  ]);
  if (campaigns.error) throw new Error(`could not read campaigns: ${campaigns.error.message}`);
  if (conversations.error) throw new Error(`could not read conversations: ${conversations.error.message}`);
  if (seen.error) throw new Error(`could not read when reps last signed in: ${seen.error.message}`);

  const lastSeen = new Map(
    ((seen.data ?? []) as Array<{ user_id: string; last_seen_at: string | null }>).map((r) => [r.user_id, r.last_seen_at]),
  );

  const idle = held.filter((row) => {
    const own = (campaigns.data ?? []).filter((c) => c.linkedin_account_id === row.id);
    const touches = own
      .flatMap((c) => [c.created_at, c.updated_at, c.launched_at])
      .filter((at): at is string => Boolean(at))
      .sort();
    const messages = (conversations.data ?? [])
      .filter((c) => c.linkedin_account_id === row.id)
      .map((c) => c.last_message_at)
      .filter((at): at is string => Boolean(at))
      .sort();
    return isIdleForRelease(
      {
        runningCampaigns: own.filter((c) => c.status === "running").length,
        connectedAt: row.connected_at,
        lastActionAt: row.last_action_at,
        lastCampaignTouch: touches.at(-1) ?? null,
        lastMessageAt: messages.at(-1) ?? null,
        // A rep the function did not answer for has no sign-in to read, and
        // their account is kept rather than guessed about.
        lastSeenAt: lastSeen.has(row.user_id) ? lastSeen.get(row.user_id) : undefined,
      },
      now,
    );
  });

  let released = 0;
  const refused: IdleReleaseRun["refused"] = [];
  for (const row of idle) {
    // Asked again immediately before: a campaign launched since the read above
    // is the rep using the account, and releasing it would stop that launch.
    const { count, error: runningError } = await db
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("linkedin_account_id", row.id)
      .eq("status", "running");
    if (runningError || (count ?? 0) > 0) continue;

    const providerAccountId = row.provider_account_id as string;
    const result = await ctx.linkedin.deleteAccount(providerAccountId);
    if (!result.ok) {
      refused.push({ accountId: row.id, error: result.error ?? "refused" });
      continue;
    }

    // Conditional on still holding the id that was released, so a reconnect
    // that landed in between is never overwritten.
    const { error: updateError } = await db
      .from("linkedin_accounts")
      .update({ status: "disconnected", status_detail: IDLE_RELEASE_DETAIL, provider_account_id: null })
      .eq("id", row.id)
      .eq("provider_account_id", providerAccountId);
    if (updateError) {
      refused.push({ accountId: row.id, error: `released at the provider, row not marked: ${updateError.message}` });
      continue;
    }
    released += 1;
    await recordEvent(db, {
      workspaceId: row.workspace_id,
      name: "linkedin.account.released_idle",
      subjectType: "linkedin_account",
      subjectId: row.id,
      payload: { days: IDLE_RELEASE_DAYS, providerAccountId },
    });
  }

  if (refused.length > 0) {
    // After every account has had its turn, so one refusal never keeps the
    // others connected — and raised, so the night records it.
    throw new Error(
      `released ${released}, ${refused.length} refused: ${refused.map((r) => `${r.accountId} (${r.error})`).join("; ")}`,
    );
  }
  return { checked: held.length, released, refused };
}
