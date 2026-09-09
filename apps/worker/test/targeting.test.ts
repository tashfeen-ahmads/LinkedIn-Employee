import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { normalizeExclusionValue } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const BUSINESS = "44444444-4444-4444-8444-444444444444";
const PROFILE = "55555555-5555-4555-8555-555555555555";

const scoreMock = vi.fn();
const campaignMock = vi.fn();

vi.mock("@le/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@le/agents")>();
  return {
    ...actual,
    scoreProspects: (...args: unknown[]) => scoreMock(...args),
    buildCampaign: (...args: unknown[]) => campaignMock(...args),
  };
});

const CUSTOMER_PROFILE = {
  name: "Ops leaders",
  summary: "People who run revenue operations at mid-market B2B companies.",
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
  connectionNote: "Hi {{first_name}}, we work with ops leaders.",
  followUps: [
    { delayDays: 2, message: "Worth a look?" },
    { delayDays: 4, message: "Closing the loop." },
  ],
  priority: 1,
};

const BUSINESS_PROFILE = {
  companyName: "Acme",
  oneLiner: "Acme sells revenue tooling to B2B teams.",
  offering: "A platform for revenue operations.",
  pricingModel: "unknown",
  proofPoints: [],
  toneOfVoice: "Plain and direct.",
  competitors: [],
  commonObjections: [],
  differentiators: [],
};

function candidate(id: string, url: string) {
  return {
    providerId: id,
    linkedinUrl: url,
    firstName: "Jane",
    lastName: id,
    headline: "Head of Operations",
    title: "Head of Operations",
    company: "Northwind",
    signals: [],
  };
}

