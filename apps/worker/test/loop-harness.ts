import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { RescheduleError, runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { jobDueAt } from "../src/jobs/campaign-tick.js";
import type { WorkerContext } from "../src/context.js";
import type { LinkedInActionJob, Queues } from "../src/queues.js";

/*
 * The sending loop and the send path, run together over hours of simulated
 * time: a queue that keeps what it is given, and `drain`, which runs what is
 * due the way the worker would — including putting a refused job back on the
 * queue for when the limiter said to try again. Shared by the tests that need
 * a day or a week to show what they are about.
 */

export const WORKSPACE = "11111111-1111-4111-8111-111111111111";
export const USER = "22222222-2222-4222-8222-222222222222";
export const ACCOUNT = "33333333-3333-4333-8333-333333333333";
export const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
export const HOUR = 3_600_000;

export interface StoredJob {
  name: string;
  data: LinkedInActionJob;
  state: string;
  timestamp: number;
  delay: number;
}

export function memoryQueue() {
  const jobs = new Map<string, StoredJob>();
  const queue = {
    add: async (name: string, data: LinkedInActionJob, opts: { jobId: string; delay?: number }) => {
      if (jobs.has(opts.jobId)) return { id: opts.jobId };
      jobs.set(opts.jobId, { name, data, state: "delayed", timestamp: Date.now(), delay: opts.delay ?? 0 });
      return { id: opts.jobId };
    },
    getJob: async (id: string) => {
      const job = jobs.get(id);
      if (!job) return undefined;
      return { getState: async () => job.state, remove: async () => void jobs.delete(id) };
    },
    getJobs: async (types: readonly string[]) =>
      [...jobs.values()]
        .filter((job) => types.includes(job.state))
        .map((job) => ({ name: job.name, data: job.data, timestamp: job.timestamp, delay: job.delay })),
    getJobCounts: async () => ({ delayed: [...jobs.values()].filter((j) => j.state === "delayed").length }),
  };
  return { queue, jobs, queues: { linkedinAction: queue } as unknown as Queues };
}

/** Runs every pending job (optionally only those due by `until`), as the worker would. */
export async function drain(
  ctx: WorkerContext,
  jobs: Map<string, StoredJob>,
  kind?: LinkedInActionJob["kind"],
  until?: number,
) {
  for (const job of jobs.values()) {
    if (job.state !== "delayed" || (kind && job.data.kind !== kind)) continue;
    if (until !== undefined && jobDueAt(job, new Date()) > until) continue;
    try {
      await runLinkedInAction(ctx, job.data);
      job.state = "completed";
    } catch (err) {
      if (!(err instanceof RescheduleError)) throw err;
      // As the worker does (`rescheduleJob`): the due time into the data, then
      // moveToDelayed(now + retryAfter) — which in BullMQ 5 leaves
      // `timestamp` at the original add and makes `delay` relative to now.
      job.data = { ...job.data, dueAt: Date.now() + err.retryAfterMs } as LinkedInActionJob;
      job.delay = err.retryAfterMs;
    }
  }
}

export function harness(
  now: Date,
  options: {
    timezone?: string;
    cap?: number;
    warmUp?: boolean;
    firstActionAt?: string | null;
    account?: Record<string, unknown>;
    steps?: Array<Record<string, unknown>>;
  } = {},
) {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();
  db.seed("workspaces", [
    {
      id: WORKSPACE,
      plan: "trial",
      trial_ends_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      subscription_status: null,
      seats: 1,
    },
  ]);
  db.seed("profiles", [{ id: USER, full_name: "Rep Person", timezone: options.timezone ?? "UTC" }]);
  db.seed("linkedin_accounts", [
    {
      id: ACCOUNT,
      workspace_id: WORKSPACE,
      user_id: USER,
      provider_account_id: "acct",
      status: "active",
      connected_at: "2026-06-01T09:00:00Z",
      first_action_at: options.firstActionAt === undefined ? "2026-06-01T09:00:00Z" : options.firstActionAt,
      invites_today: 0,
      invites_this_week: 0,
      messages_today: 0,
      profile_views_today: 0,
      counters_reset_on: now.toISOString().slice(0, 10),
      last_action_at: null,
      working_hours: { start: 0, end: 24, days: [0, 1, 2, 3, 4, 5, 6] },
      invites_paused_until: null,
      invites_paused_reason: null,
      invite_throttle_streak: 0,
      ...options.account,
    },
  ]);
  db.seed("campaigns", [
    {
      id: CAMPAIGN,
      workspace_id: WORKSPACE,
      status: "running",
      linkedin_account_id: ACCOUNT,
      owner_user_id: USER,
      connection_note: "Hi {{first_name}}.",
      daily_invite_cap: options.cap ?? 20,
      warm_up: options.warmUp ?? false,
      cta_kind: "conversation",
      cta_url: null,
    },
  ]);
  db.seed(
    "campaign_steps",
    options.steps ?? [
      { campaign_id: CAMPAIGN, variant_id: null, step_number: 1, delay_days: 0, message: "Thanks, {{first_name}}." },
      { campaign_id: CAMPAIGN, variant_id: null, step_number: 2, delay_days: 4, message: "Closing the loop." },
    ],
  );
  db.seed("events", []);
  db.seed("exclusions", []);
  db.seed("worker_heartbeats", []);

  const ctx = {
    db: db.asDb(),
    linkedin,
    email: null,
    env: { APP_URL: "https://app.test" } as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  let n = 0;
  function prospect(cp: Record<string, unknown> = {}, person: Record<string, unknown> = {}): string {
    n += 1;
    const prospectId = `p-${n}`;
    const cpId = (cp.id as string | undefined) ?? `cp-${n}`;
    db.seed("prospects", [
      {
        id: prospectId,
        workspace_id: WORKSPACE,
        provider_id: `prov-${n}`,
        linkedin_url: `https://www.linkedin.com/in/person-${n}`,
        first_name: `Person${n}`,
        company: "Northwind",
        do_not_contact: false,
        last_contacted_at: null,
        ...person,
      },
    ]);
    db.seed("campaign_prospects", [
      {
        id: cpId,
        workspace_id: WORKSPACE,
        campaign_id: CAMPAIGN,
        prospect_id: prospectId,
        status: "queued",
        last_step_sent: 0,
        next_action_at: null,
        warmed_at: null,
        invite_note: null,
        variant_id: null,
        invited_at: null,
        accepted_at: null,
        created_at: new Date(now.getTime() - (1000 - n) * 60_000).toISOString(),
        ...cp,
      },
    ]);
    return cpId;
  }

  return { db, ctx, linkedin, prospect };
}
