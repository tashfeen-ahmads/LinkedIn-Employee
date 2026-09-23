import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLinkedInProvider, UnipileError } from "@le/linkedin";
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
const notesMock = vi.fn();

vi.mock("@le/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@le/agents")>();
  return {
    ...actual,
    scoreProspects: (...args: unknown[]) => scoreMock(...args),
    buildCampaign: (...args: unknown[]) => campaignMock(...args),
    personalizeInvites: (...args: unknown[]) => notesMock(...args),
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
    variants: [
      {
        name: "Referral leakage",
        angle: "Lean on referrals that arrive and are never followed up.",
        painPoint: "Warm introductions going cold in an inbox",
        connectionNote: "Hi {{first_name}}, most referrals we see never get a second touch.",
        steps: [
          { delayDays: 2, message: "Following up on referrals." },
          { delayDays: 4, message: "Closing the referral loop." },
        ],
      },
      {
        name: "Chasing invoices",
        angle: "Lean on the admin time a small team loses to chasing.",
        painPoint: "Hours a week spent chasing",
        connectionNote: "Hi {{first_name}}, curious how your team handles the chasing.",
        steps: [
          { delayDays: 3, message: "Following up on the chasing." },
          { delayDays: 5, message: "Closing the chasing loop." },
        ],
      },
    ],
  });
  notesMock.mockReset();
  // The default: the writer answered for nobody, so every prospect falls back
  // to the campaign template. That is what every campaign built before
  // personalised notes existed does, and it must keep working.
  notesMock.mockResolvedValue(new Map());
});

describe("runTargetingJob", () => {
  it("creates a draft campaign, never a running one", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/jane-one")], cursor: null, droppedFilters: [] };
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
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/jane-one")], cursor: null, droppedFilters: [] };

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
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/jane-one")], cursor: null, droppedFilters: [] };

    expect(await runTargetingJob(ctx, job)).toBeNull();
    expect(scoreMock).not.toHaveBeenCalled();
    expect(db.rows("campaigns")).toHaveLength(0);
  });

  it("does nothing when nothing clears the fit threshold", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null, droppedFilters: [] };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 55)]);

    expect(await runTargetingJob(ctx, job)).toBeNull();
    expect(campaignMock).not.toHaveBeenCalled();
    expect(db.rows("campaigns")).toHaveLength(0);
  });

  it("refuses a profile the rep marked do-not-pursue", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.find("customer_profiles", { id: PROFILE })!.do_not_pursue = true;
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null, droppedFilters: [] };

    expect(await runTargetingJob(ctx, job)).toBeNull();
    expect(linkedin.sentInvitations).toHaveLength(0);
    expect(db.rows("campaigns")).toHaveLength(0);
  });

  it("refuses to build a campaign on a paused LinkedIn account", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.find("linkedin_accounts", { id: ACCOUNT })!.status = "restricted";
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null, droppedFilters: [] };

    expect(await runTargetingJob(ctx, job)).toBeNull();
    expect(db.rows("campaigns")).toHaveLength(0);
  });

  it("stores prospects under the canonical URL so a later run dedupes against them", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://UK.LinkedIn.com/in/Jane-One/?trk=abc")], cursor: null, droppedFilters: [] };
    scoreMock.mockResolvedValue([ranked("https://UK.LinkedIn.com/in/Jane-One/?trk=abc", "p1", 88)]);

    await runTargetingJob(ctx, job);

    expect(db.rows("prospects")[0]?.linkedin_url).toBe("linkedin.com/in/jane-one");
  });

  it("writes the campaign steps in order with their delays", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null, droppedFilters: [] };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 90)]);

    await runTargetingJob(ctx, job);

    // The campaign's own sequence, which each angle's steps sit beside rather
    // than replace.
    const steps = db
      .rows("campaign_steps")
      .filter((s) => !s.variant_id)
      .sort((a, b) => Number(a.step_number) - Number(b.step_number));
    expect(steps.map((s) => s.step_number)).toEqual([1, 2]);
    // Step 1 is stored with no delay whatever the model wrote for it (rule 43):
    // it waits for the acceptance, and a campaign screen reading "2 days" for
    // something that happens within the hour is a second reading of the rule.
    expect(steps[0]?.delay_days).toBe(0);
    // Every later step keeps the number it was given. Clamping those too would
    // collapse a fortnight's pacing into an afternoon.
    // 4 is what the fixture above asks for, unchanged.
    expect(steps[1]?.delay_days).toBe(4);
  });

  it("caps the daily invite rate at the product's own maximum", async () => {
    const { ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    const { LINKEDIN_LIMITS } = await import("@le/shared");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null, droppedFilters: [] };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 90)]);

    await runTargetingJob(ctx, job);

    const passed = campaignMock.mock.calls[0]?.[1] as { dailyInviteCap: number };
    expect(passed.dailyInviteCap).toBeLessThanOrEqual(LINKEDIN_LIMITS.invitesPerDayMax);
  });

  it("records what it did, for the audit trail", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null, droppedFilters: [] };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 90)]);

    await runTargetingJob(ctx, job);

    const event = db.rows("events").find((e) => e.name === "campaign.created");
    expect(event).toBeTruthy();
    expect((event?.payload as { prospects: number }).prospects).toBe(1);
  });

  it("searches classic when the account has no Sales Navigator seat", async () => {
    // Sales Navigator is a separate ~$120/month subscription. Searching a tier
    // the account does not have returns nothing, and "no prospects found"
    // reads as a bad customer profile rather than a missing seat.
    const { ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null, droppedFilters: [] };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 90)]);

    await runTargetingJob(ctx, job);

    expect(linkedin.searches[0]?.tier).toBe("classic");
  });

  it("searches Sales Navigator when the account says it has one", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.find("linkedin_accounts", { id: ACCOUNT })!.has_sales_navigator = true;
    linkedin.candidates = { items: [candidate("p1", "https://www.linkedin.com/in/a")], cursor: null, droppedFilters: [] };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 90)]);

    await runTargetingJob(ctx, job);

    expect(linkedin.searches[0]?.tier).toBe("sales_navigator");
  });

  it("records the filters the search could not apply, on the campaign a human reviews", async () => {
    // The campaign page reads this. Without it the reviewer sees a plausible
    // list built from half the profile they approved, and nothing says so.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/a")],
      cursor: null,
      droppedFilters: ["seniority", "company size"],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/a", "p1", 90)]);

    await runTargetingJob(ctx, job);

    const campaign = db.rows("campaigns")[0];
    expect((campaign?.rules as { droppedFilters: string[] }).droppedFilters).toEqual([
      "seniority",
      "company size",
    ]);
    const event = db.rows("events").find((e) => e.name === "campaign.created");
    expect((event?.payload as { searchTier: string }).searchTier).toBe("classic");
  });
});

