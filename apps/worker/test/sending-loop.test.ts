import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LINKEDIN_LIMITS, PACING_LAST_ACTION, normalizeExclusionValue } from "@le/shared";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { runCampaignTick } from "../src/jobs/campaign-tick.js";
import { RescheduleError, runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { sendOneNow } from "../src/jobs/send-one.js";
import { runMaintenance } from "../src/jobs/maintenance.js";
import { resetCountersIfNeeded, type AccountRecord } from "../src/accounts.js";
import type { WorkerContext } from "../src/context.js";
import type { LinkedInActionJob, Queues } from "../src/queues.js";

/*
 * The sending loop and the one path every send goes through, exercised
 * together.
 *
 * Every bug in this file was invisible to a test of either half on its own:
 * the loop queued work the job then declined, the job declined in a way the
 * loop read as work, a cap was budgeted where work is scheduled and nowhere it
 * is sent. So these run the job, not only the enqueue — the queue below keeps
 * what it is given, and `drain` runs it the way the worker would.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const OTHER_CAMPAIGN = "44444444-4444-4444-8444-4444444444bb";

// A Wednesday, mid-afternoon in UTC.
const NOW = new Date("2026-10-07T13:00:00Z");
const HOUR = 3_600_000;

interface StoredJob {
  name: string;
  data: LinkedInActionJob;
  state: string;
  timestamp: number;
  delay: number;
}

/**
 * Enough of a BullMQ queue to hold jobs between a tick and the worker: ids
 * dedupe, states are readable, finished jobs can be removed, and pending ones
 * can be listed — the four things the loop asks of the real one.
 */
function memoryQueue() {
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

/** Runs every pending job once, as the worker would, and marks it finished. */
async function drain(ctx: WorkerContext, jobs: Map<string, StoredJob>, kind?: LinkedInActionJob["kind"]) {
  for (const job of jobs.values()) {
    if (job.state !== "delayed" || (kind && job.data.kind !== kind)) continue;
    try {
      await runLinkedInAction(ctx, job.data);
      job.state = "completed";
    } catch (err) {
      if (!(err instanceof RescheduleError)) throw err;
    }
  }
}

function harness(
  options: {
    timezone?: string;
    cap?: number;
    warmUp?: boolean;
    firstActionAt?: string | null;
    account?: Record<string, unknown>;
  } = {},
) {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();
  db.seed("workspaces", [
    {
      id: WORKSPACE,
      plan: "trial",
      trial_ends_at: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
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
      counters_reset_on: "2026-10-07",
      last_action_at: null,
      // Every hour of every day: none of these tests is about working hours,
      // and the send path asks the limiter with the (faked) wall clock.
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
  db.seed("campaign_steps", [
    { campaign_id: CAMPAIGN, variant_id: null, step_number: 1, delay_days: 0, message: "Thanks, {{first_name}}." },
    { campaign_id: CAMPAIGN, variant_id: null, step_number: 2, delay_days: 4, message: "Closing the loop." },
  ]);
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
  /** A prospect on a campaign, queued unless told otherwise. */
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
        created_at: new Date(NOW.getTime() - (1000 - n) * 60_000).toISOString(),
        ...cp,
      },
    ]);
    return cpId;
  }

  return { db, ctx, linkedin, prospect };
}

const invite = (id: string): LinkedInActionJob => ({ kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });
const followUp = (id: string, step = 1): LinkedInActionJob => ({
  kind: "follow_up",
  workspaceId: WORKSPACE,
  campaignProspectId: id,
  stepNumber: step,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a warm-up that has gone stale", () => {
  it("is looked at again when the job runs, not declined", async () => {
    // The loop re-queues a view older than the warm-up window because the
    // familiarity it bought has gone. The job used to decline anything with a
    // `warmed_at` at all, so nobody ever looked again and the prospect sat in
    // `queued` for good.
    const { db, ctx, linkedin, prospect } = harness({ warmUp: true });
    const stale = new Date(NOW.getTime() - LINKEDIN_LIMITS.warmUpToInviteMaxMs - HOUR).toISOString();
    const id = prospect({ warmed_at: stale });

    await runLinkedInAction(ctx, { kind: "warm_up", workspaceId: WORKSPACE, campaignProspectId: id });

    expect(linkedin.viewedProfiles).toHaveLength(1);
    expect(db.find("campaign_prospects", { id })?.warmed_at).toBe(NOW.toISOString());
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.profile_views_today).toBe(1);
  });

  it("goes from the loop to a fresh view to an invitation, and is not counted as work twice", async () => {
    const { db, ctx, linkedin, prospect } = harness({ warmUp: true });
    const stale = new Date(NOW.getTime() - LINKEDIN_LIMITS.warmUpToInviteMaxMs - HOUR).toISOString();
    const id = prospect({ warmed_at: stale, next_action_at: stale });
    const { jobs, queues } = memoryQueue();

    // The loop: a stale warm is re-warmed rather than invited cold.
    expect(await runCampaignTick(db.asDb(), queues, NOW)).toBe(1);
    expect([...jobs.values()].map((j) => j.data.kind)).toEqual(["warm_up"]);

    // The worker: the view actually happens.
    await drain(ctx, jobs);
    expect(linkedin.viewedProfiles).toHaveLength(1);

    // The next tick finds nothing to do — the warm counts again and the
    // invitation is not due yet — and says so. It used to revive the finished
    // job every five minutes and stamp "warmed 1" as the last thing it did.
    db.rows("worker_heartbeats").length = 0;
    expect(await runCampaignTick(db.asDb(), queues, new Date(NOW.getTime() + 5 * 60_000))).toBe(0);
    expect(db.find("worker_heartbeats", { name: PACING_LAST_ACTION })).toBeUndefined();

    // Once the wait after the view has passed, the invitation goes.
    const due = Date.parse(db.find("campaign_prospects", { id })!.next_action_at as string);
    vi.setSystemTime(due + 60_000);
    expect(await runCampaignTick(db.asDb(), queues, new Date(due + 60_000))).toBe(1);
    vi.setSystemTime(due + 60_000 + 12 * HOUR);
    await drain(ctx, jobs, "invite");
    expect(linkedin.sentInvitations).toHaveLength(1);
    expect(db.find("campaign_prospects", { id })?.status).toBe("invited");
  });

  it("is not looked at twice while the first look still counts", async () => {
    const { ctx, linkedin, prospect } = harness({ warmUp: true });
    const id = prospect({ warmed_at: new Date(NOW.getTime() - HOUR).toISOString() });

    await runLinkedInAction(ctx, { kind: "warm_up", workspaceId: WORKSPACE, campaignProspectId: id });

    expect(linkedin.viewedProfiles).toHaveLength(0);
  });
});

