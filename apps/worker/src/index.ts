import { serve } from "@hono/node-server";
// Before anything else, so a failure during start-up is reported rather than
// lost to a container that exits.
import { initObservability, reportJobFailure, Sentry } from "./observability.js";
import { DelayedError, Worker } from "bullmq";
import { loadEnv } from "./config.js";
import { createWorkerContext } from "./context.js";
import { createConnection, createQueues, QUEUE_NAMES, queueReachable, scheduleRepeatables } from "./queues.js";
import { recordBeat } from "./heartbeat.js";
import { BOOT_BEAT } from "@le/shared";
import type { CampaignTickJob, InboundMessageJob, LinkedInActionJob, StrategyJob, TargetingJob } from "./queues.js";
import { runCampaignTick } from "./jobs/campaign-tick.js";
import { runLinkedInAction, RescheduleError } from "./jobs/linkedin-action.js";
import { handleInboundMessage } from "./jobs/inbound.js";
import { runStrategyJob } from "./jobs/strategy.js";
import { runTargetingJob } from "./jobs/targeting.js";
import { detectAcceptedInvitations } from "./jobs/acceptance.js";
import { unstickProspects } from "./jobs/unstick.js";
import { runMaintenance } from "./jobs/maintenance.js";
import { runDailyDigest } from "./jobs/digest.js";
import { createServer } from "./server.js";

initObservability();

/**
 * The queue's host, for a report somebody reads. Never the whole URL: it
 * carries the password.
 */
function redisHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

const env = loadEnv();
const ctx = createWorkerContext(env);
const connection = createConnection(env.REDIS_URL);
const queues = createQueues(connection);

/**
 * Says this process started, which build it is, and whether it can see its
 * queue — written straight to Postgres before any of that is relied on.
 *
 * Everything else that reports on this worker's health goes through the queue.
 * So when the queue is what is broken, nothing arrives, and "the worker is not
 * running", "the worker is running but cannot reach its queue" and "the
 * platform is still serving the previous build" all present as the same
 * absence. They are three different things to do about it, and an hour went
 * into telling them apart from the outside. Now the worker says which.
 *
 * `RENDER_GIT_COMMIT` is the answer to "is the latest commit actually
 * deployed", from the process itself rather than from a dashboard reporting on
 * it — those disagreed here for most of an afternoon, and the dashboard was
 * the one being read.
 */
const queueOk = await queueReachable(connection);
await recordBeat(ctx.db, BOOT_BEAT, {
  commit: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
  queueReachable: queueOk,
  redisHost: redisHost(env.REDIS_URL),
  nodeEnv: process.env.NODE_ENV ?? null,
});
if (!queueOk) {
  // Not a crash: the HTTP API still answers, /health now says 503, and the
  // boot stamp above is readable from the product's own screens. A process
  // that exits here would be restarted into the same state with nothing
  // written down, which is how this was invisible in the first place.
  console.error("the job queue is unreachable; nothing queued will be consumed", {
    redisHost: redisHost(env.REDIS_URL),
  });
}

await scheduleRepeatables(queues);

const workers = [
  new Worker<StrategyJob>(QUEUE_NAMES.strategy, (job) => runStrategyJob(ctx, job.data), {
    connection,
    concurrency: 4,
  }),
  new Worker<TargetingJob>(QUEUE_NAMES.targeting, (job) => runTargetingJob(ctx, job.data), {
    connection,
    concurrency: 2,
  }),
  new Worker<CampaignTickJob>(QUEUE_NAMES.campaignTick, () => runCampaignTick(ctx.db, queues), {
    connection,
    concurrency: 1,
  }),
  // Concurrency 1 on purpose: LinkedIn actions are paced, and two sends leaving
  // one account at the same instant is what the minimum gap exists to stop. The
  // counters themselves are safe either way — record_linkedin_action increments
  // them in one statement.
  new Worker<LinkedInActionJob>(
    QUEUE_NAMES.linkedinAction,
    async (job) => {
      try {
        await runLinkedInAction(ctx, job.data);
      } catch (err) {
        if (err instanceof RescheduleError) {
          await job.moveToDelayed(Date.now() + err.retryAfterMs, job.token);
          // BullMQ requires this throw: without it the worker tries to complete
          // a job it has just moved to the delayed set, and the reschedule
          // fails instead of happening.
          throw new DelayedError();
        }
        throw err;
      }
    },
    { connection, concurrency: 1 },
  ),
  new Worker<InboundMessageJob>(QUEUE_NAMES.inbound, (job) => handleInboundMessage(ctx, queues, job.data), {
    connection,
    concurrency: 4,
  }),
  // Two schedules share this queue: the nightly sweep, and the hourly
  // acceptance poll that decides how long a warm prospect waits to be written
  // to. Running the whole sweep hourly would withdraw invitations and send
  // digests twelve times a day.
  new Worker(
    QUEUE_NAMES.maintenance,
    (job) =>
      job.name === "acceptance"
        ? // Notice who accepted, then put anybody whose next step went missing
          // back on the rails. Both are hourly because both decide whether a
          // warm prospect is written to today or never.
          detectAcceptedInvitations(ctx)
            .then(() => unstickProspects(ctx.db))
            .then(() => undefined)
        : runMaintenance(ctx, queues),
    { connection, concurrency: 1 },
  ),
  new Worker(QUEUE_NAMES.digest, () => runDailyDigest(ctx), { connection, concurrency: 1 }),
];

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    // A rescheduled action is the limiter doing its job, not a failure. Every
    // one of those in an error tracker would bury the ones that matter.
    if (err instanceof RescheduleError || err?.name === "DelayedError") return;
    reportJobFailure(worker.name, job?.id, err, { attempts: job?.attemptsMade, data: job?.name });
  });
}

// A rejection nobody handled is how this process dies without explaining
// itself. Report it, then let the platform restart us.
process.on("unhandledRejection", (reason) => {
  reportJobFailure("process", undefined, reason);
});
process.on("uncaughtException", (error) => {
  reportJobFailure("process", undefined, error);
  void Sentry.flush(2000).then(() => process.exit(1));
});

const server = serve({ fetch: createServer(ctx, queues, connection).fetch, port: env.WORKER_PORT });
console.log(`worker listening on :${env.WORKER_PORT}, provider=${ctx.linkedin.name}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, draining`);
  server.close();
  // Flush before the queues close, or a failure during shutdown never reports.
  await Sentry.flush(2000);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