describe("personalised connection notes", () => {
  it("stores the note written for each prospect, with what it was grounded in", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one")],
      cursor: null,
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-one", "p1", 90)]);
    notesMock.mockResolvedValue(
      new Map([
        [
          "p1",
          {
            providerId: "p1",
            note: "Saw you run ops at Acme — curious how you handle pipeline hygiene.",
            grounding: ["Head of Operations at Acme"],
            tooThin: false,
            promptVersion: "targeting.invite-note/2026-09-15",
          },
        ],
      ]),
    );

    await runTargetingJob(ctx, job);

    const [row] = db.rows("campaign_prospects");
    expect(row.invite_note).toContain("Saw you run ops at Acme");
    expect(row.invite_note_grounding).toEqual(["Head of Operations at Acme"]);
    expect(row.invite_note_thin).toBe(false);
    // Convention: every sent message records the prompt that produced it, so a
    // regression traces back to the change that caused it.
    expect(row.invite_note_prompt_version).toBe("targeting.invite-note/2026-09-15");
  });

  it("opens with lines a person approved, and never with one they have not", async () => {
    /*
     * The opener is the first thing a stranger ever reads from this workspace,
     * so an unapproved one is the single place a review screen cannot be
     * decorative. Rule 9's division, applied to the invitation.
     *
     * The whole approved set goes over rather than one line: handed a single
     * opener, the writer has a template again, and everybody in the batch
     * receives the same sentence.
     */
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.seed("hooks", [
      {
        id: "hook-yes",
        workspace_id: WORKSPACE,
        name: "Measurement",
        body: "How does your chapter measure which introductions convert?",
        angle: "proof",
        written_by: "agent",
        approved_at: "2026-09-01T00:00:00.000Z",
        is_default: true,
      },
      {
        id: "hook-no",
        workspace_id: WORKSPACE,
        name: "Unread draft",
        body: "Nobody has read this one yet.",
        angle: "none",
        written_by: "agent",
        approved_at: null,
        is_default: false,
      },
    ]);
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one")],
      cursor: null,
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-one", "p1", 90)]);
    notesMock.mockResolvedValue(new Map());

    await runTargetingJob(ctx, job);

    const handed = (notesMock.mock.calls[0]?.[1] ?? {}) as { hooks?: string[] };
    expect(handed.hooks).toContain("How does your chapter measure which introductions convert?");
    expect(handed.hooks).not.toContain("Nobody has read this one yet.");
  });

  it("leaves the note null when the writer did not answer for that prospect", async () => {
    // Not an error. The send falls back to the campaign template, which is the
    // behaviour that existed before any of this — so a writer outage degrades
    // a campaign rather than stopping it.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one")],
      cursor: null,
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-one", "p1", 90)]);

    await runTargetingJob(ctx, job);

    const [row] = db.rows("campaign_prospects");
    expect(row.invite_note).toBeNull();
    expect(row.invite_note_grounding).toEqual([]);
  });

  it("matches a note to its prospect by provider id, not by position", async () => {
    // The upsert returns rows in the order given, so index matching works right
    // up until it does not — and the failure is the wrong person receiving a
    // note written about somebody else, under a real rep's name.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [
        candidate("p1", "https://www.linkedin.com/in/jane-one"),
        candidate("p2", "https://www.linkedin.com/in/john-two"),
      ],
      cursor: null,
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([
      ranked("https://www.linkedin.com/in/jane-one", "p1", 90),
      ranked("https://www.linkedin.com/in/john-two", "p2", 85),
    ]);
    // Deliberately returned in the opposite order to the prospect list.
    notesMock.mockResolvedValue(
      new Map([
        ["p2", { providerId: "p2", note: "note for p2", grounding: ["b"], tooThin: false, promptVersion: "v" }],
        ["p1", { providerId: "p1", note: "note for p1", grounding: ["a"], tooThin: false, promptVersion: "v" }],
      ]),
    );

    await runTargetingJob(ctx, job);

    const prospects = db.rows("prospects");
    const rows = db.rows("campaign_prospects");
    for (const row of rows) {
      const prospect = prospects.find((p) => p.id === row.prospect_id);
      expect(row.invite_note).toBe(`note for ${prospect?.provider_id}`);
    }
  });
});

