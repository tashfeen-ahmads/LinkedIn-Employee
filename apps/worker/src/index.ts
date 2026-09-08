import { serve } from "@hono/node-server";
import { Worker } from "bullmq";
import { loadEnv } from "./config.js";
import { createWorkerContext } from "./context.js";
import { createConnection, createQueues, QUEUE_NAMES, scheduleRepeatables } from "./queues.js";
import type { CampaignTickJob, InboundMessageJob, LinkedInActionJob, StrategyJob, TargetingJob } from "./queues.js";
import { runCampaignTick } from "./jobs/campaign-tick.js";
import { runLinkedInAction, RescheduleError } from "./jobs/linkedin-action.js";
import { handleInboundMessage } from "./jobs/inbound.js";
import { runStrategyJob } from "./jobs/strategy.js";
import { runTargetingJob } from "./jobs/targeting.js";
import { runMaintenance } from "./jobs/maintenance.js";
import { createServer } from "./server.js";

const env = loadEnv();
const ctx = createWorkerContext(env);
const connection = createConnection(env.REDIS_URL);
const queues = createQueues(connection);

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
  // Concurrency 1 on purpose: LinkedIn actions are paced, and parallel workers
  // would race the per-account counters the limiter reads.
  new Worker<LinkedInActionJob>(
    QUEUE_NAMES.linkedinAction,
    async (job) => {
      try {
        await runLinkedInAction(ctx, job.data);
      } catch (err) {
        if (err instanceof RescheduleError) {
          await job.moveToDelayed(Date.now() + err.retryAfterMs, job.token);
          return;
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
  new Worker(QUEUE_NAMES.maintenance, () => runMaintenance(ctx), { connection, concurrency: 1 }),
];

for (const worker of workers) {
  worker.on("failed", (job, err) => console.error(`[${worker.name}] job ${job?.id} failed:`, err.message));
}

const server = serve({ fetch: createServer(ctx, queues).fetch, port: env.WORKER_PORT });
console.log(`worker listening on :${env.WORKER_PORT}, provider=${ctx.linkedin.name}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, draining`);
  server.close();
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
