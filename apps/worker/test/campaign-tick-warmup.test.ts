import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import { runCampaignTick } from "../src/jobs/campaign-tick.js";
import type { Queues } from "../src/queues.js";

/*
 * The pacing loop deciding whether to spend a view.
 *
 * `invitationCouldFollow` is tested on its own in @le/linkedin; this is the
 * wiring, which is where it actually costs something. A rule that is correct
 * in a pure function and not consulted by the loop is a rule that does nothing
 * — and that gap is invisible to a unit test of either half.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

const NOW = new Date("2026-09-25T10:00:00Z"); // A Friday, mid-morning.

/** Enough of a BullMQ queue for `enqueueOnce` and the heartbeat's counts. */
function fakeQueues() {
  const added: Array<{ name: string; data: Record<string, unknown> }> = [];
  const queue = {
    add: async (name: string, data: Record<string, unknown>) => {
      added.push({ name, data });
      return { id: "job" };
    },
    getJob: async () => undefined,
    getJobCounts: async () => ({ waiting: 0, delayed: added.length }),
  };
  return { queues: { linkedinAction: queue } as unknown as Queues, added };
}

function harness(over: { pausedUntil?: string | null; invitesToday?: number } = {}) {
  const db = new FakeDb();
  db.seed("campaigns", [
    {
      id: CAMPAIGN,
      workspace_id: WORKSPACE,
      status: "running",
      linkedin_account_id: ACCOUNT,
      owner_user_id: USER,
      daily_invite_cap: 20,
      warm_up: true,
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
      first_action_at: "2026-09-01T09:00:00Z",
      invites_today: over.invitesToday ?? 0,
      invites_this_week: 0,
      messages_today: 0,
      profile_views_today: 0,
      counters_reset_on: "2026-09-25",
      last_action_at: null,
      working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
      invites_paused_until: over.pausedUntil ?? null,
      invites_paused_reason: over.pausedUntil ? "LinkedIn is temporarily refusing invitations" : null,
      invite_throttle_streak: 0,
    },
  ]);
  db.seed("profiles", [{ id: USER, timezone: "UTC" }]);
  db.seed("workspaces", [
    {
      id: WORKSPACE,
      // Every column the entitlement check reads. Seeded short, the loop
      // declines before it ever reaches the warm-up and the test would be
      // asserting that a lapsed trial sends nothing — true, and not the rule
      // under test.
      plan: "trial",
      trial_ends_at: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
      subscription_status: null,
      seats: 1,
    },
  ]);
  db.seed("campaign_prospects", [
    {
      id: "cp-1",
      workspace_id: WORKSPACE,
      campaign_id: CAMPAIGN,
      prospect_id: "p-1",
      status: "queued",
      warmed_at: null,
      next_action_at: null,
    },
  ]);
  db.seed("worker_heartbeats", []);
  db.seed("events", []);
  return db;
}

const warmUps = (added: Array<{ data: Record<string, unknown> }>) =>
  added.filter((job) => job.data.kind === "warm_up");

describe("the loop deciding whether to warm", () => {
  it("warms when an invitation could follow", async () => {
    const db = harness();
    const { queues, added } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, NOW);

    expect(warmUps(added)).toHaveLength(1);
  });

  it("does not warm against a hold that outlasts the window", async () => {
    /*
     * The Friday this rule comes from. Eight people were viewed at a quarter
     * to three against a hold running to two the next afternoon, and every one
     * of those views was spent twenty-three hours early — paid for at full
     * price and worth a fraction of it by the time the invitation went.
     */
    const db = harness({ pausedUntil: "2026-09-26T14:07:00Z" });
    const { queues, added } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, NOW);

    expect(warmUps(added)).toHaveLength(0);
    // And nobody is marked as warmed, so the view is still there to spend
    // tomorrow when it is worth something.
    expect(db.find("campaign_prospects", { id: "cp-1" })?.warmed_at ?? null).toBeNull();
  });

  it("warms into the tail of a hold that ends inside the window", async () => {
    // Using the end of a throttle is the whole argument for warming during
    // one. Refusing every held account would throw that away.
    const db = harness({ pausedUntil: "2026-09-25T12:00:00Z" });
    const { queues, added } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, NOW);

    expect(warmUps(added)).toHaveLength(1);
  });

  it("does not warm once today's invitations are spent", async () => {
    // No hold involved: the next invitation is simply tomorrow. This one would
    // have happened quietly every evening and nobody would have noticed.
    const db = harness({ invitesToday: LINKEDIN_LIMITS.invitesPerDayMax });
    const { queues, added } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, NOW);

    expect(warmUps(added)).toHaveLength(0);
  });

  it("does not blame a throttle on a campaign that has nobody left to warm", async () => {
    /*
     * The gate is evaluated before anything asks whether anyone is left, so a
     * campaign that had warmed its whole list said "holding the warm-up: no
     * invitation could follow a view" on every tick for ever — a sentence about
     * a throttle, on a campaign with nothing to throttle, sending somebody to
     * investigate an account that was fine. Rule 21's disease: a reason true of
     * one situation, printed during another.
     */
    const db = harness({ pausedUntil: "2026-09-26T14:07:00Z" });
    // Everybody on this campaign has already been looked at.
    db.rows("campaign_prospects").forEach((row) => {
      row.warmed_at = "2026-09-24T10:00:00Z";
    });
    const { queues } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, NOW);

    const beat = db.rows("worker_heartbeats").find((b) => b.name === "campaign-tick");
    const said = JSON.stringify(beat?.detail ?? {});
    expect(said).not.toContain("holding the warm-up");
  });

  it("says why it is holding back, rather than looking idle", async () => {
    // A loop that declines silently is indistinguishable from one that is
    // broken, which is the disease this whole file exists to avoid.
    const db = harness({ pausedUntil: "2026-09-26T14:07:00Z" });
    const { queues } = fakeQueues();

    await runCampaignTick(db.asDb(), queues, NOW);

    const beat = db.rows("worker_heartbeats").find((row) => row.name === "campaign-tick");
    const detail = JSON.stringify(beat?.detail ?? {});
    expect(detail).toContain("holding the warm-up");
  });
});