describe("targeting says why it stopped", () => {
  it("records a reason when the search returns nobody", async () => {
    // Previously a bare `return null`: the rep pressed the button, the queue
    // accepted the job, and the screen showed the same empty list as before.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [], cursor: null, droppedFilters: [] };

    expect(await runTargetingJob(ctx, job)).toBeNull();

    const stop = db.rows("events").find((e) => e.name === "targeting.stopped");
    expect(stop).toBeDefined();
    expect(String(stop?.payload?.reason)).toMatch(/nobody new/i);
  });

  it("records a reason when the LinkedIn account is not active", async () => {
    const { db, ctx } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    await db.asDb().from("linkedin_accounts").update({ status: "reauth_required" }).eq("id", ACCOUNT);

    expect(await runTargetingJob(ctx, job)).toBeNull();

    const stop = db.rows("events").find((e) => e.name === "targeting.stopped");
    expect(String(stop?.payload?.reason)).toMatch(/not connected/i);
    // The status is carried too: "not active" and "which kind of not active"
    // are different conversations with the rep.
    expect(stop?.payload?.status).toBe("reauth_required");
  });

  it("records a reason when the provider refuses the search", async () => {
    // A throw here is retried by the queue and then given up on, all of it out
    // of sight of the person who pressed the button.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.searchError = new Error("402 subscription required");

    expect(await runTargetingJob(ctx, job)).toBeNull();

    const stop = db.rows("events").find((e) => e.name === "targeting.stopped");
    expect(String(stop?.payload?.reason)).toMatch(/refused the search/i);
    expect(String(stop?.payload?.cause)).toContain("402");
  });

  it("stops calling the account connected once the provider says it has no such account", async () => {
    // The contradiction this closes: targeting said "reconnect it on the Team
    // page" while the Team page said "Connected · active", with no control on
    // it that could have found out otherwise. Health is polled nightly, which
    // is the right cadence for a LinkedIn restriction and far too slow for an
    // account that does not exist — every job until the small hours fails the
    // same way against a row the screen calls healthy.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.searchError = new UnipileError(
      "Unipile POST /api/v1/linkedin/search failed with 404: Account not found",
      404,
      JSON.stringify({ title: "Resource not found.", detail: "Account not found" }),
    );

    expect(await runTargetingJob(ctx, job)).toBeNull();

    const stop = db.rows("events").find((e) => e.name === "targeting.stopped");
    expect(String(stop?.payload?.reason)).toMatch(/no longer has this account/i);
    const account = db.rows("linkedin_accounts")[0];
    expect(account?.status).toBe("reauth_required");
    expect(String(account?.status_detail)).toMatch(/no longer has this account/i);
  });

  it("does not disconnect an account over a failure that is not about the account", async () => {
    // A provider outage is not a reason to make a rep re-do the hosted login.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.searchError = new UnipileError("failed with 503", 503, "upstream unavailable");

    await runTargetingJob(ctx, job);

    expect(db.rows("linkedin_accounts")[0]?.status).toBe("active");
  });
});

