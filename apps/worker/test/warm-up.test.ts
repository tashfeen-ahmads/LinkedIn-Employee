import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { LINKEDIN_LIMITS } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";

/*
 * Looking at somebody before asking to connect.
 *
 * A connection request arriving cold is a stranger's name among thirty that
 * week; the same request to somebody who saw this account view their profile a
 * few hours earlier reaches a name they half recognise. The published
 * benchmarks put that at around a third more acceptances, which is the single
 * biggest lever in the whole funnel and costs nothing but a cheap action.
 *
 * What it must never become is a second way to reach somebody the rest of the
 * product has already decided not to reach — a view is visible to the person,
 * so every guard on the invitation applies to it too.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const PROSPECT = "44444444-4444-4444-8444-444444444444";
const CP = "55555555-5555-4555-8555-555555555555";
const USER = "66666666-6666-4666-8666-666666666666";

const NOW = new Date("2026-09-25T10:00:00Z"); // A Friday, mid-morning.

function harness(overrides: { prospect?: Record<string, unknown>; cp?: Record<string, unknown> } = {}) {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();

  db.seed("campaigns", [
    {
      id: CAMPAIGN,
      workspace_id: WORKSPACE,
      status: "running",
      linkedin_account_id: ACCOUNT,
      owner_user_id: USER,
      connection_note: "Hi {{first_name}}.",
      warm_up: true,
      daily_invite_cap: 20,
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
      first_action_at: null,
      invites_today: 0,
      invites_this_week: 0,
      messages_today: 0,
      profile_views_today: 0,
      counters_reset_on: "2026-09-25",
      last_action_at: null,
      working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
      invites_paused_until: null,
      invites_paused_reason: null,
      invite_throttle_streak: 0,
    },
  ]);
  db.seed("profiles", [{ id: USER, full_name: "Tashfeen Ahmad", timezone: "UTC" }]);
  db.seed("prospects", [
    {
      id: PROSPECT,
      workspace_id: WORKSPACE,
      provider_id: "pv-1",
      linkedin_url: "https://www.linkedin.com/in/dana",
      first_name: "Dana",
      last_name: "Rizzo",
      company: "Rizzo Events",
      title: "Owner",
      headline: null,
      location: null,
      do_not_contact: false,
      last_contacted_at: null,
      ...overrides.prospect,
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
      warmed_at: null,
      next_action_at: null,
      invite_note: null,
      variant_id: null,
      ...overrides.cp,
    },
  ]);
  db.seed("workspaces", [{ id: WORKSPACE, trial_ends_at: new Date(NOW.getTime() + 30 * 86_400_000).toISOString() }]);
  db.seed("events", []);
  db.seed("exclusions", []);

  const ctx = {
    db: db.asDb(),
    linkedin,
    email: null,
    env: {} as WorkerContext["env"],
    agentsFor: () => ({ client: { provider: "openai", models: { writer: "gpt-5" } } as never }),
  } as unknown as WorkerContext;

  return { db, ctx, linkedin };
}

const job = { kind: "warm_up" as const, workspaceId: WORKSPACE, campaignProspectId: CP };

describe("warming a prospect", () => {
  it("looks at their profile and records it", async () => {
    const { db, ctx, linkedin } = harness();

    await runLinkedInAction(ctx, job);

    expect(linkedin.viewedProfiles).toEqual(["pv-1"]);
    expect(db.find("campaign_prospects", { id: CP })?.warmed_at).toBeTruthy();
  });

  it("spends the view allowance and not the invitation one", async () => {
    /*
     * The distinction the whole feature rests on. A view drawn from the invite
     * budget would mean warming somebody cost us the ability to write to them,
     * and a warm-up that halves the day's invitations is worse than no warm-up.
     */
    const { db, ctx } = harness();

    await runLinkedInAction(ctx, job);

    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.profile_views_today).toBe(1);
    expect(account.invites_today).toBe(0);
    expect(account.invites_this_week).toBe(0);
  });

  it("does not start the invitation warm-up ramp", async () => {
    // `first_action_at` is day zero of the *invitation* ramp, and the ramp
    // exists to stop a never-used account being handed its full allowance on
    // the first day it ever invites anybody. An account that spent a week
    // looking at profiles has still never sent an invitation.
    const { db, ctx } = harness();

    await runLinkedInAction(ctx, job);

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.first_action_at ?? null).toBeNull();
  });

  it("schedules the invitation for later, never for now", async () => {
    // A view and a connection request in the same minute is one automated
    // burst wearing two hats, and it is the pattern LinkedIn watches for.
    const { db, ctx } = harness();

    await runLinkedInAction(ctx, job);

    const due = Date.parse(db.find("campaign_prospects", { id: CP })?.next_action_at as string);
    expect(due).toBeGreaterThanOrEqual(Date.now() + LINKEDIN_LIMITS.warmUpToInviteMinMs - 1000);
    expect(due).toBeLessThanOrEqual(Date.now() + LINKEDIN_LIMITS.warmUpToInviteMaxMs + 1000);
  });

  it("never looks at somebody twice", async () => {
    // A second view spends another allowance on familiarity already bought.
    const { db, ctx, linkedin } = harness({ cp: { warmed_at: "2026-09-25T09:00:00Z" } });

    await runLinkedInAction(ctx, job);

    expect(linkedin.viewedProfiles).toEqual([]);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.profile_views_today).toBe(0);
  });

  it("keeps the prospect when the view is refused", async () => {
    /*
     * A refused view costs nothing and proves nothing. Warming is an
     * improvement to the invitation, not a precondition for it, so failing
     * the person here would spend a real name on a request never made.
     */
    const { db, ctx, linkedin } = harness();
    linkedin.viewRefusal = "Unipile GET /api/v1/users/pv-1 failed with 500";

    await runLinkedInAction(ctx, job);

    const after = db.find("campaign_prospects", { id: CP })!;
    expect(after.status).toBe("queued");
    expect(after.warmed_at ?? null).toBeNull();
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.profile_views_today).toBe(0);
  });
});

describe("who must never be warmed", () => {
  it("nobody on do-not-contact", async () => {
    // A view is visible to the person. "Do not contact" is a promise, and a
    // notification saying we looked them up is not keeping it.
    const { ctx, linkedin } = harness({ prospect: { do_not_contact: true } });

    await runLinkedInAction(ctx, job);

    expect(linkedin.viewedProfiles).toEqual([]);
  });

  it("nobody this workspace has already contacted", async () => {
    // Rule 24 applies to the whole approach, not only to the message. Warming
    // somebody we will never be allowed to invite spends the allowance twice
    // over: once on the view, and once on the invitation that gets refused.
    const { ctx, linkedin } = harness({ prospect: { last_contacted_at: "2026-09-20T10:00:00Z" } });

    await runLinkedInAction(ctx, job);

    expect(linkedin.viewedProfiles).toEqual([]);
  });
});
