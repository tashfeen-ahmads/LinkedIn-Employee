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
import { billingConfigured, trialEnforced } from "@le/billing";
import type { CampaignTickJob, DigestJob, InboundMessageJob, LinkedInActionJob, StrategyJob, TargetingJob } from "./queues.js";
import { rescheduleJob, runCampaignTick } from "./jobs/campaign-tick.js";
import { runLinkedInAction, RescheduleError } from "./jobs/linkedin-action.js";
import { handleInboundMessage } from "./jobs/inbound.js";
import { runStrategyJob } from "./jobs/strategy.js";
import { runTargetingJob } from "./jobs/targeting.js";
import { detectAcceptedInvitations } from "./jobs/acceptance.js";
import { pollInbound } from "./jobs/inbound-poll.js";
import { startPendingSearches } from "./jobs/pending-searches.js";
import { refillCampaigns } from "./jobs/refill.js";
import { planEngagement } from "./jobs/engagement.js";
import { publishApprovedPosts } from "./jobs/publish-posts.js";
import { recoverThrottledProspects, unstickProspects } from "./jobs/unstick.js";
import { recoverAccounts } from "./accounts.js";
import { ensureWebhooks } from "./webhooks.js";
import { cleanFailedJobs, runMaintenance } from "./jobs/maintenance.js";
import { fillMissingNotes } from "./jobs/rewrite-notes.js";
import { withdrawStaleInvites } from "./jobs/withdraw.js";
import { repairCopy, repairSeededLines } from "./jobs/repair-copy.js";
import { fillFirstMessages } from "./jobs/first-message.js";
import { releaseDuplicateAccounts } from "./jobs/duplicate-accounts.js";
import { seedMissingAgents } from "./jobs/seed-agent.js";
import { runDailyDigest } from "./jobs/digest.js";
import { runWeeklyReport } from "./jobs/weekly-report.js";
import { runLifecycleEmails } from "./jobs/lifecycle.js";
import { deliverAnnouncement } from "./jobs/announcements.js";
import { sweepSupportTickets } from "./jobs/support.js";
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
  // Whether this worker ends trials, which only a deployment that can take a
  // payment does. The web app holds no Stripe secrets and reads this, so the
  // banner never says "your trial has ended" while this process keeps sending,
  // or the other way round.
  billingConfigured: billingConfigured(process.env),
  trialEnforced: trialEnforced(process.env),
});

/*
 * Every workspace that has told us about its business gets an agent.
 *
 * At boot rather than only nightly, because the workspaces that need this are
 * the ones that onboarded before agents existed — they would otherwise open
 * the screen, find it empty, and be handed the blank form the seeding was
 * written to remove. A deploy fixes it; waiting until three in the morning
 * does not.
 *
 * Awaited but never fatal. A worker that refuses to start because a
 * convenience failed is a worker that sends nobody anything.
 */
try {
  const seeded = await seedMissingAgents(ctx.db);
  if (seeded) console.log("seeded agents for workspaces that had none", { seeded });
} catch (err) {
  console.error("could not sweep for missing agents", {
    reason: err instanceof Error ? err.message : String(err),
  });
}

/*
 * And every account that is not working gets asked about, for the reason
 * directly above: a deploy fixes it, waiting until three in the morning does
 * not.
 *
 * This already runs hourly and nightly. Adding it to boot costs one list call
 * and closes the window a deploy opens — the hourly beat is scheduled from
 * whenever it last fired, so a worker that has just restarted can sit for the
 * best part of an hour before asking anything. Every hour of that is an hour
 * of a reconnected account still reported dead, which is this deployment's
 * entire history: reconnect in the evening, nothing until the sweep.
 *
 * It also writes down the ids when the provider holds accounts that carry
 * nobody's reference, which is the state no automatic path can repair and the
 * one where somebody needs the ids in front of them.
 *
 * Awaited but never fatal, exactly as the seeding above.
 */
