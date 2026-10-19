import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";

/*
 * Rule 66: copy written before the voice check existed is still in the
 * database and goes out as stored. The repair rewrites only what fails, never
 * touches somebody already invited, and never overwrites an edit made while
 * the model was writing.
 */

const reviseMock = vi.fn();
const pitchMock = vi.fn();
const hooksMock = vi.fn();

vi.mock("@le/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@le/agents")>();
  return {
    ...actual,
    reviseForVoice: (...args: unknown[]) => reviseMock(...args),
    writePitch: (...args: unknown[]) => pitchMock(...args),
    writeHooks: (...args: unknown[]) => hooksMock(...args),
  };
});

const { repairCopy, repairSeededLines } = await import("../src/jobs/repair-copy.js");
const { offerFrom } = await import("../src/jobs/seed-agent.js");
const { DEFAULT_OPENER_TEMPLATE } = await import("@le/shared");

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const DONE = "44444444-4444-4444-8444-444444444444";

const BAD_STEP = "Hi {{first_name}}, I'm reaching out about how {{company}} handles after-hours DMs. Is that yours?";
const GOOD_STEP = "Hi {{first_name}}, thanks for connecting. How do you handle messages after hours?";
const BAD_NOTE = "Hi Beverly, I'm reaching out because you're “Dentist/Owner at Love Your Smile Family Dentistry”.";

function harness() {
  const db = new FakeDb();
  db.seed("campaigns", [
    { id: CAMPAIGN, workspace_id: WORKSPACE, status: "running", connection_note: "Hi {{first_name}}, would be good to connect." },
    { id: DONE, workspace_id: WORKSPACE, status: "completed", connection_note: "I'm reaching out — hi" },
  ]);
  db.seed("campaign_variants", []);
  db.seed("campaign_steps", [
    { id: "s1", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, step_number: 1, message: BAD_STEP },
    { id: "s2", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, step_number: 2, message: "{{pitch}} Worth a look?" },
  ]);
  db.seed("campaign_prospects", [
    { id: "q1", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, status: "queued", invite_note: BAD_NOTE },
    { id: "i1", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, status: "invited", invite_note: BAD_NOTE },
  ]);
  const ctx = {
    db: db.asDb(),
    agentsFor: () => ({ client: { models: { writer: "w", classifier: "c" } } }),
  } as unknown as WorkerContext;
  return { db, ctx };
}

beforeEach(() => reviseMock.mockReset());

describe("repairCopy", () => {
  it("rewrites a failing step and leaves clean copy alone", async () => {
    const { db, ctx } = harness();
    reviseMock.mockResolvedValue(GOOD_STEP);
    await repairCopy(ctx);
    expect(db.find("campaign_steps", { id: "s1" })?.message).toBe(GOOD_STEP);
    expect(db.find("campaign_steps", { id: "s2" })?.message).toBe("{{pitch}} Worth a look?");
    // Only the failing rows were sent to the model.
    const texts = reviseMock.mock.calls.map((call) => (call[1] as { text: string }).text);
    expect(texts).toContain(BAD_STEP);
    expect(texts).not.toContain("{{pitch}} Worth a look?");
  });

  it("never touches a note already sent, or a finished campaign", async () => {
    const { db, ctx } = harness();
    reviseMock.mockResolvedValue("Hi Beverly, I talk to a lot of practice owners. Would be good to connect.");
    await repairCopy(ctx);
    expect(db.find("campaign_prospects", { id: "i1" })?.invite_note).toBe(BAD_NOTE);
    expect(db.find("campaign_prospects", { id: "q1" })?.invite_note).toMatch(/practice owners/);
    expect(db.find("campaigns", { id: DONE })?.connection_note).toBe("I'm reaching out — hi");
  });

  it("clears a personal note it cannot fix so the campaign's note goes instead, and keeps a template it cannot fix", async () => {
    const { db, ctx } = harness();
    reviseMock.mockResolvedValue(null);
    const result = await repairCopy(ctx);
    expect(db.find("campaign_prospects", { id: "q1" })?.invite_note).toBeNull();
    expect(db.find("campaign_steps", { id: "s1" })?.message).toBe(BAD_STEP);
    expect(result.cleared).toBe(1);
  });

  it("does not overwrite a step somebody edited while the model was writing", async () => {
    const { db, ctx } = harness();
    reviseMock.mockImplementation(async () => {
      db.find("campaign_steps", { id: "s1" })!.message = "edited by a person";
      return GOOD_STEP;
    });
    await repairCopy(ctx);
    expect(db.find("campaign_steps", { id: "s1" })?.message).toBe("edited by a person");
  });
});

describe("repairSeededLines", () => {
  const business = {
    companyName: "Palma Podcast Productions",
    oneLiner: "We produce and distribute short, story-driven video podcasts for dental and medical practices across the US.",
    offering: "Podcasts.",
    differentiators: [],
    proofPoints: [],
    competitors: [],
    pricingModel: "unknown",
    toneOfVoice: "warm",
    commonObjections: [],
  };

  function seeded(approved: boolean) {
    const db = new FakeDb();
    db.seed("business_profiles", [{ id: "bp", workspace_id: WORKSPACE, spec: business, created_at: "2026-09-01T00:00:00Z" }]);
    db.seed("customer_profiles", [{ id: "cp", workspace_id: WORKSPACE, spec: { name: "Dentists", summary: "Practice owners", pains: ["no-shows"] } }]);
    db.seed("agents", []);
    db.seed("pitches", [
      { id: "seeded", workspace_id: WORKSPACE, agent_id: null, body: offerFrom(business as never), written_by: "agent", approved_at: approved ? "2026-10-01T00:00:00Z" : null },
      { id: "mine", workspace_id: WORKSPACE, agent_id: null, body: "Short episodes your patients actually finish.", written_by: "human", approved_at: null },
    ]);
    db.seed("hooks", [
      { id: "greeting", workspace_id: WORKSPACE, agent_id: null, body: DEFAULT_OPENER_TEMPLATE, written_by: "agent", approved_at: null },
    ]);
    const ctx = { db: db.asDb(), agentsFor: () => ({ client: { models: { writer: "w", classifier: "c" } } }) } as unknown as WorkerContext;
    return { db, ctx };
  }

  beforeEach(() => {
    pitchMock.mockReset().mockResolvedValue({ variants: [{ body: "Patients hear you before they book." }] });
    hooksMock.mockReset().mockResolvedValue({ variants: [{ body: "Do many of your patients ask the same questions?" }] });
  });

  it("replaces the cut-off seeded offer and the stock greeting", async () => {
    // The seed cut the one-liner to "We produce and distribute short."
    expect(offerFrom(business as never)).toBe("We produce and distribute short.");
    const { db, ctx } = seeded(false);
    const result = await repairSeededLines(ctx);
    expect(db.find("pitches", { id: "seeded" })?.body).toBe("Patients hear you before they book.");
    expect(db.find("hooks", { id: "greeting" })?.body).toBe("Do many of your patients ask the same questions?");
    expect(result).toMatchObject({ offers: 1, openers: 1 });
  });

  it("never changes a line somebody wrote or approved", async () => {
    const { db, ctx } = seeded(true);
    const result = await repairSeededLines(ctx);
    expect(db.find("pitches", { id: "seeded" })?.body).toBe("We produce and distribute short.");
    expect(db.find("pitches", { id: "mine" })?.body).toBe("Short episodes your patients actually finish.");
    expect(result.approvedLeft).toBe(1);
  });
});
