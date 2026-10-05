import type { WorkerContext } from "../context.js";
import { recordBeat } from "../heartbeat.js";
import { enqueueOnce, jobId, type Queues } from "../queues.js";

export const INBOUND_POLL_BEAT = "inbound:poll";

/** How far back the first run, or a run after a long gap, looks. */
const FIRST_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
/** Overlap with the previous run, so a message stamped at the boundary is not lost. */
const OVERLAP_MS = 30 * 60_000;

/**
 * Ask the provider for new replies, instead of only waiting to be told.
 *
 * Every reply used to reach this product through one door: the provider's
 * webhook. When that door was misconfigured — the first deployment's webhook
 * carried no credential and every delivery was refused — a prospect's reply sat
 * on LinkedIn and never arrived here, and nothing anywhere could recover it. A
 * provider method that lists new messages existed the whole time and nothing
 * called it.
 *
 * So the worker also asks, every quarter of an hour, for every connected
 * account. What it finds goes through exactly the path a webhook delivery takes
 * — the same queue, the same job id per message — so a reply that arrives both
 * ways is handled once, and `handleInboundMessage` drops anything already
 * stored and anything from somebody we never contacted.
 *
 * A failure for one account is recorded and the others continue: one account
 * the provider refuses must not stop replies reaching everybody else.
 *
 * And the place an account is read from does not move past a failure. There
 * used to be one `at` for every account, stamped after every run, so a run in
 * which one account failed told the next run that account had been read — and
 * anything it received more than the overlap before that was never asked for
 * again. Each account now carries its own `at` in the beat, moved only when
 * that account was actually read; the shared `at` moves only when every
 * account was. Re-reading is safe, because `handleInboundMessage` drops a
 * message it already holds before it does anything else.
 */
export async function pollInbound(
  ctx: WorkerContext,
  queues: Pick<Queues, "inbound">,
  now: Date = new Date(),
): Promise<{ accounts: number; found: number; enqueued: number; failed: Array<{ account: string; error: string }> }> {
  const { data: last } = await ctx.db
    .from("worker_heartbeats")
    .select("detail")
    .eq("name", INBOUND_POLL_BEAT)
    .maybeSingle();
  const lastDetail = (last?.detail ?? null) as { at?: string | null; accountsAt?: Record<string, string> } | null;
  const lastAt = lastDetail?.at ?? null;
  const previousAccountsAt =
    lastDetail?.accountsAt && typeof lastDetail.accountsAt === "object" ? lastDetail.accountsAt : {};
  // An account with no stamp of its own starts from the shared one, which is
  // what every account read from before stamps were kept per account.
  const sinceFor = (accountId: string): string => {
    const stamp = previousAccountsAt[accountId] ?? lastAt;
    const ms = stamp ? Date.parse(stamp) : NaN;
    return new Date(
      Number.isFinite(ms)
        ? Math.max(ms - OVERLAP_MS, now.getTime() - FIRST_LOOKBACK_MS)
        : now.getTime() - FIRST_LOOKBACK_MS,
    ).toISOString();
  };
  const accountsAt: Record<string, string> = { ...previousAccountsAt };
  let since = now.toISOString();

  const { data: accounts } = await ctx.db
    .from("linkedin_accounts")
    .select("id, workspace_id, provider_account_id, status")
    .in("status", ["active", "warning", "restricted"])
    .not("provider_account_id", "is", null);

  let found = 0;
  let enqueued = 0;
  const failed: Array<{ account: string; error: string }> = [];

  for (const account of accounts ?? []) {
    if (!account.provider_account_id) continue;
    const accountSince = sinceFor(account.id);
    if (accountSince < since) since = accountSince;
    let messages;
    try {
      messages = await ctx.linkedin.listNewMessages({ accountId: account.provider_account_id, since: accountSince });
    } catch (err) {
      failed.push({ account: account.id, error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
      // Its stamp stays where it was, so the next run asks again from there.
      continue;
    }
    accountsAt[account.id] = now.toISOString();
    found += messages.length;
    for (const message of messages) {
      if (!message.providerMessageId || !message.fromProviderId) continue;
      // `enqueueOnce`, not `add`. The webhook usually delivered this message
      // first, and a webhook job that finished without storing it — the
      // sender not yet matched to a prospect, say — would otherwise hold the
      // id for a day and turn this door away too (rule 44). Reviving a job for
      // a message that was stored is a single lookup in `handleInboundMessage`.
      const outcome = await enqueueOnce(
        queues.inbound,
        "inbound",
        {
          workspaceId: account.workspace_id,
          linkedinAccountId: account.id,
          providerChatId: message.providerChatId,
          providerMessageId: message.providerMessageId,
          fromProviderId: message.fromProviderId,
          text: message.text,
          receivedAt: message.receivedAt,
        },
        // The id the webhook uses, so the two doors never handle one reply twice.
        { jobId: jobId("inbound", message.providerMessageId) },
      );
      if (outcome !== "already_pending") enqueued++;
    }
  }

  const result = { accounts: (accounts ?? []).length, found, enqueued, failed };
  // Held back after a failure, for any reader still using the shared stamp.
  // With no previous stamp the first-run lookback applies again, which is the
  // same answer.
  const at = failed.length ? lastAt : now.toISOString();
  await recordBeat(ctx.db, INBOUND_POLL_BEAT, { at, accountsAt, ranAt: now.toISOString(), since, ...result });
  return result;
}