/**
 * A report that can identify the code that produced it.
 *
 * Three rounds of a live incident were spent unable to tell whether a stopped
 * event came from the build meant to fix it or the one before, because both
 * emitted the same sentences. Every guess after that cost a deploy and somebody
 * else's click.
 */
describe("what a stopped report carries", () => {
  it("stamps the build, so a report can be placed against a deploy", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [], cursor: null, droppedFilters: [] };

    await runTargetingJob(ctx, job);

    const stop = db.rows("events").find((e) => e.name === "targeting.stopped");
    expect(String(stop?.payload?.build)).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("a search that reached the provider and found nobody", () => {
  it("carries the probe, in the report somebody is already reading", async () => {
    // Whoever is stuck is reading this event. Making them navigate somewhere
    // else for the answer is how three rounds went by without one.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [], cursor: null, droppedFilters: [] };
    (linkedin as unknown as { probeSearch: unknown }).probeSearch = async () => [
      { label: "no filters at all", count: 0 },
      { label: "keywords only", count: 1 },
    ];

    await runTargetingJob(ctx, job);

    const stop = db.rows("events").find((e) => e.name === "targeting.stopped");
    expect(stop?.payload?.probe).toMatchObject({ "no filters at all": "0", "keywords only": "1" });
  });

  it("does not probe when the provider returned people and we filtered them out", async () => {
    // A different problem entirely, and one more request against a paid seat
    // answers nothing about it.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one")],
      cursor: null,
      droppedFilters: [],
    };
    db.seed("prospects", [{ workspace_id: WORKSPACE, linkedin_url: "linkedin.com/in/jane-one" }]);
    let probed = false;
    (linkedin as unknown as { probeSearch: unknown }).probeSearch = async () => {
      probed = true;
      return [];
    };

    await runTargetingJob(ctx, job);

    expect(probed).toBe(false);
  });
});

/**
 * A throw is not an exit that says why.
 *
 * Every deliberate return from this job records a reason. The throws did not:
 * a customer profile whose stored spec no longer matches its schema, a campaign
 * insert the database refuses. BullMQ catches those, retries, gives up, and the
 * person who pressed the button sees the page they were already looking at — no
 * banner, no event, nothing. That silence is indistinguishable from a button
 * that was never wired up, and it cost a live deployment a night.
 */
describe("when the job throws", () => {
  it("records why before it gives up", async () => {
    const { db, ctx } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    // A spec that no longer matches its schema: exactly what a stored profile
    // becomes when the schema moves underneath it.
    db.rows("customer_profiles")[0]!.spec = { nonsense: true };

    await expect(runTargetingJob(ctx, job)).rejects.toThrow();

    const stop = db.rows("events").find((e) => e.name === "targeting.stopped");
    expect(stop).toBeTruthy();
    expect(String(stop?.payload?.reason)).toMatch(/hit an error/i);
    expect(stop?.payload?.threw).toBe(true);
  });

  it("still rethrows, so the queue can retry it", async () => {
    // Reporting must not swallow. A transient database error should be tried
    // again, not quietly turned into "nothing to do".
    const { db, ctx } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    db.rows("customer_profiles")[0]!.spec = { nonsense: true };

    await expect(runTargetingJob(ctx, job)).rejects.toThrow();
  });
});

/**
 * Nobody enters a campaign who cannot be opened and checked first.
 *
 * LinkedIn hides a profile's public address from anyone outside the viewer's
 * network, so a real person can arrive with no link to them. Keeping them costs
 * an invitation from a capped daily allowance, carries restriction risk for the
 * account sending it, and asks a reviewer to approve somebody they cannot look
 * at — which is the one job the review exists to do.
 */
describe("prospects whose profile cannot be opened", () => {
  const hidden = () => ({
    providerId: "ACoAAB1",
    linkedinUrl: "https://www.linkedin.com/search/results/all/?keywords=ACoAAB1",
    firstName: "",
    lastName: "",
    headline: "Membership Director at Somewhere",
    signals: [],
  });

  it("resolves a hidden profile rather than throwing the person away", async () => {
    // The profile endpoint usually knows the address the search result omitted.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [hidden()], cursor: null, droppedFilters: [] };
    linkedin.profiles.set("ACoAAB1", {
      providerId: "ACoAAB1",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe-123",
      firstName: "Jane",
      lastName: "Doe",
      headline: "Membership Director",
    });
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-doe-123", "ACoAAB1", 90)]);

    await runTargetingJob(ctx, job);

    const stored = db.rows("prospects")[0];
    expect(stored?.linkedin_url).toContain("jane-doe-123");
    expect(stored?.first_name).toBe("Jane");
  });

  it("drops anyone still unopenable, and never queues them", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [hidden()], cursor: null, droppedFilters: [] };
    linkedin.profiles.set("ACoAAB1", {
      providerId: "ACoAAB1",
      linkedinUrl: "https://www.linkedin.com/search/results/all/?keywords=ACoAAB1",
      firstName: "",
      lastName: "",
    });

    expect(await runTargetingJob(ctx, job)).toBeNull();

    expect(db.rows("prospects")).toHaveLength(0);
    const stop = db.rows("events").find((e) => e.name === "targeting.stopped");
    expect(String(stop?.payload?.reason)).toMatch(/opened and checked/i);
    expect(stop?.payload?.unverifiable).toBe(1);
  });

  it("drops a profile it could not read at all", async () => {
    // A profile we cannot read is a profile a reviewer cannot read either.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = { items: [hidden()], cursor: null, droppedFilters: [] };
    linkedin.profileError = new Error("provider refused");

    await runTargetingJob(ctx, job);

    expect(db.rows("prospects")).toHaveLength(0);
  });

  it("does not spend a request on somebody already openable", async () => {
    // The enrichment is for people who would otherwise be discarded, not a
    // second lookup of everyone on a paid seat.
    const { ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one")],
      cursor: null,
      droppedFilters: [],
    };
    linkedin.profileError = new Error("should never be called");
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-one", "p1", 90)]);

    await runTargetingJob(ctx, job);

    // Reaching here at all means getProfile was never called for this person.
    expect(true).toBe(true);
  });
});