describe("a warmed invitation is never placed after its warm-up stops counting", () => {
  it("lands inside the four-hour window even when the day's spread runs later", async () => {
    // A low cap over a 24-hour working day spreads invitations hours apart;
    // the view three and a half hours ago only counts for another thirty minutes.
    const { db, prospect } = harness({ warmUp: true, cap: 2 });
    const warmedAt = new Date(NOW.getTime() - 3.5 * HOUR).toISOString();
    prospect({ warmed_at: warmedAt, next_action_at: warmedAt });
    const { jobs, queues } = memoryQueue();

    expect(await runCampaignTick(db.asDb(), queues, NOW)).toBe(1);
    const placed = [...jobs.values()].find((j) => j.data.kind === "invite");
    expect(placed).toBeTruthy();
    expect(NOW.getTime() + (placed?.delay ?? 0)).toBeLessThan(Date.parse(warmedAt) + LINKEDIN_LIMITS.warmUpToInviteMaxMs);
  });
});

describe("a stale warm-up does not take a fresh one's place", () => {
  it("spends today's one invitation on the person whose view still counts", async () => {
    // One slot left. A view gone stale must not occupy it and then be skipped,
    // which would leave the day with nobody invited at all.
    const { db, prospect } = harness({ warmUp: true, cap: 1 });
    const stale = new Date(NOW.getTime() - LINKEDIN_LIMITS.warmUpToInviteMaxMs - HOUR).toISOString();
    const fresh = new Date(NOW.getTime() - HOUR).toISOString();
    prospect({ id: "cp-stale", warmed_at: stale, next_action_at: stale });
    prospect({ id: "cp-fresh", warmed_at: fresh, next_action_at: fresh });
    const { jobs, queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, NOW);
    const invited = [...jobs.values()].filter((j) => j.data.kind === "invite").map((j) => j.data.campaignProspectId);
    expect(invited).toEqual(["cp-fresh"]);
  });
});

