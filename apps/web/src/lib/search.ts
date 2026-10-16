import "server-only";
import { createClient } from "@/lib/supabase-server";
import { callWorker, isAlreadyRunning } from "@/lib/worker";

/** How many people one search asks LinkedIn for. */
export const HOW_MANY = 50;

/**
 * Start the search for one approved strategy.
 *
 * One definition, two callers — approving, and the button for a deliberate
 * re-run. They were the same twelve lines written twice, which in this codebase
 * is the shape a rule takes just before the copies drift.
 *
 * It never throws. Approving must succeed even when the search cannot start,
 * because the approval is the thing the person actually did and losing it to a
 * disconnected LinkedIn account would be the product refusing a decision it
 * already has.
 */
export async function queueSearch(
  workspaceId: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
): Promise<{ ok: true; alreadyRunning: boolean } | { ok: false; reason: string }> {
  const { data: account } = await supabase
    .from("linkedin_accounts")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (account?.status !== "active") {
    return { ok: false, reason: "Connect your LinkedIn account and the search will run." };
  }

  const queued = await callWorker("/jobs/targeting", {
    workspaceId,
    userId,
    customerProfileId: profileId,
    linkedinAccountId: account.id,
    limit: HOW_MANY,
  });
  // A press while this strategy's search is still running is the same search
  // (the worker dedupes it), and the sentence the caller shows has to say so.
  return queued.ok
    ? { ok: true, alreadyRunning: isAlreadyRunning(queued.data) }
    : { ok: false, reason: queued.error };
}