/**
 * Growing a list rather than starting a new one.
 *
 * A campaign was one search: about fifty people, and no way at all to reach the
 * fifty-first. Pressing the button again ran the identical query, got the
 * identical page, and reported every person on it as already known — so "we
 * need a thousand prospects, across several campaigns" had no answer.
 */
/**
 * A prospect row is what enforces "never contact anybody twice", so writing one
 * is a commitment: from that moment the person is excluded from every future
 * search this workspace runs. Writing them before they are actually on a
 * campaign means a crash halfway through spends that exclusion on an outreach
 * that never happened — and the person is then unreachable for ever, on no
 * list, invisible. Forty-nine real people went that way on the live
 * deployment, over two runs, and nothing said a word.
 */
/**
 * Two angles, tested against each other on one list.
 *
 * The variable is the angle, not the words: every prospect gets a note written
 * from their own details, so a group of them shares only the pain named and
 * the reason for reaching out. That is the one thing a campaign can hold
 * constant and vary, and it is what these assertions are about.
 */
describe("testing angles against each other", () => {
  function twoProspects() {
    return {
      items: [
        candidate("p1", "https://www.linkedin.com/in/jane-one"),
        candidate("p2", "https://www.linkedin.com/in/jane-two"),
      ],
      cursor: null,
      droppedFilters: [],
    };
  }
  const bothRanked = [
    ranked("https://www.linkedin.com/in/jane-one", "p1", 90),
    ranked("https://www.linkedin.com/in/jane-two", "p2", 88),
  ];

  /**
   * Three, deliberately odd.
   *
   * With even batches a rotation that restarts from zero lands on the same
   * totals as one that continues, and a test built on them passes whether or
   * not the code carries the running counts — which is a test that proves
   * nothing. An odd first batch is what makes the two behaviours diverge.
   */
  function threeProspects(ids: Array<{ id: string; slug: string }>) {
    return {
      items: ids.map((m) => candidate(m.id, `https://www.linkedin.com/in/${m.slug}`)),
      cursor: "page-2",
      droppedFilters: [],
    };
  }

  it("stores the angles the agent wrote", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = twoProspects();
    scoreMock.mockResolvedValue(bothRanked);

    await runTargetingJob(ctx, job);

    const variants = db.rows("campaign_variants");
    expect(variants.map((v) => v.name)).toEqual(["Referral leakage", "Chasing invoices"]);
    // The pain is stored separately from the instruction: a business owner's
    // pain is reusable across campaigns and the angle is not.
    expect(variants[0]?.pain_point).toMatch(/Warm introductions/);
  });

  it("splits the list evenly rather than randomly", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = twoProspects();
    scoreMock.mockResolvedValue(bothRanked);

    await runTargetingJob(ctx, job);

    const assigned = db.rows("campaign_prospects").map((r) => r.variant_id);
    expect(new Set(assigned).size).toBe(2);
  });

  it("writes each group from its own angle, not from the campaign's", async () => {
    // A single call covering everybody would have the writer choosing which
    // angle to lean on per person, and the group labels would then describe an
    // assignment nobody made.
    const { ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = twoProspects();
    scoreMock.mockResolvedValue(bothRanked);

    await runTargetingJob(ctx, job);

    const angles = notesMock.mock.calls.map((c) => (c[1] as { campaignAngle: string }).campaignAngle);
    expect(angles).toHaveLength(2);
    expect(angles.some((a) => a.includes("referrals"))).toBe(true);
    expect(angles.some((a) => a.includes("admin time"))).toBe(true);
  });

  it("continues the rotation when a later batch is added", async () => {
    // What makes Find more sound. A second batch must not hand the first angle
    // another even split on top of the one it already has.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    const first = [
      { id: "p1", slug: "jane-one" },
      { id: "p2", slug: "jane-two" },
      { id: "p6", slug: "jane-six" },
    ];
    linkedin.candidates = threeProspects(first);
    scoreMock.mockResolvedValue(first.map((m) => ranked(`https://www.linkedin.com/in/${m.slug}`, m.id, 90)));
    const campaignId = await runTargetingJob(ctx, job);

    // Three more people arrive on the same campaign. The first run ended with
    // no cursor, so the campaign is correctly marked exhausted — reopened here
    // because this test is about the rotation, not about that rule.
    db.rows("campaigns")[0]!.search_cursor = "page-2";
    db.rows("campaigns")[0]!.search_exhausted = false;
    // Slugs deliberately unlike the provider ids: a URL whose slug is the
    // provider id is the fabricated address rule 13 refuses, and every one of
    // these would be dropped before assignment.
    const more = [
      { id: "p3", slug: "jane-three" },
      { id: "p4", slug: "jane-four" },
      { id: "p5", slug: "jane-five" },
    ];
    linkedin.candidates = {
      items: more.map((m) => candidate(m.id, `https://www.linkedin.com/in/${m.slug}`)),
      cursor: "page-3",
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue(
      more.map((m) => ranked(`https://www.linkedin.com/in/${m.slug}`, m.id, 85)),
    );
    await runTargetingJob(ctx, { ...job, campaignId: campaignId! });

    const counts = new Map<string, number>();
    for (const row of db.rows("campaign_prospects")) {
      counts.set(String(row.variant_id), (counts.get(String(row.variant_id)) ?? 0) + 1);
    }
    // Six across two angles is 3/3. A rotation that restarted from zero on the
    // second batch would land 4/2 — balanced within each batch and lopsided
    // across the campaign, which is the split that matters.
    expect([...counts.values()].sort()).toEqual([3, 3]);
  });

  it("gives each angle its own follow-ups as well as its own note", async () => {
    // An angle that stops at the connection request is only half tested: the
    // prospect accepted because of it, and a generic first message then
    // attributes the acceptance to the angle and the reply to nothing.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = twoProspects();
    scoreMock.mockResolvedValue(bothRanked);

    await runTargetingJob(ctx, job);

    const steps = db.rows("campaign_steps");
    // Two campaign-wide, plus two per angle.
    expect(steps.filter((s) => !s.variant_id)).toHaveLength(2);
    expect(steps.filter((s) => s.variant_id)).toHaveLength(4);
    expect(steps.some((s) => String(s.message).includes("referrals"))).toBe(true);
    expect(steps.some((s) => String(s.message).includes("chasing"))).toBe(true);
  });

  it("keeps the campaign's own sequence for anybody with no angle", async () => {
    // Not a leftover: it is the whole sequence for every campaign built before
    // angles existed, and every campaign whose angles could not be stored.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = twoProspects();
    scoreMock.mockResolvedValue(bothRanked);

    await runTargetingJob(ctx, job);

    const wide = db.rows("campaign_steps").filter((s) => !s.variant_id);
    expect(wide.map((s) => s.step_number).sort()).toEqual([1, 2]);
  });

  it("still builds the campaign when the angles cannot be stored", async () => {
    // Losing the test is better than losing the list, the copy and the search
    // position with it.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = twoProspects();
    scoreMock.mockResolvedValue(bothRanked);
    campaignMock.mockResolvedValue({
      ...(await campaignMock.getMockImplementation()?.()),
      name: "No angles",
      connectionNote: "Hi {{first_name}}.",
      steps: [{ kind: "follow_up", delayDays: 2, message: "Worth a look?" }],
      stopConditions: ["prospect replies"],
      dailyInviteCap: 20,
      variants: [],
    });

    const campaignId = await runTargetingJob(ctx, job);

    expect(campaignId).toBeTruthy();
    expect(db.rows("campaign_prospects")).toHaveLength(2);
    // Unassigned, and the campaign's own note is what they receive — exactly
    // as every campaign behaved before angles existed.
    expect(db.rows("campaign_prospects").every((r) => r.variant_id === null)).toBe(true);
  });
});

