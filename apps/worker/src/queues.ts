import { Queue, type JobsOptions } from "bullmq";
import IORedis from "ioredis";

export const QUEUE_NAMES = {
  strategy: "strategy",
  targeting: "targeting",
  campaignTick: "campaign-tick",
  linkedinAction: "linkedin-action",
  inbound: "inbound-message",
  maintenance: "maintenance",
  digest: "digest",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Builds a BullMQ custom job id.
 *
 * **BullMQ rejects a custom id containing `:`** — it reserves the colon for its
 * own key namespacing — and it rejects it by throwing from `add()`, not by
 * falling back to a generated id. Every job id in this worker was written as
 * `invite:<uuid>`, so every `add()` that carried one threw: invitations,
 * follow-ups, replies, launches, inbound messages. Nothing with a custom id
 * had ever been queued, which is the whole reason this deployment had sent
 * nobody. The pacing loop's own heartbeat is what finally reported it, in
 * words, on the screen — `failed: "Custom Id cannot contain :"`.
 *
 * The id still has to be *stable and unique per unit of work*: it is what
 * stops a second tick queueing an invitation the first tick already queued
 * (rule 21). So the parts are joined with a separator BullMQ accepts, and any
 * colon inside a part is replaced rather than dropped — dropping it could map
 * two different ids onto one, which would silently skip a real send.
 */
export function jobId(...parts: (string | number)[]): string {
  return parts.map((part) => String(part).replaceAll(":", "-")).join("--");
}

export interface StrategyJob {
  workspaceId: string;
  userId: string;
  /**
   * Add more strategies to the ones this workspace already has, rather than
   * writing its first set.
   *
   * A first run produces three to five — the right number to read and approve
   * in one sitting, and the wrong number to run a business on. This is the
   * same agent asked for more, told what already exists so it does not rewrite
   * it, and writing into the business profile that is already there instead of
   * creating a second one.
   */
  expand?: boolean;
  websiteUrl?: string;
  linkedinCompanyUrl?: string;
  description?: string;
  existingCustomers?: string[];
}

export interface TargetingJob {
  workspaceId: string;
  customerProfileId: string;
  linkedinAccountId: string;
  userId: string;
  limit: number;
  /**
   * The campaign to add to, when this run is continuing a list rather than
   * starting one.
   *
   * A campaign is where the search's position is kept, so continuing means
   * naming the campaign and nothing else: the profile and the account come off
   * its own row. Absent, this is a first search and a new campaign.
   */
  campaignId?: string;
}

export interface CampaignTickJob {
  workspaceId: string;
  campaignId: string;
}

export type LinkedInActionJob =
  | { kind: "invite"; workspaceId: string; campaignProspectId: string }
  | { kind: "follow_up"; workspaceId: string; campaignProspectId: string; stepNumber: number }
  | { kind: "reply"; workspaceId: string; conversationId: string; draftId: string };

export interface InboundMessageJob {
  workspaceId: string;
  linkedinAccountId: string;
  providerChatId: string;
  providerMessageId: string;
  fromProviderId: string;
  text: string;
  receivedAt: string;
}

export function createConnection(redisUrl: string): IORedis {
  // `maxRetriesPerRequest: null` is BullMQ's requirement -- a blocking read
  // that gives up mid-wait loses the job it was holding. The cost is that a
  // command against an unreachable Redis never fails either: it queues in the
  // client and waits, for ever, with no error and no log line after the first
  // connect attempt. Which is why `queueReachable` below exists rather than
  // anything simply trying a command and seeing what happens.
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

/**
 * Whether the queue is actually reachable, answered within a deadline.
 *
 * This deployment spent an afternoon in the state this function exists to
 * detect: the worker process up, Render reporting the service Live, its HTTP
 * API answering every request -- and not one queued job being consumed,
 * because the health check returned `{ ok: true }` without ever touching
 * Redis, and a retrying client turns "the queue is gone" into silence rather
 * than an error. Every screen in the product agreed the deployment was fine.
 *
 * The deadline is the whole point: without it this waits as long as the client
 * does, which is for ever, and a health check that hangs is a health check that
 * tells you nothing.
 */
export async function queueReachable(connection: IORedis, timeoutMs = 2_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const pong = connection.ping();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("redis did not answer in time")), timeoutMs);
    });
    return (await Promise.race([pong, deadline])) === "PONG";
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface Queues {
  strategy: Queue<StrategyJob>;
  targeting: Queue<TargetingJob>;
  campaignTick: Queue<CampaignTickJob>;
  linkedinAction: Queue<LinkedInActionJob>;
  inbound: Queue<InboundMessageJob>;
  maintenance: Queue<Record<string, never>>;
  digest: Queue<Record<string, never>>;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 86_400, count: 5_000 },
  removeOnFail: { age: 7 * 86_400 },
};

export function createQueues(connection: IORedis): Queues {
  const opts = { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS };
  return {
    strategy: new Queue(QUEUE_NAMES.strategy, opts),
    targeting: new Queue(QUEUE_NAMES.targeting, opts),
    campaignTick: new Queue(QUEUE_NAMES.campaignTick, opts),
    linkedinAction: new Queue(QUEUE_NAMES.linkedinAction, opts),
    inbound: new Queue(QUEUE_NAMES.inbound, opts),
    maintenance: new Queue(QUEUE_NAMES.maintenance, opts),
    digest: new Queue(QUEUE_NAMES.digest, opts),
  };
}

/**
 * Repeatable jobs. The campaign tick is what actually paces outreach: it wakes
 * every few minutes, asks the rate limiter what is allowed right now, and
 * enqueues at most that much work.
 */
export async function scheduleRepeatables(queues: Queues): Promise<void> {
  await queues.campaignTick.upsertJobScheduler(
    "all-campaigns",
    { every: 5 * 60_000 },
    { name: "tick", data: { workspaceId: "*", campaignId: "*" } },
  );
  await queues.maintenance.upsertJobScheduler(
    "nightly",
    { pattern: "0 3 * * *" },
    { name: "maintenance", data: {} },
  );
  /*
   * Acceptance, hourly.
   *
   * Unipile exposes no acceptance webhook, so noticing one means asking — and
   * asking once a night meant a prospect who accepted at 09:05 was not written
   * to until the following morning, with the configured delay stacked on top of
   * that. The first live acceptance sat for a day for exactly this reason.
   *
   * It is the one step of the night that is worth repeating during the day: the
   * rest sweep, reconcile and report, and none of them decide how long a warm
   * prospect waits.
   */
  await queues.maintenance.upsertJobScheduler(
    "acceptance-hourly",
    { every: 60 * 60_000 },
    { name: "acceptance", data: {} },
  );
  // Weekday mornings only: a digest on Sunday is an email nobody wants.
  await queues.digest.upsertJobScheduler(
    "weekday-morning",
    { pattern: "0 7 * * 1-5" },
    { name: "digest", data: {} },
  );
}
