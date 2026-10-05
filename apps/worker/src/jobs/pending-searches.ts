import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { enqueueOnce, jobId, type Queues } from "../queues.js";

/** How many people a first search looks for — the same as the strategy screen's button. */
export const FIRST_SEARCH_SIZE = 50;

/**
 * Start the search for every approved strategy that is still waiting for one.
 *
 * Approving a strategy starts its search — unless no LinkedIn account was
 * connected yet, in which case the screen said "connect your LinkedIn account
 * and the search will run" and nothing ever ran it. The checklist puts approval
 * before connecting, so that was the ordinary path for a new customer: they
 * connected, were told nothing more was needed until a campaign appeared, and
 * no campaign ever did.
 *
 * Only strategies whose search never started: approved, still pursued, with no
 * campaign and no recorded attempt. A search that ran and found nobody is an
 * answer, and repeating it every hour would spend a paid seat's searches on
 * the same empty page. The same job id as the button's, so a press and this
 * can never queue two searches.
 *
 * Called as soon as an account is connected, and hourly so that nothing
 * depends on that moment going right (rule 8).
 */
export async function startPendingSearches(
  ctx: WorkerContext,
  queues: Pick<Queues, "targeting">,
  scope: { workspaceId?: string } = {},
): Promise<number> {
  let accountsQuery = ctx.db
    .from("linkedin_accounts")
    .select("id, workspace_id, user_id, status, provider_account_id")
    .eq("status", "active")
    .not("provider_account_id", "is", null);
  if (scope.workspaceId) accountsQuery = accountsQuery.eq("workspace_id", scope.workspaceId);
  const { data: accounts } = await accountsQuery;
  if (!accounts?.length) return 0;

  const accountByWorkspace = new Map<string, { id: string; user_id: string }>();
  for (const account of accounts) {
    if (!accountByWorkspace.has(account.workspace_id)) accountByWorkspace.set(account.workspace_id, account);
  }

  const { data: profiles } = await ctx.db
    .from("customer_profiles")
    .select("id, workspace_id")
    .in("workspace_id", [...accountByWorkspace.keys()])
    .not("approved_at", "is", null)
    .eq("do_not_pursue", false);
  if (!profiles?.length) return 0;
  const profileIds = profiles.map((p) => p.id);

  const [{ data: campaigns }, { data: attempts }] = await Promise.all([
    ctx.db.from("campaigns").select("customer_profile_id").in("customer_profile_id", profileIds),
    ctx.db
      .from("events")
      .select("subject_id")
      .in("name", ["targeting.queued", "targeting.stopped"])
      .in("subject_id", profileIds),
  ]);
  const done = new Set([
    ...(campaigns ?? []).map((row) => row.customer_profile_id),
    ...(attempts ?? []).map((row) => row.subject_id),
  ]);

  let started = 0;
  for (const profile of profiles) {
    if (done.has(profile.id)) continue;
    const account = accountByWorkspace.get(profile.workspace_id);
    if (!account) continue;
    const data = {
      workspaceId: profile.workspace_id,
      userId: account.user_id,
      customerProfileId: profile.id,
      linkedinAccountId: account.id,
      limit: FIRST_SEARCH_SIZE,
    };
    const outcome = await enqueueOnce(queues.targeting, "targeting", data, {
      jobId: jobId("targeting", profile.id, "new"),
    });
    if (outcome === "already_pending") continue;
    await recordEvent(ctx.db, {
      workspaceId: profile.workspace_id,
      name: "targeting.queued",
      actorUserId: account.user_id,
      subjectType: "customer_profile",
      subjectId: profile.id,
      payload: { limit: FIRST_SEARCH_SIZE, campaignId: null, trigger: "account-connected" },
    }).catch((err) => console.error("could not record targeting.queued", err));
    started += 1;
  }
  return started;
}