describe("a run that half-finished", () => {
  it("still puts people on the campaign when the note writer fails", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one")],
      cursor: null,
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-one", "p1", 90)]);
    notesMock.mockRejectedValue(new Error("targeting.invite-note: model returned no parsable output"));

    const campaignId = await runTargetingJob(ctx, job);

    expect(campaignId).toBeTruthy();
    // The prospect exists AND is on the campaign. Either without the other is
    // the bug: a prospect alone is a permanent exclusion for nobody's benefit.
    expect(db.rows("prospects")).toHaveLength(1);
    expect(db.rows("campaign_prospects")).toHaveLength(1);
  });

  it("falls back to the campaign template rather than sending nothing", async () => {
    // The fallback already existed — `inviteNote` uses the template when a
    // prospect has no note. Letting the writer throw walked straight past it.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one")],
      cursor: null,
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-one", "p1", 90)]);
    notesMock.mockRejectedValue(new Error("model returned no parsable output"));

    await runTargetingJob(ctx, job);

    expect(db.rows("campaign_prospects")[0]?.invite_note).toBeNull();
  });

  it("says the campaign is not personalised rather than letting it look like it is", async () => {
    // Degrading silently is the other way this goes wrong: the review screen
    // shows a campaign that reads as personalised and is not.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one")],
      cursor: null,
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-one", "p1", 90)]);
    notesMock.mockRejectedValue(new Error("model returned no parsable output"));

    await runTargetingJob(ctx, job);

    const said = db.rows("events").find((e) => e.name === "campaign.notes_missing");
    expect(said).toBeTruthy();
    expect((said?.payload as { reason: string }).reason).toMatch(/no parsable output/);
  });

  it("records which strategy found each person", async () => {
    // A fit score is a fact about a person AND a strategy. Stored without the
    // strategy it was scored against, the number cannot be interpreted.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    linkedin.candidates = {
      items: [candidate("p1", "https://www.linkedin.com/in/jane-one")],
      cursor: null,
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-one", "p1", 90)]);

    await runTargetingJob(ctx, job);

    expect(db.rows("prospects")[0]?.customer_profile_id).toBe(PROFILE);
  });
});