function harness() {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();

  db.seed("profiles", [{ id: USER, full_name: "Sam Patel", email: "sam@acme.test" }]);
  db.seed("linkedin_accounts", [
    { id: ACCOUNT, workspace_id: WORKSPACE, user_id: USER, provider_account_id: "acct", status: "active" },
  ]);
  db.seed("business_profiles", [{ id: BUSINESS, workspace_id: WORKSPACE, spec: BUSINESS_PROFILE }]);
  db.seed("customer_profiles", [
    {
      id: PROFILE,
      workspace_id: WORKSPACE,
      business_profile_id: BUSINESS,
      name: "Ops leaders",
      spec: CUSTOMER_PROFILE,
      priority: 1,
      do_not_pursue: false,
      approved_at: "2026-09-01T09:00:00Z",
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

const job = { workspaceId: WORKSPACE, customerProfileId: PROFILE, linkedinAccountId: ACCOUNT, userId: USER, limit: 50 };

function ranked(url: string, providerId: string, fitScore: number, disqualified = false) {
  return {
    candidate: candidate(providerId, url),
    fitScore,
    fitReasons: ["Right title"],
    intentScore: 20,
    rank: fitScore,
    disqualified,
    disqualifyReason: disqualified ? "competitor" : undefined,
  };
}

beforeEach(() => {
  scoreMock.mockReset();
  campaignMock.mockReset();
  campaignMock.mockResolvedValue({
    name: "Ops leaders — UK",
    connectionNote: "Hi {{first_name}}, we work with ops leaders.",
    steps: [
      { kind: "follow_up", delayDays: 2, message: "Worth a look?" },
      { kind: "follow_up", delayDays: 4, message: "Closing the loop." },
    ],
    stopConditions: ["prospect replies", "prospect opts out", "meeting booked"],
    dailyInviteCap: 20,
  });
});

describe("runTargetingJob", () => {
  it("creates a draft campaign, never a running one", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/jane-one")], cursor: null };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-one", "p1", 90)]);

    const campaignId = await runTargetingJob(ctx, job);

    expect(campaignId).toBeTruthy();
    // A human reviews the list and the copy before anything is sent.
    expect(db.rows("campaigns")[0]?.status).toBe("draft");
    expect(db.rows("campaign_prospects")[0]?.status).toBe("queued");
  });

  it("excludes anyone the workspace has already touched, whichever rep owns them", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.seed("prospects", [
      {
        workspace_id: WORKSPACE,
        // Stored canonically; the search returns a different spelling of the
        // same person, which must still be recognised.
        linkedin_url: "linkedin.com/in/jane-one",
        owner_user_id: "99999999-9999-4999-8999-999999999999",
      },
    ]);
    linkedin.candidates = {
      items: [candidate("p1", "https://uk.linkedin.com/in/jane-one/"), candidate("p2", "https://www.linkedin.com/in/jane-two")],
      cursor: null,
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-two", "p2", 90)]);

    await runTargetingJob(ctx, job);

    const scored = scoreMock.mock.calls[0]?.[1] as { candidates: Array<{ providerId: string }> };
    expect(scored.candidates.map((c) => c.providerId)).toEqual(["p2"]);
  });

  it("does nothing with a profile a human has not approved", async () => {
    // The Strategy Agent writes profiles; it does not approve them. Searching
    // against an unread description of a customer is how a campaign ends up
    // aimed at the wrong market.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.find("customer_profiles", { id: PROFILE })!.approved_at = null;
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/jane-one")], cursor: null };

    expect(await runTargetingJob(ctx, job)).toBeNull();
    expect(db.rows("campaigns")).toHaveLength(0);
    // Not even the search runs: Sales Navigator credits are finite.
    expect(linkedin.searches).toHaveLength(0);
  });

  it("never puts an excluded account in front of the scoring model", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.seed("exclusions", [
      {
        id: "excl-1",
        workspace_id: WORKSPACE,
        kind: "company",
        value: normalizeExclusionValue("company", "Northwind Ltd."),
        raw_value: "Northwind Ltd.",
        reason: "existing customer",
      },
    ]);
    linkedin.candidates = {
      // Both work at Northwind; the exclusion is on the account, so both go.
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one"), candidate("p2", "https://www.linkedin.com/in/jane-two")],
      cursor: null,
    };

    const campaignId = await runTargetingJob(ctx, job);

    expect(campaignId).toBeNull();
    // Not merely unqueued — never scored, so an off-limits account costs
    // nothing in model spend either.
    expect(scoreMock).not.toHaveBeenCalled();
  });

  it("drops disqualified and low-fit prospects before anyone is queued", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/a"), candidate("p2", "https://www.linkedin.com/in/b"), candidate("p3", "https://www.linkedin.com/in/c")],
      cursor: null,
    };
    scoreMock.mockResolvedValue([
      ranked("https://www.linkedin.com/in/a", "p1", 92),
      ranked("https://www.linkedin.com/in/b", "p2", 40),
      ranked("https://www.linkedin.com/in/c", "p3", 95, true),
    ]);

    await runTargetingJob(ctx, job);

    // A short list of good prospects beats a long list of bad ones.
    expect(db.rows("campaign_prospects")).toHaveLength(1);
    expect(db.rows("prospects")).toHaveLength(1);
    expect(db.rows("prospects")[0]?.fit_score).toBe(92);
  });

  it("does nothing when every candidate is already known", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.seed("prospects", [{ workspace_id: WORKSPACE, linkedin_url: "linkedin.com/in/jane-one" }]);
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/jane-one")], cursor: null };

    expect(await runTargetingJob(ctx, job)).toBeNull();
    expect(scoreMock).not.toHaveBeenCalled();
    expect(db.rows("campaigns")).toHaveLength(0);
  });

  it("does nothing when nothing clears the fit threshold", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 55)]);

    expect(await runTargetingJob(ctx, job)).toBeNull();
    expect(campaignMock).not.toHaveBeenCalled();
    expect(db.rows("campaigns")).toHaveLength(0);
  });

  it("refuses a profile the rep marked do-not-pursue", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.find("customer_profiles", { id: PROFILE })!.do_not_pursue = true;
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null };

    expect(await runTargetingJob(ctx, job)).toBeNull();
    expect(linkedin.sentInvitations).toHaveLength(0);
    expect(db.rows("campaigns")).toHaveLength(0);
  });

  it("refuses to build a campaign on a paused LinkedIn account", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.find("linkedin_accounts", { id: ACCOUNT })!.status = "restricted";
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null };

    expect(await runTargetingJob(ctx, job)).toBeNull();
    expect(db.rows("campaigns")).toHaveLength(0);
  });

  it("stores prospects under the canonical URL so a later run dedupes against them", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://UK.LinkedIn.com/in/Jane-One/?trk=abc")], cursor: null };
    scoreMock.mockResolvedValue([ranked("https://UK.LinkedIn.com/in/Jane-One/?trk=abc", "p1", 88)]);

    await runTargetingJob(ctx, job);

    expect(db.rows("prospects")[0]?.linkedin_url).toBe("linkedin.com/in/jane-one");
  });

  it("writes the campaign steps in order with their delays", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 90)]);

    await runTargetingJob(ctx, job);

    const steps = db.rows("campaign_steps").sort((a, b) => Number(a.step_number) - Number(b.step_number));
    expect(steps.map((s) => s.step_number)).toEqual([1, 2]);
    expect(steps[0]?.delay_days).toBe(2);
  });

  it("caps the daily invite rate at the product's own maximum", async () => {
    const { ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    const { LINKEDIN_LIMITS } = await import("@le/shared");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 90)]);

    await runTargetingJob(ctx, job);

    const passed = campaignMock.mock.calls[0]?.[1] as { dailyInviteCap: number };
    expect(passed.dailyInviteCap).toBeLessThanOrEqual(LINKEDIN_LIMITS.invitesPerDayMax);
  });

  it("records what it did, for the audit trail", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 90)]);

    await runTargetingJob(ctx, job);

    const event = db.rows("events").find((e) => e.name === "campaign.created");
    expect(event).toBeTruthy();
    expect((event?.payload as { prospects: number }).prospects).toBe(1);
  });
});