describe("the never-twice check and this campaign's own invitation", () => {
  it("leaves somebody this campaign already invited exactly as they are", async () => {
    // A second job for the same row — Send one now taking somebody whose
    // delayed job was still queued, or a finished job revived — used to close
    // them as "already contacted" and take them out of their own follow-ups.
    const { db, ctx, linkedin, prospect } = harness();
    const id = prospect({ status: "invited", invited_at: NOW.toISOString() }, { last_contacted_at: NOW.toISOString() });

    await runLinkedInAction(ctx, invite(id));

    const row = db.find("campaign_prospects", { id })!;
    expect(row.status).toBe("invited");
    expect(row.status_reason ?? null).toBeNull();
    expect(linkedin.sentInvitations).toHaveLength(0);
  });

  it("survives Send one now racing the job the loop already queued", async () => {
    const { db, ctx, linkedin, prospect } = harness();
    const id = prospect();
    const { jobs, queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, NOW);
    expect(jobs.size).toBe(1);

    const sent = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });
    expect(sent.ok).toBe(true);

    // Later, the delayed job the tick placed fires for the same person.
    vi.setSystemTime(NOW.getTime() + 12 * HOUR);
    await drain(ctx, jobs);

    expect(linkedin.sentInvitations).toHaveLength(1);
    expect(db.find("campaign_prospects", { id })?.status).toBe("invited");
  });

  it("does not close a row that moved after the job read it", async () => {
    // The close is decided on the status the job read. If another job invites
    // the person in between, the close must match nothing rather than
    // overwrite `invited`.
    const { db, ctx, prospect } = harness();
    const id = prospect({}, { do_not_contact: false, company: "Excluded Co" });
    db.seed("exclusions", [
      {
        workspace_id: WORKSPACE,
        kind: "company",
        value: normalizeExclusionValue("company", "Excluded Co"),
        raw_value: "Excluded Co",
        reason: null,
      },
    ]);
    const realFrom = db.from.bind(db);
    db.from = (table: string) => {
      // The moment the job reads the exclusion list, somebody else sends.
      // Replaced rather than mutated: the double hands out its own row
      // objects, and mutating one would change what the job already read.
      if (table === "exclusions") {
        const rows = db.tables.get("campaign_prospects")!;
        const at = rows.findIndex((row) => row.id === id);
        rows[at] = { ...rows[at], status: "invited" };
      }
      return realFrom(table);
    };

    await runLinkedInAction(ctx, invite(id));

    expect(db.find("campaign_prospects", { id })?.status).toBe("invited");
  });

  it("still closes somebody a different campaign has already contacted", async () => {
    // Rule 24 is unchanged for the case it was written for.
    const { db, ctx, linkedin, prospect } = harness();
    const id = prospect({}, { last_contacted_at: "2026-10-01T10:00:00Z" });

    await runLinkedInAction(ctx, invite(id));

    expect(db.find("campaign_prospects", { id })?.status).toBe("closed");
    expect(linkedin.sentInvitations).toHaveLength(0);
  });
});

