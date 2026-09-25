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
  /**
   * Look at this prospect's profile, so the invitation that follows reaches a
   * name they have already seen. Its own kind rather than a flag on `invite`
   * because it has its own allowance, its own pacing, and — the part that
   * matters — it runs while LinkedIn is refusing invitations, which is exactly
   * when a campaign otherwise has nothing to do.
   */
  | { kind: "warm_up"; workspaceId: string; campaignProspectId: string }
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

/** What `enqueueOnce` did, so the caller can say it on a screen. */
export type EnqueueOutcome = "added" | "already_pending" | "revived";

/**
 * Adds a job under a stable id, and refuses to let a finished job hold that id
 * for ever.
 *
 * The id is deliberate: it is what stops the five-minute pacing loop queueing
 * an invitation the previous tick already queued (rule 21). BullMQ implements
 * that by accepting an `add()` whose id is taken and **silently returning the
 * existing job** instead of adding anything. That is exactly the behaviour we
 * want while the job is still waiting to run.
 *
 * It is exactly the wrong behaviour once the job has finished. Completed jobs
 * are kept for a day and failed ones for a week, so an invitation that ran and
 * came back without sending — any of the half-dozen silent `return`s in
 * `runLinkedInAction`, a provider refusal, a throw after the retries were spent
 * — leaves its prospect sitting at `queued` with its id held by a corpse. Every
 * tick after that adds nothing, reports the cheerful zero it has always
 * reported, and that person is never written to again. Seven real prospects sat
 * in that state through a full working day while the loop, the queue counts and
 * the campaign screen all looked healthy. Reporting the counts told us a number
 * was wrong; it did not put anybody back on the conveyor belt, and repair must
 * never wait for somebody to notice (rule 8).
 *
 * So a terminal state is treated as the evidence it is: the unit of work is
 * over and the row still needs doing, therefore the id is stale. The job is
 * removed and re-added. Nothing else is touched — a `waiting`, `delayed` or
 * `active` job is the dedupe working, and is left exactly alone.
 *
 * This cannot double-send. The caller only passes rows that are still waiting,
 * and a job that really did send has already stamped `last_contacted_at`, which
 * the never-twice check reads immediately before the call and closes the
 * prospect on (rule 24).
 */
/** The two methods this needs off a BullMQ job, and nothing else. */
interface HeldJob {
  getState: () => Promise<string>;
  remove: () => Promise<unknown>;
}

export async function enqueueOnce<D>(
  queue: Queue<D>,
  name: string,
  data: D,
  opts: JobsOptions & { jobId: string },
): Promise<EnqueueOutcome> {
  // BullMQ correlates the job name with the data shape through a conditional
  // type that it cannot resolve inside a generic function. The job payloads
  // here carry no name field, so the correlation is vacuous; narrowed to the
  // one call this needs rather than loosened at every call site, which would
  // stop `data` being checked against the queue at all.
  const add = (queue as unknown as { add: (n: string, d: D, o: JobsOptions) => Promise<unknown> }).add.bind(
    queue,
  );
  // Asked before adding, not after. `add()` on a taken id returns the existing
  // job with no indication that it did nothing, so a job we just created and a
  // job from an hour ago come back indistinguishable — and the whole point here
  // is to tell those two apart.
  //
  // Guarded because the test double is a plain object with an `add`. A
  // diagnostic that throws would take down the one loop that has to keep
  // running.
  const q = queue as unknown as { getJob?: (id: string) => Promise<unknown> };
  if (typeof q.getJob !== "function") {
    await add(name, data, opts);
    return "added";
  }

  let found: unknown;
  try {
    found = await q.getJob(opts.jobId);
  } catch {
    // Unknowable is not the same as absent. Add anyway: BullMQ will decline it
    // if the id is in fact taken, which is the behaviour we would have chosen.
    await add(name, data, opts);
    return "added";
  }

  const held = found as Partial<HeldJob> | null | undefined;
  if (typeof held?.getState !== "function" || typeof held.remove !== "function") {
    await add(name, data, opts);
    return "added";
  }

  let state: string;
  try {
    state = await held.getState();
  } catch {
    // Leave it. The next tick asks again, and re-adding on a state we could not
    // read is how one job becomes two.
    return "already_pending";
  }
  if (state !== "completed" && state !== "failed") return "already_pending";

  try {
    await held.remove();
  } catch {
    // Locked, or already gone. Either way not ours to force.
    return "already_pending";
  }
  await add(name, data, opts);
  return "revived";
}
