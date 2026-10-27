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

describe("repairCopy and copy that cannot be delivered or reads like a button", () => {
  const LABEL = "Book a Free Consultation";
  const FOUNDERS = "Quick yes or no: do founders still run outbound at your company, or do you have an SDR team?";
  const MARIA = "Quick yes or no Maria: do founders still run outbound where you hire";
  const PASTED = `If yes, ${LABEL} and pick a time: {{cta_link}}`;
  const EXAMPLE = "Hi {{first_name}}, want a two sentence example you can try this week?";

  function live(
    options: { docs?: Array<{ title: string; agent_id?: string | null }>; ownHook?: boolean; foundersAngle?: boolean } = {},
  ) {
    // By default the founders opener belongs to another campaign's angle,
    // which is what makes it another audience's line.
    const foundersAngle = options.foundersAngle ?? !options.ownHook;
    const db = new FakeDb();
    db.seed("campaigns", [
      {
        id: CAMPAIGN,
        workspace_id: WORKSPACE,
        status: "running",
        name: `Staffing owners (${LABEL})`,
        connection_note: "Hi {{first_name}}, would be good to connect.",
        agent_id: "agent-1",
        customer_profile_id: "cp-staffing",
        cta_id: "cta-1",
        cta_label: null,
        cta_url: null,
      },
      ...(foundersAngle
        ? [{ id: "camp-founders", workspace_id: WORKSPACE, status: "running", name: "Founders", connection_note: null, agent_id: "agent-1", customer_profile_id: null, cta_id: null, cta_label: null, cta_url: null }]
        : []),
    ]);
    db.seed("ctas", [{ id: "cta-1", workspace_id: WORKSPACE, label: LABEL, url: "https://cal.example.com/consult" }]);
    db.seed("hooks", [
      { id: "hook-founders", workspace_id: WORKSPACE, agent_id: "agent-1", body: FOUNDERS, approved_at: "2026-10-20T00:00:00Z" },
    ]);
    db.seed("customer_profiles", [
      { id: "cp-staffing", workspace_id: WORKSPACE, spec: { name: "Staffing agency owners", hooks: ["Are new clients still mostly referrals?"] } },
    ]);
    db.seed("campaign_variants", [
      {
        id: "v1",
        workspace_id: WORKSPACE,
        campaign_id: CAMPAIGN,
        connection_note: "Hi {{first_name}}, I talk to a lot of staffing owners. Would be good to connect.",
        hook_id: options.ownHook ? "hook-founders" : null,
      },
      ...(foundersAngle
        ? [{ id: "v-founders", workspace_id: WORKSPACE, campaign_id: "camp-founders", connection_note: null, hook_id: "hook-founders" }]
        : []),
    ]);
    db.seed("campaign_steps", [
      { id: "s2", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, step_number: 2, message: EXAMPLE },
      { id: "s3", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, step_number: 3, message: PASTED },
    ]);
    db.seed("campaign_prospects", [
      { id: "q1", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, variant_id: "v1", status: "queued", invite_note: MARIA },
    ]);
    db.seed(
      "knowledge_documents",
      (options.docs ?? []).map((d, i) => ({ id: `kd-${i}`, workspace_id: WORKSPACE, agent_id: d.agent_id ?? null, title: d.title })),
    );
    const ctx = {
      db: db.asDb(),
      agentsFor: () => ({ client: { models: { writer: "w", classifier: "c" } } }),
    } as unknown as WorkerContext;
    return { db, ctx };
  }

  it("revises a pasted title-case label and an offer nobody can keep, handing the reviser the same checks", async () => {
    const { db, ctx } = live();
    reviseMock.mockImplementation(async (_ctx: unknown, input?: { text: string }) =>
      input?.text === PASTED
        ? "If it's worth a look, happy to grab 20 minutes? {{cta_link}}"
        : "Most owners still sell every client themselves. You too?",
    );
    await repairCopy(ctx);
    expect(db.find("campaign_steps", { id: "s3" })?.message).toBe("If it's worth a look, happy to grab 20 minutes? {{cta_link}}");
    expect(db.find("campaign_steps", { id: "s2" })?.message).toMatch(/sell every client/);
    const pasted = reviseMock.mock.calls.find((call) => (call[1] as { text: string }).text === PASTED)?.[1] as {
      ctaLabel: string;
      assets: string[];
    };
    // The library entry's label, as the writer was handed it.
    expect(pasted.ctaLabel).toBe(LABEL);
    expect(pasted.assets).toContain("https://cal.example.com/consult");
  });

  it("leaves an offer alone when the knowledge base has the thing offered", async () => {
    const { db, ctx } = live({ docs: [{ title: "Two sentence outbound examples" }] });
    reviseMock.mockResolvedValue("If it's worth a look, happy to grab 20 minutes? {{cta_link}}");
    await repairCopy(ctx);
    expect(db.find("campaign_steps", { id: "s2" })?.message).toBe(EXAMPLE);
    const texts = reviseMock.mock.calls.map((call) => (call[1] as { text: string }).text);
    expect(texts).not.toContain(EXAMPLE);
  });

  it("never counts another brand's document as something this campaign can send", async () => {
    const { db, ctx } = live({ docs: [{ title: "Two sentence outbound examples", agent_id: "agent-2" }] });
    reviseMock.mockResolvedValue(null);
    await repairCopy(ctx);
    const texts = reviseMock.mock.calls.map((call) => (call[1] as { text: string }).text);
    expect(texts).toContain(EXAMPLE);
    expect(db.find("campaign_steps", { id: "s2" })?.message).toBe(EXAMPLE);
  });

  it("clears a queued note built on another audience's opener, without asking the model", async () => {
    const { db, ctx } = live();
    reviseMock.mockResolvedValue(null);
    const result = await repairCopy(ctx);
    expect(db.find("campaign_prospects", { id: "q1" })?.invite_note).toBeNull();
    expect(result.cleared).toBe(1);
    const texts = reviseMock.mock.calls.map((call) => (call[1] as { text: string }).text);
    expect(texts).not.toContain(MARIA);
  });

  it("keeps a note leaning on the business's own opener, attached to no audience", async () => {
    // The line approved on the launch step is this business's own, not
    // another audience's, and notes written from it are not borrowing.
    const { db, ctx } = live({ foundersAngle: false });
    reviseMock.mockResolvedValue(null);
    await repairCopy(ctx);
    expect(db.find("campaign_prospects", { id: "q1" })?.invite_note).toBe(MARIA);
  });

  it("keeps a note leaning on the opener its own angle carries", async () => {
    const { db, ctx } = live({ ownHook: true });
    reviseMock.mockResolvedValue(null);
    await repairCopy(ctx);
    expect(db.find("campaign_prospects", { id: "q1" })?.invite_note).toBe(MARIA);
  });

  it("takes the call to action out of the campaign's name", async () => {
    const { db, ctx } = live();
    reviseMock.mockResolvedValue(null);
    const result = await repairCopy(ctx);
    expect(db.find("campaigns", { id: CAMPAIGN })?.name).toBe("Staffing owners");
    expect(result.renamed).toBe(1);
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

describe("repairCopy and names a person chose", () => {
  it("never strips a bracket of the person's own that only looks like a call to action", async () => {
    const { FakeDb: Db } = await import("./fake-db.js");
    const db = new Db();
    db.seed("campaigns", [
      { id: "c-own", workspace_id: "11111111-1111-4111-8111-111111111111", status: "running", name: "Chamber leaders (Join program)", connection_note: null, agent_id: null, customer_profile_id: null, cta_id: null, cta_label: "Book a call", cta_url: null },
    ]);
    for (const t of ["ctas", "hooks", "customer_profiles", "campaign_variants", "campaign_steps", "campaign_prospects", "knowledge_documents"]) db.seed(t, []);
    const ctx = { db: db.asDb(), agentsFor: () => ({ client: { models: { writer: "w", classifier: "c" } } }) } as unknown as WorkerContext;
    const result = await repairCopy(ctx);
    expect(db.find("campaigns", { id: "c-own" })?.name).toBe("Chamber leaders (Join program)");
    expect(result.renamed).toBe(0);
  });
});