describe("the counters' day is the rep's day", () => {
  it("does not reset at UTC midnight for a rep in California", async () => {
    // 01:00 UTC on Thursday is 18:00 on Wednesday in Los Angeles. The UTC date
    // has rolled over; the rep's has not, and neither may their allowance.
    const at = new Date("2026-10-08T01:00:00Z");
    vi.setSystemTime(at);
    const { db, prospect } = harness({ timezone: "America/Los_Angeles", account: { invites_today: 10 } });
    prospect();
    const { queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, at);

    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.counters_reset_on).toBe("2026-10-07");
    expect(account.invites_today).toBe(10);
  });

  it("resets at the rep's own midnight", async () => {
    // 08:00 UTC on Thursday is one in the morning in Los Angeles.
    const at = new Date("2026-10-08T08:00:00Z");
    vi.setSystemTime(at);
    const { db, prospect } = harness({ timezone: "America/Los_Angeles", account: { invites_today: 10 } });
    prospect();
    const { queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, at);

    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.counters_reset_on).toBe("2026-10-08");
    expect(account.invites_today).toBe(0);
  });

  it("never resets backwards onto a date the row has already passed", async () => {
    // A row stamped under the old UTC rule can be a day ahead of the rep.
    // Resetting it again would hand out a second allowance in one day.
    const { db } = harness({ account: { counters_reset_on: "2026-10-08", invites_today: 7 } });
    const row = db.find("linkedin_accounts", { id: ACCOUNT }) as unknown as AccountRecord;

    const after = await resetCountersIfNeeded(db.asDb(), { ...row }, "2026-10-07");

    expect(after.invites_today).toBe(7);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.invites_today).toBe(7);
  });

  it("does not erase a count somebody else's reset already made room for", async () => {
    // Two callers read yesterday's stamp; the first resets and an invitation
    // is counted; the second must not zero that invitation away.
    const { db } = harness({ account: { counters_reset_on: "2026-10-06", invites_today: 9 } });
    const stale = { ...(db.find("linkedin_accounts", { id: ACCOUNT }) as unknown as AccountRecord) };
    const live = db.find("linkedin_accounts", { id: ACCOUNT })!;
    Object.assign(live, { counters_reset_on: "2026-10-07", invites_today: 1 });

    const after = await resetCountersIfNeeded(db.asDb(), stale, "2026-10-07");

    expect(after.invites_today).toBe(1);
    expect(live.invites_today).toBe(1);
  });

  it("rolls the day over on the send path too, for an account the loop no longer visits", async () => {
    // No running campaign means no tick for this account, and a follow-up job
    // judged on the last campaign day's total was refused for ever.
    const { db, ctx, linkedin, prospect } = harness({
      account: { counters_reset_on: "2026-09-30", messages_today: LINKEDIN_LIMITS.messagesPerDay },
    });
    const id = prospect({ status: "accepted", next_action_at: NOW.toISOString() });

    await runLinkedInAction(ctx, followUp(id));

    expect(linkedin.sentMessages).toHaveLength(1);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.counters_reset_on).toBe("2026-10-07");
  });
});