try {
  const { checked, repaired, unreachable } = await recoverAccounts(ctx.db, ctx.linkedin);
  if (unreachable) console.error("could not ask the provider about accounts at boot", { unreachable });
  else if (repaired) console.log("repaired accounts the provider had replaced", { checked, repaired });
} catch (err) {
  console.error("could not sweep for replaced accounts", {
    reason: err instanceof Error ? err.message : String(err),
  });
}

/*
 * The provider calls us with the secret it is supposed to carry. Registered by
 * the worker rather than by a person in a dashboard, which is how every
 * prospect reply came to be refused for days. Never fatal, and never pointed
 * at a local address — a developer's worker must not take the live webhooks.
 */
if (!/localhost|127\.0\.0\.1/.test(ctx.env.WORKER_URL)) {
  try {
    const outcome = await ensureWebhooks(ctx.db, ctx.linkedin, {
      workerUrl: ctx.env.WORKER_URL,
      secret: ctx.env.UNIPILE_WEBHOOK_SECRET,
    });
    console.log("webhooks", { outcome });
  } catch (err) {
    console.error("could not register webhooks", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/*
 * Replies the webhook may have missed, asked for once at boot rather than a
 * quarter of an hour later — a deploy is usually what fixed whatever was
 * dropping them. Never fatal.
 */
if (queueOk) {
  try {
    const polled = await pollInbound(ctx, queues);
    console.log("polled for replies at boot", polled);
  } catch (err) {
    console.error("could not poll for replies at boot", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/*
 * The two repairs the night also runs, once at boot as well: a deploy that
 * fixes something should not leave the operator's Issues tab reporting the old
 * fault until 3am. Both are cheap when there is nothing to do — one query and
 * one Redis call — and neither blocks the API, which is already listening.
 */
if (queueOk) {
  void cleanFailedJobs(queues)
    .then((removed) => console.log("removed old failed jobs at boot", { removed }))
    .catch((err) => console.error("could not clean failed jobs at boot", err));
}
// Copy written before the voice check existed is rewritten now rather than
// sent as stored for another day (rule 66).
// A duplicate provider account is a bill every month; the first check is now.
void releaseDuplicateAccounts(ctx)
  .then((tally) => console.log("released duplicate provider accounts at boot", tally))
  .catch((err) => console.error("could not release duplicate provider accounts at boot", err));
void repairSeededLines(ctx)
  .then((tally) => console.log("rewrote seeded offers and openers at boot", tally))
  .catch((err) => console.error("could not rewrite seeded lines at boot", err))
  .then(() => repairCopy(ctx))
  .then((tally) => console.log("repaired stored copy at boot", tally))
  .catch((err) => console.error("could not repair stored copy at boot", err))
  // After the repair, so a note it cleared is written again now.
  .then(() => fillMissingNotes(ctx))
  .then((written) => console.log("filled missing invitation notes at boot", { written }))
  .catch((err) => console.error("could not fill missing notes at boot", err))
  .then(() => fillFirstMessages(ctx))
  .then((written) => console.log("wrote first messages at boot", { written }))
  .catch((err) => console.error("could not write first messages at boot", err));
// Tickets nobody has looked at, looked at now rather than within the hour.
void sweepSupportTickets(ctx)
  .then((tally) => console.log("support sweep at boot", tally))
  .catch((err) => console.error("could not sweep support tickets at boot", err));

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
  new Worker<TargetingJob>(QUEUE_NAMES.targeting, (job) => runTargetingJob(ctx, job.data, { final: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) }), {
    connection,
    concurrency: 2,
  }),
  new Worker<CampaignTickJob>(QUEUE_NAMES.campaignTick, () => runCampaignTick(ctx.db, queues, new Date(), ctx.linkedin), {
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
          // Through `rescheduleJob`, which writes the new due time into the
          // job's data: BullMQ keeps the original `timestamp` and makes `delay`
          // relative to now, so the pacing loop read their sum as due early.
          await rescheduleJob(job, err.retryAfterMs);
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
  /*
   * Three schedules share this queue, and the job's own name decides which
   * runs. Running the whole nightly sweep hourly would withdraw invitations and
   * send digests twelve times a day.
   */
  new Worker(
    QUEUE_NAMES.maintenance,
    (job) => {
      if (job.name === "acceptance") {
        // Notice who accepted, then put anybody whose next step went missing
        // back on the rails. Both are hourly because both decide whether a
        // warm prospect is written to today or never.
        return (
          detectAcceptedInvitations(ctx)
            // After the acceptance poll, so a yes from this hour is never
            // withdrawn; and hourly inside each owner's working hours, a few
            // at a time, so an account's pile of unanswered invitations stays
            // below the point where LinkedIn stops taking new ones (rule 70).
            .then(() => withdrawStaleInvites(ctx).catch((err) => console.error("withdrawing invitations failed", err)))
            .then(() => unstickProspects(ctx.db))
            // A strategy approved before LinkedIn was connected, still waiting
            // for the search the connect should have started.
            .then(() => startPendingSearches(ctx, queues))
            // A running campaign down to two days of people looks for more on
            // its own, rather than waiting for somebody to press Find more.
            // Caught here, so a refill that throws never costs the repairs
            // below their hour (rule 8).
            .then(() => refillCampaigns(ctx, queues).catch((err) => console.error("refill failed", err)))
            // Hourly, so people a refill added without a note, or whose note
            // the nightly repair cleared, get one within the hour rather than
            // the campaign's standard line.
            .then(() => fillMissingNotes(ctx).catch((err) => console.error("filling notes failed", err)))
            // A throttle lifts on its own schedule, so the rows it wrote off
            // are checked on the same hourly beat rather than waiting for the
            // night.
            .then(() => recoverThrottledProspects(ctx.db))
            /*
             * An account whose provider id has moved is repaired within the
             * hour, not overnight.
             *
             * This was nightly, and nightly is the wrong cadence for the one
             * failure that stops everything: a rep reconnects, the provider
             * issues a new account id, and until this runs the row holds a
             * dead one — every job failing against it, the campaign reporting
             * `running`, and nobody sending. Between a reconnect at six in the
             * evening and the sweep at three in the morning, this product does
             * nothing and says nothing.
             *
             * Cheap enough to do hourly: one list call, and each row only
             * touched when what the provider holds disagrees with it.
             */
            .then(() => recoverAccounts(ctx.db, ctx.linkedin))
            // Support tickets the immediate hand-off missed — a worker that
            // was restarting, a model that was down.
            .then(() => sweepSupportTickets(ctx))
            // Likes and comments on prospects' recent posts, a handful an hour
            // inside each owner's working hours (rule 68). Last, and caught:
            // it reads posts and writes comments for every account, and none
            // of that may hold up the repairs above.
            .then(() => planEngagement(ctx, queues).catch((err) => console.error("engagement planning failed", err)))
            .then(() => undefined)
        );
      }
      if (job.name === "inbound-poll") {
        // Replies the webhook did not deliver, found by asking.
        return pollInbound(ctx, queues).then(() => undefined);
      }
      if (job.name === "posts") {
        // Every quarter of an hour, because a post's time is one a person
        // chose and because the nightly slot is the one hour a post must not
        // go out in.
        return publishApprovedPosts(ctx).then(() => undefined);
      }
      return runMaintenance(ctx, queues);
    },
    { connection, concurrency: 1 },
  ),
  /*
   * Two schedulers, one queue, and the job's own name decides which runs.
   *
   * A second queue would mean a second worker, a second connection and a second
   * thing to notice has stopped. These are the same kind of work — write an
   * email about what happened — differing only in the window they describe.
   */
  new Worker<DigestJob>(
    QUEUE_NAMES.digest,
    async (job) => {
      if (job.name === "weekly-report") return runWeeklyReport(ctx);
      if (job.name === "lifecycle") return void (await runLifecycleEmails(ctx));
      if (job.name === "announcement") {
        // Never without an id: a nameless "announcement" job must not become
        // the daily digest by falling through to the default below.
        if (!job.data.announcementId) return;
        return void (await deliverAnnouncement(ctx, job.data.announcementId));
      }
      return runDailyDigest(ctx);
    },
    { connection, concurrency: 1 },
  ),
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
