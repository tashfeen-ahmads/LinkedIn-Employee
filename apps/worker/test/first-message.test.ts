import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";

/*
 * Rule 66: the first message after an acceptance is written for the person who
 * accepted, at acceptance, and step 1 is the fallback. A writer failure never
 * stops the acceptance being recorded.
 */

const writeMock = vi.fn();
vi.mock("@le/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@le/agents")>();
  return { ...actual, writeFirstMessage: (...args: unknown[]) => writeMock(...args) };
});

const { detectAcceptedInvitations } = await import("../src/jobs/acceptance.js");

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const CP = "66666666-6666-4666-8666-666666666666";
const USER = "77777777-7777-4777-8777-777777777777";
const NOW = new Date("2026-09-09T10:00:00Z");

function harness() {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();
  db.seed("linkedin_accounts", [{ id: ACCOUNT, workspace_id: WORKSPACE, provider_account_id: "acct", status: "active" }]);
  db.seed("campaigns", [
    { id: CAMPAIGN, workspace_id: WORKSPACE, linkedin_account_id: ACCOUNT, name: "Dealers", owner_user_id: USER, agent_id: null, rules: { angle: "after-hours leads" } },
  ]);
  db.seed("campaign_variants", []);
  db.seed("agents", []);
  db.seed("profiles", [{ id: USER, full_name: "Igor" }]);
  db.seed("business_profiles", [
    {
      id: "bp",
      workspace_id: WORKSPACE,
      created_at: "2026-09-01T00:00:00Z",
      spec: {
        companyName: "Glovecars",
        oneLiner: "AI lead follow-up for dealers.",
        offering: "x",
        differentiators: [],
        proofPoints: [],
        competitors: [],
        pricingModel: "unknown",
        toneOfVoice: "plain",
        commonObjections: [],
      },
    },
  ]);
  db.seed("prospects", [
    { id: PROSPECT, workspace_id: WORKSPACE, provider_id: "prov_jane", first_name: "Jane", company: "Lee RV", title: "GM", headline: "GM at Lee RV" },
  ]);
  db.seed("campaign_prospects", [
    {
      id: CP,
      workspace_id: WORKSPACE,
      campaign_id: CAMPAIGN,
      prospect_id: PROSPECT,
      status: "invited",
      invited_at: new Date(NOW.getTime() - 86_400_000).toISOString(),
      last_step_sent: 0,
      invite_note: "Hi Jane, I talk to a lot of RV dealers. Would be good to connect.",
    },
  ]);
  linkedin.relations = [{ providerId: "prov_jane", connectedAt: NOW.toISOString() }];
  const ctx = {
    db: db.asDb(),
    linkedin,
    agentsFor: () => ({ client: { models: { writer: "w", classifier: "c" } } }),
  } as unknown as WorkerContext;
  return { db, ctx };
}

beforeEach(() => writeMock.mockReset());

describe("the first message is written for the person who accepted", () => {
  it("stores one written from their own details", async () => {
    const { db, ctx } = harness();
    writeMock.mockResolvedValue("Hi Jane, thanks for connecting. Do most of your leads at Lee RV come in after hours?");
    await detectAcceptedInvitations(ctx, NOW);
    const input = writeMock.mock.calls[0]?.[1] as { prospect: { company: string }; inviteNote: string; angle: string };
    expect(input.prospect.company).toBe("Lee RV");
    expect(input.inviteNote).toMatch(/RV dealers/);
    expect(input.angle).toBe("after-hours leads");
    expect(db.find("campaign_prospects", { id: CP })?.first_message).toMatch(/Lee RV/);
  });

  it("records the acceptance even when the writer fails", async () => {
    const { db, ctx } = harness();
    // The model is unreachable: building its client throws.
    (ctx as unknown as { agentsFor: () => never }).agentsFor = () => {
      throw new Error("model down");
    };
    expect(await detectAcceptedInvitations(ctx, NOW)).toBe(1);
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("accepted");
    expect(db.find("campaign_prospects", { id: CP })?.first_message ?? null).toBeNull();
  });

  it("keeps step 1 when the writer could not produce a clean message", async () => {
    const { db, ctx } = harness();
    writeMock.mockResolvedValue(null);
    await detectAcceptedInvitations(ctx, NOW);
    expect(db.find("campaign_prospects", { id: CP })?.first_message ?? null).toBeNull();
  });
});