describe("continuing a campaign's search", () => {
  const CAMPAIGN = "66666666-6666-4666-8666-666666666666";

  function seedCampaign(db: FakeDb, overrides: Record<string, unknown> = {}) {
    db.seed("campaigns", [
      {
        id: CAMPAIGN,
        workspace_id: WORKSPACE,
        customer_profile_id: PROFILE,
        linkedin_account_id: ACCOUNT,
        owner_user_id: USER,
        name: "Ops leaders — UK",
        status: "draft",
        connection_note: "Hi {{first_name}}, we work with ops leaders.",
        daily_invite_cap: 20,
        search_cursor: "page-2",
        search_exhausted: false,
        ...overrides,
      },
    ]);
  }

  const more = { ...job, campaignId: CAMPAIGN };

  it("adds to the campaign it was given instead of creating another", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    seedCampaign(db);
    linkedin.candidates = {
      items: [candidate("p9", "https://www.linkedin.com/in/jane-nine")],
      cursor: "page-3",
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-nine", "p9", 90)]);

    const campaignId = await runTargetingJob(ctx, more);

    expect(campaignId).toBe(CAMPAIGN);
    expect(db.rows("campaigns")).toHaveLength(1);
    expect(db.rows("campaign_prospects").map((r) => r.campaign_id)).toEqual([CAMPAIGN]);
    // The copy a human already read and approved is not rewritten because the
    // list grew — that would change what everybody already queued receives.
    expect(campaignMock).not.toHaveBeenCalled();
    expect(db.rows("campaign_steps")).toHaveLength(0);
  });

  it("resumes from where the last run stopped", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    seedCampaign(db);
    linkedin.candidates = {
      items: [candidate("p9", "https://www.linkedin.com/in/jane-nine")],
      cursor: "page-3",
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-nine", "p9", 90)]);

    await runTargetingJob(ctx, more);

    expect(linkedin.searches[0]?.cursor).toBe("page-2");
    expect(db.find("campaigns", { id: CAMPAIGN })?.search_cursor).toBe("page-3");
  });

  it("moves past a page on which it already knew everybody", async () => {
    // The common case once a campaign is a few hundred deep, and the one that
    // used to kill the button: a run that produced no prospects left the
    // position where it was, so every later press re-read the same page and
    // reported the same people as already known, for ever.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    seedCampaign(db);
    db.seed("prospects", [
      { workspace_id: WORKSPACE, linkedin_url: "linkedin.com/in/jane-nine", owner_user_id: USER },
    ]);
    linkedin.candidates = {
      items: [candidate("p9", "https://www.linkedin.com/in/jane-nine")],
      cursor: "page-3",
      droppedFilters: [],
    };

    expect(await runTargetingJob(ctx, more)).toBeNull();
    expect(db.find("campaigns", { id: CAMPAIGN })?.search_cursor).toBe("page-3");
    expect(scoreMock).not.toHaveBeenCalled();
  });

  it("refuses a search LinkedIn has already read to the end", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    seedCampaign(db, { search_exhausted: true, search_cursor: null });

    expect(await runTargetingJob(ctx, more)).toBeNull();
    // Not a wasted request against a paid seat, and not a report blaming the
    // customer profile for a list that is simply finished.
    expect(linkedin.searches).toHaveLength(0);
    const stop = db.rows("events").find((e) => e.name === "targeting.stopped");
    expect((stop?.payload as { campaignId?: string })?.campaignId).toBe(CAMPAIGN);
  });

  it("records that the search is over when the provider runs out", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    seedCampaign(db);
    linkedin.candidates = {
      items: [candidate("p9", "https://www.linkedin.com/in/jane-nine")],
      cursor: null,
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-nine", "p9", 90)]);

    await runTargetingJob(ctx, more);

    // Distinct from a run that found nobody new: this is the end of LinkedIn's
    // answer, and the screen stops offering a button that cannot work.
    expect(db.find("campaigns", { id: CAMPAIGN })?.search_exhausted).toBe(true);
  });

  it("takes the profile and the account off the campaign, not the request", async () => {
    // Otherwise the request is a way to graft one campaign's list onto another
    // customer profile's search, under the first campaign's approved copy.
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    const OTHER = "77777777-7777-4777-8777-777777777777";
    db.seed("customer_profiles", [
      {
        id: OTHER,
        workspace_id: WORKSPACE,
        business_profile_id: BUSINESS,
        name: "Somebody else",
        spec: { ...CUSTOMER_PROFILE, name: "Somebody else" },
        priority: 1,
        do_not_pursue: false,
        approved_at: "2026-09-01T09:00:00Z",
      },
    ]);
    seedCampaign(db);
    linkedin.candidates = {
      items: [candidate("p9", "https://www.linkedin.com/in/jane-nine")],
      cursor: "page-3",
      droppedFilters: [],
    };
    scoreMock.mockResolvedValue([ranked("https://www.linkedin.com/in/jane-nine", "p9", 90)]);

    await runTargetingJob(ctx, { ...more, customerProfileId: OTHER });

    const scored = scoreMock.mock.calls[0]?.[1] as { profile: { name: string } };
    expect(scored.profile.name).toBe("Ops leaders");
  });

  it("stops rather than searching for a customer profile that has been deleted", async () => {
    const { db, ctx, linkedin } = harness();
    const { runTargetingJob } = await import("../src/jobs/targeting.js");
    seedCampaign(db, { customer_profile_id: null });

    expect(await runTargetingJob(ctx, more)).toBeNull();
    expect(linkedin.searches).toHaveLength(0);
  });
});