describe("a campaign's daily cap is a daily cap", () => {
  it("counts what this campaign already sent today", async () => {
    const { db, prospect } = harness({ cap: 3 });
    prospect({ status: "invited", invited_at: new Date(NOW.getTime() - 2 * HOUR).toISOString() });
    prospect({ status: "invited", invited_at: new Date(NOW.getTime() - HOUR).toISOString() });
    for (let i = 0; i < 5; i++) prospect();
    const { jobs, queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, NOW);

    expect(jobs.size).toBe(1);
  });

  it("counts what is already queued, so a later tick does not queue the day again", async () => {
    // The trickle that made the cap decorative: two people eligible at the
    // first tick, more at the next, and each tick budgeting from the full cap.
    const { db, prospect } = harness({ cap: 3 });
    const later = new Date(NOW.getTime() + 30 * 60_000).toISOString();
    for (let i = 0; i < 3; i++) prospect({ next_action_at: later });
    prospect();
    prospect();
    const { jobs, queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, NOW);
    expect(jobs.size).toBe(2);

    const next = new Date(NOW.getTime() + 35 * 60_000);
    vi.setSystemTime(next);
    await runCampaignTick(db.asDb(), queues, next);

    expect(jobs.size).toBe(3);
  });

  it("shares the account's allowance between campaigns on one account", async () => {
    // A never-used account starts at the bottom of the ramp. Two campaigns
    // each reading the account's whole allowance used to queue it twice.
    const { db, prospect } = harness({ firstActionAt: null, cap: 20 });
    db.seed("campaigns", [
      { ...db.find("campaigns", { id: CAMPAIGN })!, id: OTHER_CAMPAIGN },
    ]);
    for (let i = 0; i < 15; i++) prospect();
    for (let i = 0; i < 15; i++) prospect({ campaign_id: OTHER_CAMPAIGN });
    const { jobs, queues } = memoryQueue();

    await runCampaignTick(db.asDb(), queues, NOW);
    await runCampaignTick(db.asDb(), queues, new Date(NOW.getTime() + 5 * 60_000));

    expect(jobs.size).toBe(LINKEDIN_LIMITS.invitesPerDayStart);
  });

  it("holds the cap at the moment of sending, so Send one now cannot pass it", async () => {
    const { db, ctx, linkedin, prospect } = harness({ cap: 1 });
    prospect({ status: "invited", invited_at: new Date(NOW.getTime() - HOUR).toISOString() });
    const id = prospect();

    await expect(runLinkedInAction(ctx, invite(id))).rejects.toMatchObject({ reason: "campaign_daily_cap" });
    expect(linkedin.sentInvitations).toHaveLength(0);
    expect(db.find("campaign_prospects", { id })?.status).toBe("queued");
  });
});

describe("a held backlog never drains at a fixed cadence", () => {
  it("jitters the wait after LinkedIn's hold", async () => {
    const until = new Date(NOW.getTime() + 2 * HOUR).toISOString();
    const { ctx, prospect } = harness({ account: { invites_paused_until: until } });
    const a = prospect();
    const b = prospect();
    const random = vi.spyOn(Math, "random");

    random.mockReturnValue(0);
    const first = await runLinkedInAction(ctx, invite(a)).catch((err: RescheduleError) => err.retryAfterMs);
    random.mockReturnValue(0.9);
    const second = await runLinkedInAction(ctx, invite(b)).catch((err: RescheduleError) => err.retryAfterMs);

    // Never before the hold lifts, never all at the instant it does.
    expect(first).toBeGreaterThanOrEqual(2 * HOUR + LINKEDIN_LIMITS.minGapMs);
    expect(second).not.toBe(first);
  });

  it("jitters a too-soon refusal instead of retrying at exactly the floor", async () => {
    const { ctx, prospect } = harness({ account: { last_action_at: new Date(NOW.getTime() - 60_000).toISOString() } });
    const id = prospect();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const wait = await runLinkedInAction(ctx, invite(id)).catch((err: RescheduleError) => err.retryAfterMs);

    const floor = LINKEDIN_LIMITS.minGapMs - 60_000;
    expect(wait).toBeGreaterThan(floor);
    expect(wait).toBeLessThanOrEqual(floor + LINKEDIN_LIMITS.maxGapMs - LINKEDIN_LIMITS.minGapMs);
  });
});

describe("a sequence ends where this person's sequence ends", () => {
  it("closes somebody on an angle whose own sequence is finished", async () => {
    // Every step on the campaign was counted, angles and all, so on a campaign
    // with angles nobody was ever closed.
    const { db, ctx, prospect } = harness();
    db.seed("campaign_steps", [
      { campaign_id: CAMPAIGN, variant_id: "angle-a", step_number: 1, delay_days: 0, message: "A1" },
      { campaign_id: CAMPAIGN, variant_id: "angle-b", step_number: 1, delay_days: 0, message: "B1" },
      { campaign_id: CAMPAIGN, variant_id: "angle-b", step_number: 2, delay_days: 3, message: "B2" },
    ]);
    const done = prospect({ status: "messaged_1", last_step_sent: 1, variant_id: "angle-a" });
    const midway = prospect({ status: "messaged_1", last_step_sent: 1, variant_id: "angle-b" });
    const plain = prospect({ status: "messaged_2", last_step_sent: 2 });

    await runMaintenance(ctx, memoryQueue().queues, NOW);

    expect(db.find("campaign_prospects", { id: done })?.status).toBe("closed");
    expect(db.find("campaign_prospects", { id: midway })?.status).toBe("messaged_1");
    expect(db.find("campaign_prospects", { id: plain })?.status).toBe("closed");
  });
});

