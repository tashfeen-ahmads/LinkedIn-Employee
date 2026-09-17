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

export interface StrategyJob {
  workspaceId: string;
  userId: string;
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
  // Weekday mornings only: a digest on Sunday is an email nobody wants.
  await queues.digest.upsertJobScheduler(
    "weekday-morning",
    { pattern: "0 7 * * 1-5" },
    { name: "digest", data: {} },
  );
}
