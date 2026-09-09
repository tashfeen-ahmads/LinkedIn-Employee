import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const strategyMock = vi.fn();

vi.mock("@le/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@le/agents")>();
  return { ...actual, runStrategyAgent: (...args: unknown[]) => strategyMock(...args) };
});

function profile(name: string, priority: number) {
  return {
    name,
    summary: `People described as ${name}.`,
    jobTitles: ["Head of Operations"],
    seniority: ["Director"],
    industries: ["Software"],
    companySize: "51-200",
    geography: ["United Kingdom"],
    triggerEvents: ["Hired a RevOps manager"],
    pains: ["Manual pipeline hygiene"],
    valueProposition: "We automate the chasing.",
    salesNavFilters: {
      titles: ["Head of Operations"],
      seniorities: ["Director"],
      industries: ["Software"],
      companyHeadcount: ["51-200"],
      geographies: ["United Kingdom"],
      keywords: [],
      excludeTitles: [],
    },
    hooks: ["a", "b", "c"],
    connectionNote: "Hi there.",
    followUps: [
      { delayDays: 2, message: "Worth a look?" },
      { delayDays: 4, message: "Closing the loop." },
    ],
    priority,
  };
}

const OUTPUT = {
  businessProfile: {
    companyName: "Acme",
    oneLiner: "Acme sells revenue tooling to B2B teams.",
    offering: "A platform.",
    pricingModel: "unknown",
    proofPoints: [],
    toneOfVoice: "Plain and direct.",
    competitors: [],
    commonObjections: [],
    differentiators: [],
  },
  customerProfiles: [profile("Ops leaders", 1), profile("Founders", 2), profile("Agency owners", 3)],
};

function harness() {
  const db = new FakeDb();
  db.seed("workspaces", [{ id: WORKSPACE, name: "Acme", plan: "trial" }]);
  db.seed("profiles", [{ id: USER, email: "sam@acme.test", full_name: "Sam Patel" }]);

  const ctx = {
    db: db.asDb(),
    email: null,
    env: {} as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  return { db, ctx };
}

beforeEach(() => {
  strategyMock.mockReset();
  strategyMock.mockResolvedValue(OUTPUT);
  // The job scrapes the customer's own site; nothing should reach the network
  // in a test, and a failure to fetch must not fail the job.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html><body>We sell revenue tooling.</body></html>", { status: 200 })),
  );
});

describe("runStrategyJob", () => {
  it("stores the business profile and every customer profile", async () => {
    const { db, ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    const id = await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });

    expect(id).toBeTruthy();
    expect(db.rows("business_profiles")).toHaveLength(1);
    expect(db.rows("customer_profiles")).toHaveLength(3);
  });

  it("leaves everything unapproved for a human to confirm", async () => {
    const { db, ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });

    // The Targeting Agent must not act on a profile nobody has read.
    expect(db.rows("business_profiles")[0]?.approved_at ?? null).toBeNull();
    for (const row of db.rows("customer_profiles")) {
      expect(row.approved_at ?? null).toBeNull();
      expect(row.do_not_pursue ?? false).toBe(false);
    }
  });

  it("links every customer profile to the business profile it came from", async () => {
    const { db, ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    const id = await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });

    for (const row of db.rows("customer_profiles")) {
      expect(row.business_profile_id).toBe(id);
    }
  });

  it("keeps the agent's priority ordering, which decides what is pursued first", async () => {
    const { db, ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });

    const byName = new Map(db.rows("customer_profiles").map((r) => [r.name, r.priority]));
    expect(byName.get("Ops leaders")).toBe(1);
    expect(byName.get("Agency owners")).toBe(3);
  });

  it("runs on a description alone when there is no website to read", async () => {
    const { db, ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    await runStrategyJob(ctx, {
      workspaceId: WORKSPACE,
      userId: USER,
      description: "We sell revenue tooling to B2B teams.",
    });

    const input = strategyMock.mock.calls[0]?.[1] as { websiteText?: string; description?: string };
    expect(input.websiteText).toBeUndefined();
    expect(input.description).toContain("revenue tooling");
    expect(db.rows("business_profiles")).toHaveLength(1);
  });

  it("still produces profiles when the customer's site cannot be read", async () => {
    const { db, ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("DNS failure");
    }));

    // A site that is down at signup must not cost the customer their onboarding.
    await runStrategyJob(ctx, {
      workspaceId: WORKSPACE,
      userId: USER,
      websiteUrl: "https://acme.test",
      description: "We sell revenue tooling.",
    });

    expect(db.rows("business_profiles")).toHaveLength(1);
  });

  it("records who ran it, for the audit trail", async () => {
    const { db, ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });

    const event = db.rows("events").find((e) => e.name === "strategy.profile.created");
    expect(event?.actor_user_id).toBe(USER);
    expect((event?.payload as { profiles: number }).profiles).toBe(3);
  });

  it("passes the website text it scraped to the agent", async () => {
    const { ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });

    const input = strategyMock.mock.calls[0]?.[1] as { websiteText?: string };
    expect(input.websiteText).toContain("revenue tooling");
  });
});