describe("a follow-up the provider could not deliver", () => {
  it("is tried again after a transient failure rather than written off", async () => {
    const { db, ctx, linkedin, prospect } = harness();
    const id = prospect({ status: "accepted", next_action_at: NOW.toISOString(), accepted_at: NOW.toISOString() });
    linkedin.sendMessage = async () => ({ ok: false, error: "Unipile POST /api/v1/chats failed with 503" });

    await runLinkedInAction(ctx, followUp(id));

    const row = db.find("campaign_prospects", { id })!;
    expect(row.status).toBe("accepted");
    expect(Date.parse(row.next_action_at as string)).toBeGreaterThan(NOW.getTime());
  });

  it("still fails on a refusal nobody recognises", async () => {
    const { db, ctx, linkedin, prospect } = harness();
    const id = prospect({ status: "accepted", next_action_at: NOW.toISOString() });
    linkedin.sendMessage = async () => ({ ok: false, error: "422 recipient cannot be messaged" });

    await runLinkedInAction(ctx, followUp(id));

    expect(db.find("campaign_prospects", { id })?.status).toBe("failed");
  });
});

describe("a send the provider accepted is never repeated", () => {
  function failCountsOnce(db: FakeDb) {
    const real = db.rpc.bind(db);
    let failed = false;
    db.rpc = async (name, args) => {
      if (!failed) {
        failed = true;
        return { data: null, error: { message: "connection reset" } };
      }
      return real(name, args);
    };
  }

  it("does not invite twice when counting the invitation fails", async () => {
    const { db, ctx, linkedin, prospect } = harness();
    const id = prospect();
    failCountsOnce(db);

    // Rule 2: a failed count still raises...
    await expect(runLinkedInAction(ctx, invite(id))).rejects.toThrow(/could not record invite/);
    // ...and the retry finds the invitation already written down.
    await runLinkedInAction(ctx, invite(id));

    expect(linkedin.sentInvitations).toHaveLength(1);
    expect(db.find("campaign_prospects", { id })?.status).toBe("invited");
  });

  it("does not send a follow-up twice when counting it fails", async () => {
    const { db, ctx, linkedin, prospect } = harness();
    const id = prospect({ status: "accepted", next_action_at: NOW.toISOString() });
    failCountsOnce(db);

    await expect(runLinkedInAction(ctx, followUp(id))).rejects.toThrow(/could not record message/);
    await runLinkedInAction(ctx, followUp(id));

    expect(linkedin.sentMessages).toHaveLength(1);
    expect(db.find("campaign_prospects", { id })?.status).toBe("messaged_1");
  });
});

describe("a follow-up held for a pitch", () => {
  it("mints no booking link while it is held", async () => {
    // Revived by the loop until somebody approves a pitch; each revival used
    // to write a fresh booking link — a live credential for a message that
    // never went anywhere.
    const { db, ctx, linkedin, prospect } = harness();
    db.find("campaigns", { id: CAMPAIGN })!.cta_kind = "meeting";
    db.rows("campaign_steps")[0]!.message = "{{pitch}} Grab a time: {{cta_link}}";
    db.seed("pitches", [
      { id: "pitch-1", workspace_id: WORKSPACE, body: "Referrals, followed up.", approved_at: null, is_default: true },
    ]);
    const id = prospect({ status: "accepted", next_action_at: NOW.toISOString() });

    await runLinkedInAction(ctx, followUp(id));
    await runLinkedInAction(ctx, followUp(id));

    expect(linkedin.sentMessages).toHaveLength(0);
    expect(db.rows("booking_links")).toHaveLength(0);
  });
});
