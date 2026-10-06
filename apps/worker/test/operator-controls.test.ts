import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { runLinkedInAction, RescheduleError } from "../src/jobs/linkedin-action.js";
import { runCampaignTick } from "../src/jobs/campaign-tick.js";
import { sendOneNow } from "../src/jobs/send-one.js";
import { runAdminControl } from "../src/jobs/admin-control.js";
import { outreachPause } from "../src/platform.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

/*
 * The operator's kill switch, and the console controls around it.
 *
 * The switch exists for the morning LinkedIn starts restricting accounts: one
 * press and nothing else leaves any account. It has to hold on the send path
 * itself (rule 1), not only in the loop — jobs already sitting delayed in the
 * queue were placed before anybody pressed it.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const CP = "66666666-6666-4666-8666-666666666666";
const ADMIN = "77777777-7777-4777-8777-777777777777";

function harness(paused: boolean, campaignStatus = "running") {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();
  db.seed("profiles", [{ id: USER, full_name: "Sam Patel", timezone: "UTC" }]);
  db.seed("workspaces", [
    {
      id: WORKSPACE,
      plan: "trial",
      trial_ends_at: "2026-12-31T00:00:00Z",
      subscription_status: null,
      seats: 1,
    },
  ]);
  db.seed("linkedin_accounts", [
    {
      id: ACCOUNT,
      workspace_id: WORKSPACE,
      user_id: USER,
      provider_account_id: "acct",
      status: "active",
      invites_today: 0,
      invites_this_week: 0,
      messages_today: 0,
      profile_views_today: 0,
      counters_reset_on: "2026-09-09",
      connected_at: "2026-09-01T09:00:00Z",
      first_action_at: null,
      last_action_at: null,
      working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
      invites_paused_until: null,
      invite_throttle_streak: 0,
    },
  ]);
  db.seed("campaigns", [
    {
      id: CAMPAIGN,
      workspace_id: WORKSPACE,
      name: "Founders",
      linkedin_account_id: ACCOUNT,
      owner_user_id: USER,
      status: campaignStatus,
      launched_at: "2026-09-08T09:00:00Z",
      connection_note: "Hi {{first_name}}.",
      daily_invite_cap: 20,
      reply_mode: "approval",
      warm_up: false,
    },
  ]);
  db.seed("prospects", [
    {
      id: PROSPECT,
      workspace_id: WORKSPACE,
      provider_id: "prov-1",
      linkedin_url: "linkedin.com/in/jane-one",
      first_name: "Jane",
      company: "Northwind",
      do_not_contact: false,
      last_contacted_at: null,
    },
  ]);
  db.seed("campaign_prospects", [
    {
      id: CP,
      workspace_id: WORKSPACE,
      campaign_id: CAMPAIGN,
      prospect_id: PROSPECT,
      status: "queued",
      last_step_sent: 0,
      created_at: "2026-09-09T09:00:00Z",
      warmed_at: null,
      next_action_at: null,
    },
  ]);
  db.seed("platform_settings", [
    {
      id: true,
      outreach_paused_at: paused ? "2026-09-09T13:00:00Z" : null,
      outreach_paused_reason: paused ? "LinkedIn is restricting accounts this morning" : null,
      outreach_paused_by: paused ? ADMIN : null,
      support_autopilot: true,
    },
  ]);
  db.seed("platform_admins", [{ user_id: ADMIN }]);
  db.seed("worker_heartbeats", []);
  db.seed("events", []);

  const ctx = {
    db: db.asDb(),
    linkedin,
    email: null,
    env: {} as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;
  return { db, ctx, linkedin };
}

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
  return {
    queues: { linkedinAction: queue, campaignTick: queue } as unknown as Queues,
    added,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // A Wednesday, inside the 08:00-18:00 working day.
  vi.setSystemTime(new Date("2026-09-09T14:00:00Z"));
});

describe("pausing all outreach", () => {
  it("stops an invitation already in the queue, on the send path itself", async () => {
    const { ctx, linkedin, db } = harness(true);
    await expect(
      runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP }),
    ).rejects.toBeInstanceOf(RescheduleError);
    expect(linkedin.sentInvitations).toHaveLength(0);
    // Waiting, never failed: lifting the switch resumes it.
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("queued");
  });

  it("sends as normal when nobody has paused anything", async () => {
    const { ctx, linkedin } = harness(false);
    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });
    expect(linkedin.sentInvitations).toHaveLength(1);
  });

  it("treats a deployment with no settings row as not paused", async () => {
    const { ctx, db } = harness(false);
    db.rows("platform_settings").splice(0);
    expect(await outreachPause(ctx.db)).toBeNull();
  });

  it("stops the pacing loop queueing anything, and says why in its stamp", async () => {
    const { db } = harness(true);
    const { queues, added } = fakeQueues();
    expect(await runCampaignTick(db.asDb(), queues, new Date())).toBe(0);
    expect(added).toHaveLength(0);
    const beat = db.rows("worker_heartbeats").find((b) => b.name === "campaign-tick");
    expect(JSON.stringify(beat?.detail)).toMatch(/restricting/);
  });

  it("tells a customer pressing Send one now that it is paused, without our reason", async () => {
    const { ctx, linkedin } = harness(true);
    const result = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/paused across the platform/);
    expect(result.detail).not.toMatch(/restricting/);
    expect(linkedin.sentInvitations).toHaveLength(0);
  });

  it("is lifted by the console's resume, which asks the loop to run at once", async () => {
    const { ctx, db } = harness(true);
    const { queues, added } = fakeQueues();
    const result = await runAdminControl(ctx, queues, ADMIN, { op: "outreach-resume" });
    expect(result.ok).toBe(true);
    expect(db.rows("platform_settings")[0]?.outreach_paused_at).toBeNull();
    expect(added.some((job) => job.name === "tick")).toBe(true);
  });
});

describe("console controls", () => {
  it("pauses a running campaign and resumes it", async () => {
    const { ctx, db } = harness(false);
    const { queues } = fakeQueues();
    expect((await runAdminControl(ctx, queues, ADMIN, { op: "campaign-pause", campaignId: CAMPAIGN })).ok).toBe(true);
    expect(db.find("campaigns", { id: CAMPAIGN })?.status).toBe("paused");
    expect((await runAdminControl(ctx, queues, ADMIN, { op: "campaign-resume", campaignId: CAMPAIGN })).ok).toBe(true);
    expect(db.find("campaigns", { id: CAMPAIGN })?.status).toBe("running");
  });

  it("never launches a campaign its owner has not launched", async () => {
    // Launch is the one gate with no way round it. An operator resuming a
    // draft would be the product sending under somebody's name without their yes.
    const { ctx, db } = harness(false, "paused");
    db.find("campaigns", { id: CAMPAIGN })!.launched_at = null;
    const { queues } = fakeQueues();
    const result = await runAdminControl(ctx, queues, ADMIN, { op: "campaign-resume", campaignId: CAMPAIGN });
    expect(result.ok).toBe(false);
    expect(db.find("campaigns", { id: CAMPAIGN })?.status).toBe("paused");
  });

  it("clears LinkedIn's hold on an account", async () => {
    const { ctx, db } = harness(false);
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    account.invites_paused_until = "2026-09-10T00:00:00Z";
    account.invites_paused_reason = "cannot_resend_yet";
    const { queues } = fakeQueues();
    expect((await runAdminControl(ctx, queues, ADMIN, { op: "account-clear-hold", accountId: ACCOUNT })).ok).toBe(true);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.invites_paused_until).toBeNull();
  });
});
