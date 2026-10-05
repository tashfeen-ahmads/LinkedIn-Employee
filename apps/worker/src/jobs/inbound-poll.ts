import type { WorkerContext } from "../context.js";
import { recordBeat } from "../heartbeat.js";
import { jobId, type Queues } from "../queues.js";

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
  const lastAt = (last?.detail as { at?: string } | null)?.at;
  const lastMs = lastAt ? Date.parse(lastAt) : NaN;
  const sinceMs = Number.isFinite(lastMs)
    ? Math.max(lastMs - OVERLAP_MS, now.getTime() - FIRST_LOOKBACK_MS)
    : now.getTime() - FIRST_LOOKBACK_MS;
  const since = new Date(sinceMs).toISOString();

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
    let messages;
    try {
      messages = await ctx.linkedin.listNewMessages({ accountId: account.provider_account_id, since });
    } catch (err) {
      failed.push({ account: account.id, error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
      continue;
    }
    found += messages.length;
    for (const message of messages) {
      if (!message.providerMessageId || !message.fromProviderId) continue;
      await queues.inbound.add(
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
      enqueued++;
    }
  }

  const result = { accounts: (accounts ?? []).length, found, enqueued, failed };
  await recordBeat(ctx.db, INBOUND_POLL_BEAT, { at: now.toISOString(), since, ...result });
  return result;
}
