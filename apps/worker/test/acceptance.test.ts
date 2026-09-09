import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { detectAcceptedInvitations } from "../src/jobs/acceptance.js";
import type { WorkerContext } from "../src/context.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const CP = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-09-09T10:00:00Z");

function harness() {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();

  db.seed("linkedin_accounts", [
    { id: ACCOUNT, workspace_id: WORKSPACE, provider_account_id: "acct", status: "active" },
  ]);
  db.seed("campaigns", [{ id: CAMPAIGN, workspace_id: WORKSPACE, linkedin_account_id: ACCOUNT }]);
  db.seed("campaign_steps", [
    { workspace_id: WORKSPACE, campaign_id: CAMPAIGN, step_number: 1, delay_days: 2, message: "Worth a look?" },
  ]);
  db.seed("prospects", [{ id: PROSPECT, workspace_id: WORKSPACE, provider_id: "prov_jane" }]);
  db.seed("campaign_prospects", [
    {
      id: CP,
      workspace_id: WORKSPACE,
      campaign_id: CAMPAIGN,
      prospect_id: PROSPECT,
      status: "invited",
      invited_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
      last_step_sent: 0,
      next_action_at: null,
    },
  ]);

  const ctx = { db: db.asDb(), linkedin } as unknown as WorkerContext;
  return { db, ctx, linkedin };
}

describe("detectAcceptedInvitations", () => {
  it("moves an invited prospect to accepted once they are a connection", async () => {
    const { db, ctx, linkedin } = harness();
    linkedin.relations = [{ providerId: "prov_jane", connectedAt: NOW.toISOString() }];

    expect(await detectAcceptedInvitations(ctx, NOW)).toBe(1);

    const cp = db.find("campaign_prospects", { id: CP })!;
    expect(cp.status).toBe("accepted");
    expect(cp.accepted_at).toBe(NOW.toISOString());
  });

  it("schedules the first follow-up, which is the whole point", async () => {
    // Without next_action_at the prospect sits in accepted and is still never
    // messaged, which is the bug this job exists to fix.
    const { db, ctx, linkedin } = harness();
    linkedin.relations = [{ providerId: "prov_jane", connectedAt: NOW.toISOString() }];

    await detectAcceptedInvitations(ctx, NOW);

    const cp = db.find("campaign_prospects", { id: CP })!;
    expect(cp.next_action_at).toBe(new Date(NOW.getTime() + 2 * 86_400_000).toISOString());
  });

  it("leaves someone who has not accepted alone", async () => {
    const { db, ctx, linkedin } = harness();
    linkedin.relations = [{ providerId: "prov_someone_else", connectedAt: NOW.toISOString() }];

    expect(await detectAcceptedInvitations(ctx, NOW)).toBe(0);
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("invited");
  });

  it("does not claim an acceptance for an invitation already withdrawn", async () => {
    // Older than the withdrawal window: whatever connected them, it was not
    // this campaign's invitation.
    const { db, ctx, linkedin } = harness();
    db.find("campaign_prospects", { id: CP })!.invited_at = new Date(
      NOW.getTime() - 40 * 86_400_000,
    ).toISOString();
    linkedin.relations = [{ providerId: "prov_jane", connectedAt: NOW.toISOString() }];

    expect(await detectAcceptedInvitations(ctx, NOW)).toBe(0);
  });

  it("records the acceptance, so the funnel and the digest can see it", async () => {
    const { db, ctx, linkedin } = harness();
    linkedin.relations = [{ providerId: "prov_jane", connectedAt: NOW.toISOString() }];

    await detectAcceptedInvitations(ctx, NOW);

    expect(db.rows("events").some((e) => e.name === "invite.accepted")).toBe(true);
  });

  it("is idempotent: a second pass accepts nobody twice", async () => {
    const { ctx, linkedin } = harness();
    linkedin.relations = [{ providerId: "prov_jane", connectedAt: NOW.toISOString() }];

    await detectAcceptedInvitations(ctx, NOW);
    expect(await detectAcceptedInvitations(ctx, NOW)).toBe(0);
  });

  it("keeps checking the other accounts when one provider call fails", async () => {
    const { ctx, linkedin } = harness();
    linkedin.listRelations = async () => {
      throw new Error("provider unavailable");
    };

    await expect(detectAcceptedInvitations(ctx, NOW)).resolves.toBe(0);
  });
});
