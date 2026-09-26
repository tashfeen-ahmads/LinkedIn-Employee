import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { runCampaignTick } from "../src/jobs/campaign-tick.js";
import type { Queues } from "../src/queues.js";

/*
 * The loop spreading a day's invitations across the day.
 *
 * `spreadGapMs` is tested on its own in @le/linkedin; this is the wiring,
 * which is where it cost something real. A pace that is correct in a pure
 * function and not consulted by the loop is a pace that does nothing, and that
 * gap is invisible to a unit test of either half.
 *
 * The bill: this deployment's first live account sent seven connection
 * requests between 16:52 and 17:19 on the first day it had ever sent anything,
 * because the ramp said how many and nothing said when. LinkedIn throttled
 * invitations from it and was still refusing five days later.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

/** A Wednesday at nine, with eight hours of an 8-to-6 day ahead. */
const MORNING = new Date("2026-09-23T09:00:00Z");

function fakeQueues() {
  const added: Array<{ data: Record<string, unknown>; opts: { delay?: number } }> = [];
  const queue = {
    add: async (_name: string, data: Record<string, unknown>, opts: { delay?: number } = {}) => {
      added.push({ data, opts });
      return { id: "job" };
    },
    getJob: async () => undefined,
    getJobCounts: async () => ({ waiting: 0, delayed: added.length }),
  };
  return { queues: { linkedinAction: queue } as unknown as Queues, added };
}

/** `count` warmed prospects, all due now, on a campaign that is not warming. */
function harness(count: number, now: Date) {
  const db = new FakeDb();
  db.seed("campaigns", [
    {
      id: CAMPAIGN,
      workspace_id: WORKSPACE,
      status: "running",
      linkedin_account_id: ACCOUNT,
      owner_user_id: USER,
      daily_invite_cap: count,
      warm_up: false,
    },
  ]);
  db.seed("linkedin_accounts", [
    {
      id: ACCOUNT,
      workspace_id: WORKSPACE,
      user_id: USER,
      provider_account_id: "acct-1",
      status: "active",
      connected_at: "2026-09-01T09:00:00Z",
      // Fully warmed, so the ramp is not what limits this test.
      first_action_at: "2026-07-01T09:00:00Z",
      invites_today: 0,
      invites_this_week: 0,
      messages_today: 0,
      profile_views_today: 0,
      counters_reset_on: now.toISOString().slice(0, 10),
      last_action_at: null,
      working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
      invites_paused_until: null,
      invites_paused_reason: null,
      invite_throttle_streak: 0,
    },
  ]);
  db.seed("profiles", [{ id: USER, timezone: "UTC" }]);
  db.seed("workspaces", [
    {
      id: WORKSPACE,
      plan: "trial",
      trial_ends_at: new Date(now.getTime() + 30 * 86_400_000).toISOString(),
      subscription_status: null,
      seats: 1,
    },
  ]);
  db.seed(
    "campaign_prospects",
    Array.from({ length: count }, (_unused, i) => ({
      id: `cp-${i}`,
      workspace_id: WORKSPACE,
      campaign_id: CAMPAIGN,
      prospect_id: `p-${i}`,
      status: "queued",
      warmed_at: "2026-09-23T07:00:00Z",
      next_action_at: null,
    })),
  );
  db.seed("worker_heartbeats", []);
  db.seed("events", []);
  return db;
}

const delays = (added: Array<{ data: Record<string, unknown>; opts: { delay?: number } }>) =>
  added
    .filter((job) => job.data.kind === "invite")
    .map((job) => job.opts.delay ?? 0)
    .sort((a, b) => a - b);

describe("a day's invitations, across the day", () => {
  it("does not spend the whole allowance in the first hour", async () => {
    /*
     * The assertion the lost account would have failed. Ten invitations placed
     * two to nine minutes apart put every one of them inside seventy minutes;
     * the old code did exactly that and this is the line that now refuses it.
     */
    const db = harness(10, MORNING);
    const { queues, added } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, MORNING);

    const placed = delays(added);
    expect(placed).toHaveLength(10);
    expect(placed[placed.length - 1]).toBeGreaterThan(3 * 3_600_000);
  });

  it("keeps them all inside the rep's working day", async () => {
    // Nine in the morning, hours to six: nothing may be placed past the nine
    // hours that are left, or the send path defers it and the allowance is
    // quietly not spent.
    const db = harness(10, MORNING);
    const { queues, added } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, MORNING);

    expect(delays(added).every((ms) => ms <= 9 * 3_600_000)).toBe(true);
  });

  it("never places two closer together than the ordinary gap", async () => {
    // The pace is on top of the floor, never instead of it.
    const db = harness(10, MORNING);
    const { queues, added } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, MORNING);

    const placed = delays(added);
    for (let i = 1; i < placed.length; i += 1) {
      expect(placed[i] - placed[i - 1]).toBeGreaterThanOrEqual(2 * 60_000);
    }
  });

  it("falls back to the ordinary cadence late in the day", async () => {
    /*
     * A campaign launched at twenty past five with forty minutes of the day
     * left. Ten invitations do not fit into forty minutes at any pace, and the
     * answer is the cadence we always had rather than refusing to send — what
     * runs past six is deferred by the send path, not fired in a burst.
     */
    const evening = new Date("2026-09-23T17:20:00Z");
    const db = harness(10, evening);
    const { queues, added } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, evening);

    const placed = delays(added);
    expect(placed).toHaveLength(10);
    // Still paced, and paced no wider than it ever was.
    expect(placed[placed.length - 1]).toBeLessThanOrEqual(10 * 9 * 60_000);
  });

  it("paces one invitation as part of the day, not as the whole of it", async () => {
    /*
     * The trickle case, and the reason the divisor is the day's allowance
     * rather than however many are eligible right now. A warmed prospect
     * becomes invitable in its own window, so most ticks see one or two —
     * divided by those, a single invitation would be placed hours out and the
     * next tick would queue its own on top, at a rate nobody chose.
     */
    const db = harness(10, MORNING);
    // Everyone but the first is serving a hold of their own, so this tick has
    // exactly one person it may invite. Mutated rather than re-seeded: the
    // fake's `seed` appends, so a second call would leave twenty rows and the
    // test would pass for the wrong reason.
    db.rows("campaign_prospects").forEach((row, i) => {
      if (i > 0) row.next_action_at = "2026-09-23T16:00:00Z";
    });
    const { queues, added } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, MORNING);

    const placed = delays(added);
    expect(placed).toHaveLength(1);
    // One tenth of the day, near enough — not the whole of it.
    expect(placed[0]).toBeLessThan(2 * 3_600_000);
  });
});
