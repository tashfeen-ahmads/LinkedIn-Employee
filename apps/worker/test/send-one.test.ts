import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { sendOneNow } from "../src/jobs/send-one.js";
import type { WorkerContext } from "../src/context.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const CP = "66666666-6666-4666-8666-666666666666";

/**
 * The button that answers "can this deployment send a real invitation".
 *
 * Every other way of asking cost a quarter of an hour — five minutes for a
 * tick, two to eleven more for the jittered gap — and answered with an
 * unchanged page if anything went wrong in between. Eight days went by that
 * way without one live send. What this skips is the waiting; every rule that
 * decides whether a message may reach a stranger still applies, and each of
 * them now refuses in words.
 */
function harness(options: { cpStatus?: string; campaignStatus?: string } = {}) {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();

  db.seed("profiles", [{ id: USER, full_name: "Sam Patel", timezone: "UTC" }]);
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
      counters_reset_on: "2026-09-09",
      connected_at: "2026-09-01T09:00:00Z",
      first_action_at: null,
      last_action_at: null,
      working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
    },
  ]);
  db.seed("campaigns", [
    {
      id: CAMPAIGN,
      workspace_id: WORKSPACE,
      linkedin_account_id: ACCOUNT,
      owner_user_id: USER,
      status: options.campaignStatus ?? "running",
      connection_note: "Hi {{first_name}}.",
      daily_invite_cap: 20,
      reply_mode: "approval",
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
      status: options.cpStatus ?? "queued",
      last_step_sent: 0,
      created_at: "2026-09-09T09:00:00Z",
    },
  ]);

  const ctx = {
    db: db.asDb(),
    linkedin,
    email: null,
    env: {} as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  return { db, ctx, linkedin };
}

beforeEach(() => {
  vi.useFakeTimers();
  // A Wednesday, inside the 08:00-18:00 working day.
  vi.setSystemTime(new Date("2026-09-09T14:00:00Z"));
});

describe("sendOneNow", () => {
  it("sends the next queued invitation and says so", async () => {
    const { ctx, linkedin, db } = harness();

    const result = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    expect(result.ok).toBe(true);
    expect(linkedin.sentInvitations).toHaveLength(1);
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("invited");
  });

  it("counts against the allowance like any other send", async () => {
    // Bypassing the pacing delay is not bypassing the caps. An account that
    // could be emptied by pressing a button is the restriction this product
    // exists to avoid.
    const { ctx, db } = harness();

    await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.invites_today).toBe(1);
  });

  it("reports the limiter declining as the system working, not as a failure", async () => {
    const { ctx, linkedin } = harness();
    vi.setSystemTime(new Date("2026-09-09T23:00:00Z"));

    const result = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    expect(result.ok).toBe(false);
    expect(linkedin.sentInvitations).toHaveLength(0);
    expect(result.detail).toMatch(/outside_working_hours/);
    expect(result.detail).toMatch(/not an error/);
  });

  it("hands back the provider's own words when a send fails", async () => {
    // The single most valuable sentence in this whole flow, and it used to go
    // to a log on a host the person pressing the button cannot reach.
    const { ctx, linkedin } = harness();
    linkedin.invitationError = new Error("failed with 422: Cannot send invitation to this member");

    const result = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Cannot send invitation to this member");
  });

  it("refuses a campaign nobody has launched", async () => {
    // Otherwise this is a way around the review that the whole product is
    // built on.
    const { ctx, linkedin } = harness({ campaignStatus: "draft" });

    const result = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/Launch it first/);
    expect(linkedin.sentInvitations).toHaveLength(0);
  });

  it("says when there is nobody left to send to", async () => {
    const { ctx } = harness({ cpStatus: "invited" });

    const result = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/Nobody on this campaign/);
  });

  it("never reaches another workspace's campaign", async () => {
    const { ctx, linkedin } = harness();
    const other = "77777777-7777-4777-8777-777777777777";

    const result = await sendOneNow(ctx, { workspaceId: other, campaignId: CAMPAIGN });

    expect(result.ok).toBe(false);
    expect(linkedin.sentInvitations).toHaveLength(0);
  });

  it("reports a refusal that happened without an error", async () => {
    // runLinkedInAction returns quietly for an excluded prospect, somebody
    // already contacted, or a transition it would not make. Reporting that as
    // success is exactly the blank page this button replaces.
    const { ctx, db, linkedin } = harness();
    db.find("prospects", { id: PROSPECT })!.do_not_contact = true;

    const result = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });

    expect(result.ok).toBe(false);
    expect(linkedin.sentInvitations).toHaveLength(0);
    expect(result.detail).toMatch(/do not contact/);
  });
});
