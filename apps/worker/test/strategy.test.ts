import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockEmailProvider } from "@le/email";
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

function harness(options: { email?: boolean } = {}) {
  const db = new FakeDb();
  db.seed("workspaces", [{ id: WORKSPACE, name: "Acme", plan: "trial" }]);
  db.seed("profiles", [{ id: USER, email: "sam@acme.test", full_name: "Sam Patel" }]);

  const email = options.email ? new MockEmailProvider() : null;
  const ctx = {
    db: db.asDb(),
    email,
    env: { APP_URL: "https://app.test" } as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  return { db, ctx, email };
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

  it("welcomes the owner while the agent is still reading their site", async () => {
    const { ctx, email } = harness({ email: true });
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });

    expect(email!.sent).toHaveLength(1);
    expect(email!.sent[0]?.to).toBe("sam@acme.test");
    expect(email!.sent[0]?.text).toContain("Acme");
  });

  it("welcomes a workspace once, however often the agent is re-run", async () => {
    // Re-running strategy is a normal thing to do when the first profiles were
    // wrong. A second welcome on day nine reads as a product with no memory.
    const { ctx, email } = harness({ email: true });
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });
    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });

    expect(email!.sent).toHaveLength(1);
  });

  it("still writes the profiles when the welcome email cannot be sent", async () => {
    // Email is a notification channel, never a step the job depends on.
    const { db, ctx, email } = harness({ email: true });
    email!.send = async () => {
      throw new Error("resend unavailable");
    };
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    const id = await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });

    expect(id).toBeTruthy();
    expect(db.rows("customer_profiles")).toHaveLength(3);
  });
});

describe("runStrategyJob, adding to a workspace", () => {
  /** A workspace that has already been through its first run. */
  async function started() {
    const { db, ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");
    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, websiteUrl: "https://acme.test" });
    return { db, ctx, runStrategyJob };
  }

  it("adds to the business profile that exists rather than creating a second", async () => {
    // A workspace with two business profiles has its strategy list split
    // across both, and the profile is the thing every strategy hangs off.
    const { db, ctx, runStrategyJob } = await started();
    strategyMock.mockResolvedValue({
      ...OUTPUT,
      customerProfiles: [profile("Chamber leaders", 1), profile("Franchise owners", 2)],
    });

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, expand: true });

    expect(db.rows("business_profiles")).toHaveLength(1);
    expect(db.rows("customer_profiles")).toHaveLength(5);
  });

  it("tells the agent what already exists, so it does not rewrite it", async () => {
    const { ctx, runStrategyJob } = await started();
    strategyMock.mockResolvedValue({ ...OUTPUT, customerProfiles: [profile("New angle", 1)] });

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, expand: true });

    const input = strategyMock.mock.calls.at(-1)![1] as {
      existingProfiles?: { name: string }[];
      want?: number;
    };
    expect(input.existingProfiles?.map((p) => p.name).sort()).toEqual([
      "Agency owners",
      "Founders",
      "Ops leaders",
    ]);
    expect(input.want).toBeGreaterThan(0);
  });

  it("drops a strategy that repeats one already here", async () => {
    // Two strategies covering the same people put one person on two lists, and
    // the never-twice rule then means the second finds nobody — a strategy
    // that can only ever report zero.
    const { db, ctx, runStrategyJob } = await started();
    strategyMock.mockResolvedValue({
      ...OUTPUT,
      customerProfiles: [profile("ops leaders", 1), profile("Chamber leaders", 2)],
    });

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, expand: true });

    expect(db.rows("customer_profiles")).toHaveLength(4);
    const names = db.rows("customer_profiles").map((r) => r.name);
    expect(names).toContain("Chamber leaders");
    // Matched without regard to case, because "Ops leaders" and "ops leaders"
    // are the same segment and a list with both in it reads as a bug.
    expect(names.filter((n) => String(n).toLowerCase() === "ops leaders")).toHaveLength(1);
  });

  it("continues the priority order instead of restarting at one", async () => {
    // Four new strategies each claiming to be the one to pursue first is a
    // ranking that has stopped meaning anything.
    const { db, ctx, runStrategyJob } = await started();
    strategyMock.mockResolvedValue({
      ...OUTPUT,
      customerProfiles: [profile("Chamber leaders", 1), profile("Franchise owners", 2)],
    });

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, expand: true });

    const priorities = db.rows("customer_profiles").map((r) => r.priority).sort((a, b) => Number(a) - Number(b));
    expect(priorities).toEqual([1, 2, 3, 4, 5]);
  });

  it("records how many were kept and how many repeated", async () => {
    // "Asked for four and stored one" is a different thing to look into from
    // "asked for four and stored four".
    const { db, ctx, runStrategyJob } = await started();
    strategyMock.mockResolvedValue({
      ...OUTPUT,
      customerProfiles: [profile("Ops leaders", 1), profile("Chamber leaders", 2)],
    });

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, expand: true });

    const event = db.rows("events").filter((e) => e.name === "strategy.profile.created").at(-1)!;
    const payload = event.payload as { profiles: number; duplicatesDropped: number; expanded: boolean };
    expect(payload.profiles).toBe(1);
    expect(payload.duplicatesDropped).toBe(1);
    expect(payload.expanded).toBe(true);
  });

  it("does not welcome somebody who has been here since day one", async () => {
    const { ctx, runStrategyJob } = await started();
    const withEmail = harness({ email: true });
    strategyMock.mockResolvedValue({ ...OUTPUT, customerProfiles: [profile("New angle", 1)] });

    await runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, expand: true });

    expect(withEmail.email!.sent).toHaveLength(0);
  });

  it("refuses to add to a workspace that has never run", async () => {
    // Rather than quietly creating the first business profile from a request
    // that asked to extend one: the caller believes it has strategies, and
    // finding out it does not is the useful answer.
    const { ctx } = harness();
    const { runStrategyJob } = await import("../src/jobs/strategy.js");

    await expect(
      runStrategyJob(ctx, { workspaceId: WORKSPACE, userId: USER, expand: true }),
    ).rejects.toThrow(/no business profile/i);
  });
});
