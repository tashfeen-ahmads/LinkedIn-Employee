import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { LINKEDIN_LIMITS, normalizeExclusionValue } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import { runCampaignTick } from "../src/jobs/campaign-tick.js";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { detectAcceptedInvitations, followUpDueAt } from "../src/jobs/acceptance.js";
import { handleInboundMessage } from "../src/jobs/inbound.js";
import type { WorkerContext } from "../src/context.js";
import type { LinkedInActionJob, Queues } from "../src/queues.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const CP = "66666666-6666-4666-8666-666666666666";

// Wednesday 14:00 UTC — inside the default working window.
const NOW = new Date("2026-09-09T14:00:00Z");

interface Harness {
  db: FakeDb;
  ctx: WorkerContext;
  linkedin: MockLinkedInProvider;
  queues: Queues;
  enqueued: Array<{ queue: string; data: unknown; opts?: unknown }>;
  classifications: unknown[];
  drafts: unknown[];
}

/** Everything the jobs touch, wired to fakes. Nothing reaches the network. */
function harness(overrides: { plan?: string; trialEndsAt?: string } = {}): Harness {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();
  const enqueued: Array<{ queue: string; data: unknown; opts?: unknown }> = [];

  db.seed("workspaces", [
    {
      id: WORKSPACE,
      name: "Acme",
      slug: "acme",
      plan: overrides.plan ?? "trial",
      trial_ends_at: overrides.trialEndsAt ?? new Date(NOW.getTime() + 5 * 86_400_000).toISOString(),
      subscription_status: null,
      seats: 1,
    },
  ]);
  db.seed("profiles", [{ id: USER, email: "rep@acme.test", full_name: "Rep Person", timezone: "UTC", bio: null }]);
  db.seed("memberships", [{ workspace_id: WORKSPACE, user_id: USER, role: "owner" }]);
  db.seed("linkedin_accounts", [
    {
      id: ACCOUNT,
      workspace_id: WORKSPACE,
      user_id: USER,
      provider: "mock",
      provider_account_id: "acct_1",
      status: "active",
      // Fully warmed up, so the daily cap is the maximum.
      connected_at: new Date(NOW.getTime() - 90 * 86_400_000).toISOString(),
      invites_today: 0,
      invites_this_week: 0,
      messages_today: 0,
      counters_reset_on: NOW.toISOString().slice(0, 10),
      last_action_at: null,
      working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
    },
  ]);
  db.seed("business_profiles", [
    {
      id: "77777777-7777-4777-8777-777777777777",
      workspace_id: WORKSPACE,
      spec: {
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
    },
  ]);
  db.seed("campaigns", [
    {
      id: CAMPAIGN,
      workspace_id: WORKSPACE,
      customer_profile_id: null,
      linkedin_account_id: ACCOUNT,
      owner_user_id: USER,
      name: "Ops leaders",
      status: "running",
      connection_note: "Hi {{first_name}}, we work with ops leaders on the same problem.",
      daily_invite_cap: 20,
      reply_mode: "approval",
      rules: {},
      stop_conditions: [],
    },
  ]);
  db.seed("campaign_steps", [
    { workspace_id: WORKSPACE, campaign_id: CAMPAIGN, step_number: 1, delay_days: 2, message: "Hi {{first_name}}, worth a look?" },
    { workspace_id: WORKSPACE, campaign_id: CAMPAIGN, step_number: 2, delay_days: 4, message: "Closing the loop." },
  ]);
  db.seed("prospects", [
    {
      id: PROSPECT,
      workspace_id: WORKSPACE,
      linkedin_url: "linkedin.com/in/jane-doe",
      provider_id: "prov_jane",
      first_name: "Jane",
      last_name: "Doe",
      title: "Head of Ops",
      company: "Northwind",
      do_not_contact: false,
      last_contacted_at: null,
      signals: [],
      fit_reasons: [],
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
      next_action_at: null,
    },
  ]);

  const makeQueue = (name: string) => ({
    add: async (_jobName: string, data: unknown, opts?: unknown) => {
      enqueued.push({ queue: name, data, opts });
    },
  });

  const queues = {
    strategy: makeQueue("strategy"),
    targeting: makeQueue("targeting"),
    campaignTick: makeQueue("campaignTick"),
    linkedinAction: makeQueue("linkedinAction"),
    inbound: makeQueue("inbound"),
    maintenance: makeQueue("maintenance"),
  } as unknown as Queues;

  const ctx = {
    db: db.asDb(),
    linkedin,
    email: null,
    env: {
      LINKEDIN_PROVIDER: "mock",
      CALENDAR_PROVIDER: "mock",
      CRM_PROVIDER: "mock",
      MEETING_DURATION_MINUTES: 30,
      APP_URL: "http://app.test",
      WORKER_URL: "http://worker.test",
    } as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  return { db, ctx, linkedin, queues, enqueued, classifications: [], drafts: [] };
}

// The agent calls are stubbed: this test is about the pipeline around them,
// and the agents' own behaviour is covered by their unit tests and the eval.
const classifyMock = vi.fn();
const draftMock = vi.fn();

vi.mock("@le/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@le/agents")>();
  return {
    ...actual,
    classifyReply: (...args: unknown[]) => classifyMock(...args),
    draftReply: (...args: unknown[]) => draftMock(...args),
  };
});

function classification(overrides: Record<string, unknown> = {}) {
  return {
    intent: "interested",
    sentiment: "positive",
    needsHuman: false,
    needsHumanReason: null,
    mentionsPricing: false,
    mentionsLegalOrCompliance: false,
    asksForHuman: false,
    optOut: false,
    referralName: null,
    followUpAfterDays: null,
    confidence: 0.95,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  classifyMock.mockReset();
  draftMock.mockReset();
  classifyMock.mockResolvedValue(classification());
  draftMock.mockResolvedValue({
    message: "Happy to talk. Does one of these work?",
    proposesMeeting: true,
    proposedSlots: [],
    usedKnowledge: [],
    unansweredQuestions: [],
  });
});

describe("campaign pipeline", () => {
  it("paces an invitation instead of sending it immediately", async () => {
    const { db, ctx, queues, enqueued } = harness();

    const count = await runCampaignTick(db.asDb(), queues, NOW);

    expect(count).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.queue).toBe("linkedinAction");
    // The delay is what keeps a campaign from looking like a machine.
    expect((enqueued[0]?.opts as { delay: number }).delay).toBeGreaterThan(0);
    void ctx;
  });

  /**
   * The loop's silence and the loop's absence look identical from every screen
   * this product has: status "running", nobody invited, a page that has not
   * changed. It declines far more often than it acts — outside working hours,
   * allowance spent, nothing due — and each of those is a correct, quiet exit.
   * So the run itself is what gets recorded, not its outcome.
   */
  it("records that it ran, even on a run that sent nobody", async () => {
    const { db, queues } = harness();
    // Ten o'clock at night: the limiter declines, correctly, and the campaign
    // sits exactly as it does when the worker is dead.
    const night = new Date("2026-09-09T22:00:00Z");

    const count = await runCampaignTick(db.asDb(), queues, night);

    expect(count).toBe(0);
    const beat = db.rows("worker_heartbeats")[0];
    expect(beat?.name).toBe("campaign-tick");
    expect(beat?.beat_at).toBe(night.toISOString());
  });

  /**
   * `enqueued: 0` is what this loop says at two in the morning, and also what
   * it says when the account is disconnected, the trial has lapsed, or there
   * is nobody left to invite. Four different things to do about it, reported
   * identically — the count was never the useful half, and an afternoon went
   * into working out which zero it was from the outside.
   */
  /**
   * The heartbeat used to be written at the end of the run, so a run that threw
   * wrote nothing — and "threw" and "never ran" are the same absence from every
   * screen. Not hypothetical: the first tick that had actual work to do threw,
   * and the product reported eight hours of silence as a stopped loop while the
   * loop was running and failing every five minutes.
   */
  it("records a run that threw, rather than looking like a run that never happened", async () => {
    const { db, queues } = harness();
    (queues.linkedinAction as unknown as { add: () => Promise<void> }).add = async () => {
      throw new Error("queue refused the job");
    };

    await expect(runCampaignTick(db.asDb(), queues, NOW)).rejects.toThrow(/queue refused/);

    const beat = db.rows("worker_heartbeats")[0];
    expect(beat?.name).toBe("campaign-tick");
    // The message, not just the fact. It is the only description of the failure
    // that reaches anybody who cannot open the deployment's logs.
    expect((beat?.detail as { failed: string }).failed).toMatch(/queue refused/);
  });

  it("still rethrows, so the queue retries and the tracker sees it", async () => {
    // The stamp is written before the rethrow, not instead of it.
    const { db, queues } = harness();
    (queues.linkedinAction as unknown as { add: () => Promise<void> }).add = async () => {
      throw new Error("boom");
    };

    await expect(runCampaignTick(db.asDb(), queues, NOW)).rejects.toThrow("boom");
  });

  it("says why it declined, not only that it did", async () => {
    const { db, queues } = harness();
    const night = new Date("2026-09-09T22:00:00Z");

    await runCampaignTick(db.asDb(), queues, night);

    const detail = db.rows("worker_heartbeats")[0]?.detail as { decisions: Array<{ reason: string }> };
    // The limiter's own word for it. Correct behaviour, and it needs saying as
    // such rather than reading as a product that does not work.
    expect(detail.decisions[0]?.reason).toContain("outside_working_hours");
  });

  it("distinguishes a disconnected account from a quiet night", async () => {
    const { db, queues } = harness();
    db.rows("linkedin_accounts").forEach((row) => (row.status = "reauth_required"));

    await runCampaignTick(db.asDb(), queues, NOW);

    const detail = db.rows("worker_heartbeats")[0]?.detail as { decisions: Array<{ reason: string }> };
    expect(detail.decisions[0]?.reason).toMatch(/account is not active/);
  });

  it("distinguishes a finished list from a blocked one", async () => {
    const { db, queues } = harness();
    db.rows("campaign_prospects").forEach((row) => (row.status = "invited"));

    await runCampaignTick(db.asDb(), queues, NOW);

    const detail = db.rows("worker_heartbeats")[0]?.detail as { decisions: Array<{ reason: string }> };
    expect(detail.decisions[0]?.reason).toMatch(/nobody left to invite/);
  });

  it("says what it did on a run that worked", async () => {
    const { db, queues } = harness();

    await runCampaignTick(db.asDb(), queues, NOW);

    const detail = db.rows("worker_heartbeats")[0]?.detail as {
      enqueued: number;
      decisions: Array<{ reason: string }>;
    };
    expect(detail.enqueued).toBe(1);
    expect(detail.decisions[0]?.reason).toMatch(/queued 1 invitation/);
  });

  it("carries what is sitting in the queue", async () => {
    // A job already holding the id this loop would use is accepted silently by
    // BullMQ and never added, so one stuck or failed invitation can stop a
    // campaign for ever while the loop reports a cheerful zero every five
    // minutes. The counts are the only place that shows.
    const { db, queues } = harness();
    (queues.linkedinAction as unknown as { getJobCounts: () => Promise<unknown> }).getJobCounts =
      async () => ({ waiting: 0, delayed: 4, failed: 1, active: 0, completed: 9 });

    await runCampaignTick(db.asDb(), queues, NOW);

    const detail = db.rows("worker_heartbeats")[0]?.detail as { queue: { failed: number; delayed: number } };
    expect(detail.queue.failed).toBe(1);
    expect(detail.queue.delayed).toBe(4);
  });

  it("does not let a queue that cannot count take the loop down with it", async () => {
    // The pacing loop is the one loop that must keep running. A diagnostic
    // that throws inside it costs the sends it was meant to explain.
    const { db, queues } = harness();
    (queues.linkedinAction as unknown as { getJobCounts: () => Promise<unknown> }).getJobCounts =
      async () => {
        throw new Error("redis gone");
      };

    const count = await runCampaignTick(db.asDb(), queues, NOW);

    expect(count).toBe(1);
    const detail = db.rows("worker_heartbeats")[0]?.detail as { queue: { counts: string } };
    expect(detail.queue.counts).toBe("redis gone");
  });

  it("records that it ran when there is no campaign to run", async () => {
    // The first thing a new deployment does, and the state in which somebody
    // most needs to know the worker is alive.
    const { db, queues } = harness();
    db.rows("campaigns").forEach((row) => (row.status = "draft"));

    await runCampaignTick(db.asDb(), queues, NOW);

    expect(db.rows("worker_heartbeats")).toHaveLength(1);
  });

  it("keeps one heartbeat rather than a log of them", async () => {
    const { db, queues } = harness();

    await runCampaignTick(db.asDb(), queues, NOW);
    await runCampaignTick(db.asDb(), queues, new Date(NOW.getTime() + 300_000));

    // Only the most recent run answers the question this exists for, and a row
    // every five minutes for ever answers it no better.
    expect(db.rows("worker_heartbeats")).toHaveLength(1);
    expect(db.rows("worker_heartbeats")[0]?.beat_at).toBe(new Date(NOW.getTime() + 300_000).toISOString());
  });

  /**
   * A prospect counted under an angle has to receive that angle all the way
   * through. Reading the campaign's step while the invitation came from an
   * angle means the results table describes a group that got the angle's
   * opener and somebody else's follow-up.
   */
  it("sends the follow-up belonging to the angle the person was assigned", async () => {
    const { db, ctx, linkedin } = harness();
    db.seed("campaign_variants", [
      { id: "var-1", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, name: "Referrals", angle: "a", connection_note: "n", enabled: true },
    ]);
    db.seed("campaign_steps", [
      {
        workspace_id: WORKSPACE,
        campaign_id: CAMPAIGN,
        variant_id: "var-1",
        step_number: 1,
        delay_days: 3,
        message: "The angle's own first message.",
      },
    ]);
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "accepted";
    cp.variant_id = "var-1";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages[0]?.text).toContain("The angle's own first message.");
  });

  it("schedules the next step on the angle's own delay, not the campaign's", async () => {
    // The campaign's step 2 waits four days; this angle's waits nine. Reading
    // the campaign's here would put the whole group on a schedule its angle
    // did not choose — and an angle with a shorter sequence than the
    // campaign's would keep going past its own end.
    const { db, ctx } = harness();
    db.seed("campaign_variants", [
      { id: "var-2", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, name: "Slow burn", angle: "a", connection_note: "n", enabled: true },
    ]);
    db.seed("campaign_steps", [
      { workspace_id: WORKSPACE, campaign_id: CAMPAIGN, variant_id: "var-2", step_number: 1, delay_days: 1, message: "Angle opener." },
      { workspace_id: WORKSPACE, campaign_id: CAMPAIGN, variant_id: "var-2", step_number: 2, delay_days: 9, message: "Angle closer." },
    ]);
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "accepted";
    cp.variant_id = "var-2";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    const after = db.find("campaign_prospects", { id: CP })!;
    const days = Math.round(
      (new Date(String(after.next_action_at)).getTime() - NOW.getTime()) / 86_400_000,
    );
    expect(days).toBe(9);
  });

  it("stops when the angle's sequence ends, even if the campaign's is longer", async () => {
    // One step on this angle, two on the campaign. Falling through would
    // schedule a follow-up this angle never wrote.
    const { db, ctx } = harness();
    db.seed("campaign_variants", [
      { id: "var-3", workspace_id: WORKSPACE, campaign_id: CAMPAIGN, name: "Short", angle: "a", connection_note: "n", enabled: true },
    ]);
    db.seed("campaign_steps", [
      { workspace_id: WORKSPACE, campaign_id: CAMPAIGN, variant_id: "var-3", step_number: 1, delay_days: 1, message: "The only one." },
    ]);
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "accepted";
    cp.variant_id = "var-3";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(db.find("campaign_prospects", { id: CP })?.next_action_at).toBeNull();
  });

  it("puts the campaign's destination into the follow-up", async () => {
    // The URL lives on the campaign, not in the copy: changing where a
    // campaign points must not mean rewriting three messages and
    // re-reviewing them.
    const { db, ctx, linkedin } = harness();
    db.rows("campaigns")[0]!.cta_kind = "link";
    db.rows("campaigns")[0]!.cta_url = "https://acme.test/signup";
    db.rows("campaign_steps")[0]!.message = "Worth a look, {{first_name}}: {{cta_link}}";
    db.find("campaign_prospects", { id: CP })!.status = "accepted";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages[0]?.text).toBe("Worth a look, Jane: https://acme.test/signup");
  });

  it("leaves the placeholder visible when a link campaign has no destination", async () => {
    /*
     * Rule 29, and still the right answer for a campaign pointing at somebody
     * else's page. Substituting an empty string would send "Worth a look:"
     * with nothing after it, which a prospect reads as a broken product; a
     * visible {{cta_link}} is caught on the review screen instead. We cannot
     * invent the customer's signup page, so there is nothing better to send.
     */
    const { db, ctx, linkedin } = harness();
    db.rows("campaigns")[0]!.cta_kind = "link";
    db.rows("campaigns")[0]!.cta_url = null;
    db.rows("campaign_steps")[0]!.message = "Worth a look: {{cta_link}}";
    db.find("campaign_prospects", { id: CP })!.status = "accepted";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages[0]?.text).toContain("{{cta_link}}");
  });

  it("uses our own booking page when a meeting campaign has no destination", async () => {
    /*
     * The one case rule 29 was too broad for. A campaign asking for a meeting
     * with nowhere to book one is not missing a customer's page — this product
     * owns a booking page and it works (rule 18), so holding four written
     * messages hostage to a Calendly account was a configuration step invented
     * for no reason.
     *
     * The link is per-prospect by construction: its token is the whole
     * authorisation, `bookFromLink` re-derives the free slots and refuses a
     * time that is not among them.
     */
    const { db, ctx, linkedin } = harness();
    db.rows("campaigns")[0]!.cta_kind = "meeting";
    db.rows("campaigns")[0]!.cta_url = null;
    db.rows("campaign_steps")[0]!.message = "Grab a time: {{cta_link}}";
    db.find("campaign_prospects", { id: CP })!.status = "accepted";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    const sent = linkedin.sentMessages[0]?.text ?? "";
    expect(sent).not.toContain("{{cta_link}}");
    expect(sent).toContain("/book/");
    expect(db.rows("booking_links")).toHaveLength(1);
  });

  it("sends the one approved pitch rather than a copy of it in the campaign", async () => {
    /*
     * Rule 40. `{{pitch}}` is a pointer, exactly as `{{cta_link}}` is:
     * improving the offer improves every campaign using it, without rewriting
     * a message or re-reviewing copy a human already approved.
     */
    const { db, ctx, linkedin } = harness();
    db.seed("pitches", [
      {
        id: "pitch-1",
        workspace_id: WORKSPACE,
        body: "Most referrals never get followed up.",
        written_by: "agent",
        facts_used: [],
        approved_at: NOW.toISOString(),
        is_default: true,
      },
    ]);
    db.rows("campaign_steps")[0]!.message = "Hi {{first_name}} — {{pitch}}";
    db.find("campaign_prospects", { id: CP })!.status = "accepted";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages[0]?.text).toBe("Hi Jane — Most referrals never get followed up.");
  });

  it("gives a prospect the pitch belonging to the angle they were written for", async () => {
    /*
     * Rule 28, carried to the offer. Somebody accepts because one pain was
     * named; hearing a pitch that argues a different one leaves the acceptance
     * and the reply measuring different things, which is the whole reason the
     * angle owns its prospect end to end.
     */
    const { db, ctx, linkedin } = harness();
    db.seed("pitches", [
      {
        id: "pitch-default",
        workspace_id: WORKSPACE,
        name: "Default",
        body: "The generic line nobody chose.",
        written_by: "agent",
        facts_used: [],
        approved_at: NOW.toISOString(),
        is_default: true,
      },
      {
        id: "pitch-angle",
        workspace_id: WORKSPACE,
        name: "Referral leakage",
        body: "Most of your referrals never happen.",
        written_by: "agent",
        facts_used: [],
        approved_at: NOW.toISOString(),
        is_default: false,
      },
    ]);
    db.seed("campaign_variants", [
      {
        id: "variant-1",
        workspace_id: WORKSPACE,
        campaign_id: CAMPAIGN,
        name: "Referral leakage",
        angle: "referrals that never happen",
        pain_point: null,
        connection_note: "n",
        enabled: true,
        pitch_id: "pitch-angle",
        hook: null,
      },
    ]);
    db.rows("campaign_steps")[0]!.message = "{{pitch}}";
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "accepted";
    cp.variant_id = "variant-1";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages[0]?.text).toBe("Most of your referrals never happen.");
  });

  it("falls back to the default when an angle's own pitch is not approved", async () => {
    /*
     * The alternative is silence from a campaign that is otherwise ready, and
     * the default is copy a person approved for exactly this case — the same
     * shape as the campaign-wide steps that are the whole sequence for anybody
     * assigned no angle.
     */
    const { db, ctx, linkedin } = harness();
    db.seed("pitches", [
      {
        id: "pitch-default",
        workspace_id: WORKSPACE,
        name: "Default",
        body: "The line everyone else hears.",
        written_by: "agent",
        facts_used: [],
        approved_at: NOW.toISOString(),
        is_default: true,
      },
      {
        id: "pitch-angle",
        workspace_id: WORKSPACE,
        name: "Referral leakage",
        body: "Nobody has read this one yet.",
        written_by: "agent",
        facts_used: [],
        approved_at: null,
        is_default: false,
      },
    ]);
    db.seed("campaign_variants", [
      {
        id: "variant-1",
        workspace_id: WORKSPACE,
        campaign_id: CAMPAIGN,
        name: "Referral leakage",
        angle: "referrals that never happen",
        pain_point: null,
        connection_note: "n",
        enabled: true,
        pitch_id: "pitch-angle",
        hook: null,
      },
    ]);
    db.rows("campaign_steps")[0]!.message = "{{pitch}}";
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "accepted";
    cp.variant_id = "variant-1";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages[0]?.text).toBe("The line everyone else hears.");
  });

  it("sends nothing at all when the message needs a pitch and none is approved", async () => {
    /*
     * The difference from the CTA placeholder, and the reason it is a
     * different function. A missing destination costs a link and a visible
     * {{cta_link}} is caught on the review screen. A missing pitch is the
     * entire body of the message: what would go out is "Hi Jane — {{pitch}}",
     * to a real person, under a real rep's name.
     *
     * Held rather than failed, and the schedule is untouched, so the step
     * sends itself the moment somebody approves a pitch. There is no second
     * chance at a first follow-up.
     */
    const { db, ctx, linkedin } = harness();
    db.seed("pitches", [
      {
        id: "pitch-1",
        workspace_id: WORKSPACE,
        body: "Most referrals never get followed up.",
        written_by: "agent",
        facts_used: [],
        approved_at: null,
        is_default: true,
      },
    ]);
    db.rows("campaign_steps")[0]!.message = "Hi {{first_name}} — {{pitch}}";
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "accepted";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages).toHaveLength(0);
    // Visible, per rule 10: nothing held for a human is invisible.
    expect(db.rows("conversations")[0]?.needs_human).toBe(true);
    // And still due, so approving a pitch is all it takes.
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("accepted");
  });

  it("mints no booking link for a message that never asks for one", async () => {
    // A bearer credential and a row, spent on a message that does not mention
    // booking. The placeholder is the only thing that should trigger it.
    const { db, ctx, linkedin } = harness();
    db.rows("campaigns")[0]!.cta_kind = "meeting";
    db.rows("campaigns")[0]!.cta_url = null;
    db.rows("campaign_steps")[0]!.message = "Thanks for connecting, {{first_name}}.";
    db.find("campaign_prospects", { id: CP })!.status = "accepted";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages[0]?.text).toBe("Thanks for connecting, Jane.");
    expect(db.rows("booking_links")).toHaveLength(0);
  });

  it("falls back to the campaign's step when the angle has none", async () => {
    // Every campaign built before angles existed reaches this path for its
    // whole sequence, so it is the common case and not the edge.
    const { db, ctx, linkedin } = harness();
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "accepted";
    cp.variant_id = null;

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages).toHaveLength(1);
  });

  it("sends the invitation, personalises it, and advances the state machine", async () => {
    const { db, ctx, linkedin } = harness();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });

    expect(linkedin.sentInvitations).toHaveLength(1);
    expect(linkedin.sentInvitations[0]?.note).toBe(
      "Hi Jane, we work with ops leaders on the same problem.",
    );
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("invited");
    // The counter the limiter reads only moves after the provider succeeded.
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.invites_today).toBe(1);
    expect(db.rows("events").some((e) => e.name === "invite.sent")).toBe(true);
  });

  it("never contacts a prospect marked do-not-contact, even once scheduled", async () => {
    const { db, ctx, linkedin } = harness();
    const prospect = db.find("prospects", { id: PROSPECT })!;
    prospect.do_not_contact = true;

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });

    expect(linkedin.sentInvitations).toHaveLength(0);
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("closed");
  });

  /**
   * The rule as the customer stated it: once we have reached out to a person,
   * they are not added to any campaign again, whether or not they replied.
   *
   * Enforced here and not only when a list is built, because two campaigns
   * built from the same customer profile read `prospects` before either of them
   * writes to it — so both can queue the same person quite legitimately, and
   * this is the first moment the question has a settled answer.
   */
  it("never invites somebody another campaign has already contacted", async () => {
    const { db, ctx, linkedin } = harness();
    db.find("prospects", { id: PROSPECT })!.last_contacted_at = "2026-09-01T09:00:00Z";

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });

    expect(linkedin.sentInvitations).toHaveLength(0);
    const cp = db.find("campaign_prospects", { id: CP })!;
    expect(cp.status).toBe("closed");
    // Readable on the campaign screen. A name that quietly goes missing from a
    // list somebody reviewed is its own bug report.
    expect(cp.status_reason).toMatch(/already contacted on 2026-09-01/);
  });

  it("does not care whether they replied to the first campaign", async () => {
    // "No matter if they respond to first one campaign or not" — a reply is a
    // conversation somebody is already having, which is a stronger reason not
    // to open a second one under a different pretext, not a weaker one.
    const { db, ctx, linkedin } = harness();
    const prospect = db.find("prospects", { id: PROSPECT })!;
    prospect.last_contacted_at = "2026-09-01T09:00:00Z";
    db.seed("conversations", [
      { id: "conv-1", workspace_id: WORKSPACE, prospect_id: PROSPECT, status: "replied" },
    ]);

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });

    expect(linkedin.sentInvitations).toHaveLength(0);
  });

  it("still sends the follow-ups of the campaign that did contact them", async () => {
    // The rule is about opening a second conversation, not about finishing the
    // first. Reading it as "never message a contacted person" would silence
    // every campaign the moment its invitation was accepted.
    const { db, ctx, linkedin } = harness();
    const prospect = db.find("prospects", { id: PROSPECT })!;
    prospect.last_contacted_at = "2026-09-01T09:00:00Z";
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "accepted";
    cp.last_step_sent = 0;

    await runLinkedInAction(ctx, {
      kind: "follow_up",
      workspaceId: WORKSPACE,
      campaignProspectId: CP,
      stepNumber: 1,
    });

    expect(linkedin.sentMessages).toHaveLength(1);
  });

  it("invites somebody nobody has contacted", async () => {
    // The guard must not be a blanket refusal that happens to pass the tests
    // above: a fresh prospect is the entire normal case.
    const { ctx, linkedin } = harness();

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });

    expect(linkedin.sentInvitations).toHaveLength(1);
  });

  it("never contacts an account added to the shared exclusion list after launch", async () => {
    // The scenario the list exists for: a colleague closes Northwind at 10am
    // and the campaign already has this invitation queued.
    const { db, ctx, linkedin } = harness();
    db.seed("exclusions", [
      {
        id: "excl-1",
        workspace_id: WORKSPACE,
        kind: "company",
        value: normalizeExclusionValue("company", "Northwind Ltd."),
        raw_value: "Northwind Ltd.",
        reason: "closed by AE",
      },
    ]);

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });

    expect(linkedin.sentInvitations).toHaveLength(0);
    const cp = db.find("campaign_prospects", { id: CP })!;
    expect(cp.status).toBe("closed");
    // The rep has to be able to see why their number went down.
    expect(cp.status_reason).toBe("excluded: Northwind Ltd. — closed by AE");
  });

  it("excludes one named person without stopping the rest of the campaign", async () => {
    const { db, ctx, linkedin } = harness();
    db.seed("exclusions", [
      {
        id: "excl-2",
        workspace_id: WORKSPACE,
        kind: "person",
        value: normalizeExclusionValue("person", "https://www.linkedin.com/in/someone-else/"),
        raw_value: "https://www.linkedin.com/in/someone-else/",
        reason: null,
      },
    ]);

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });

    expect(linkedin.sentInvitations).toHaveLength(1);
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("invited");
  });

  it("carries a prospect from invitation to follow-up once they accept", async () => {
    // The loop that was broken end to end: nothing ever set `accepted`, which
    // is the status the follow-up scheduler waits for, so no campaign sent its
    // second message to anyone, ever.
    const { db, ctx, queues, linkedin, enqueued } = harness({
      trialEndsAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    });
    const { detectAcceptedInvitations } = await import("../src/jobs/acceptance.js");

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("invited");

    linkedin.relations = [{ providerId: "prov_jane", connectedAt: NOW.toISOString() }];
    await detectAcceptedInvitations(ctx, NOW);
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("accepted");

    // The follow-up falls due two days later, which is a Saturday here, so the
    // next working day is when it actually goes out.
    const later = new Date(NOW.getTime() + 5 * 86_400_000);
    await runCampaignTick(db.asDb(), queues, later);

    const followUp = enqueued.find((job) => (job.data as { kind?: string }).kind === "follow_up");
    expect(followUp).toBeDefined();
    expect((followUp?.data as { stepNumber: number }).stepNumber).toBe(1);
  });

  it("stops the sequence when the prospect replies", async () => {
    const { db, ctx, queues } = harness();
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "messaged_1";
    cp.last_step_sent = 1;
    cp.next_action_at = NOW.toISOString();

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting, tell me more"));

    const after = db.find("campaign_prospects", { id: CP })!;
    // `positive`, not `replied`. The default classification in this harness is
    // `interested`, and so is the message — "sounds interesting, tell me more"
    // is the one reply a campaign exists to produce. Recording it as `replied`
    // put it in the same bucket as "who is this?", which is the distinction
    // anybody running a campaign most wants to see.
    expect(after.status).toBe("positive");
    // A prospect who answered must never receive the next scheduled follow-up.
    expect(after.next_action_at).toBeNull();
  });

  it("does not call every reply interested", async () => {
    /*
     * The guard on the guard. A rule that promotes a prospect on interest is
     * only worth having if it declines to on everything else — otherwise
     * `positive` means "replied" again, with a more flattering name, and the
     * funnel is wrong in the direction nobody checks.
     */
    const { db, ctx, queues } = harness();
    const cp = db.find("campaign_prospects", { id: CP })!;
    cp.status = "messaged_1";
    cp.last_step_sent = 1;
    cp.next_action_at = NOW.toISOString();

    classifyMock.mockResolvedValue(classification({ intent: "question", sentiment: "neutral" }));
    await handleInboundMessage(ctx, queues, inboundJob("Sorry, who is this?"));

    const after = db.find("campaign_prospects", { id: CP })!;
    expect(after.status).toBe("replied");
    expect(after.next_action_at).toBeNull();
  });

  it("makes the offer somebody approved, not one the agent improvised", async () => {
    /*
     * Rule 40. The pitch is the one piece of copy that argues for the product,
     * and before it was written down the Reply Agent assembled a different one
     * from the business profile in every conversation — so no two prospects
     * were ever made the same offer, and nobody had read any of them.
     */
    const { db, ctx, queues } = harness();
    db.seed("pitches", [
      {
        id: "pitch-1",
        workspace_id: WORKSPACE,
        body: "Most referrals never get followed up. We match you and make the intro.",
        written_by: "agent",
        facts_used: [],
        approved_at: NOW.toISOString(),
        is_default: true,
      },
    ]);

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting, tell me more"));

    const input = draftMock.mock.calls[0]?.[1] as { pitch?: string };
    expect(input.pitch).toContain("never get followed up");
  });

  it("never hands the agent a pitch nobody has approved", async () => {
    /*
     * The half that matters. An unapproved pitch is a draft the agent wrote
     * and nobody read; sending it would make the approval screen decorative —
     * the same division rule 9 draws for customer profiles, where the Strategy
     * Agent writes them and targeting refuses the ones nobody said yes to.
     */
    const { db, ctx, queues } = harness();
    db.seed("pitches", [
      {
        id: "pitch-1",
        workspace_id: WORKSPACE,
        body: "Most referrals never get followed up. We match you and make the intro.",
        written_by: "agent",
        facts_used: [],
        approved_at: null,
        is_default: true,
      },
    ]);

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting, tell me more"));

    const input = draftMock.mock.calls[0]?.[1] as { pitch?: string };
    expect(input.pitch).toBeUndefined();
  });

  it("holds the reply for a human in approval mode rather than sending it", async () => {
    const { db, ctx, queues, linkedin } = harness();

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    const draft = db.rows("reply_drafts")[0];
    expect(draft?.status).toBe("pending");
    expect(linkedin.sentMessages).toHaveLength(0);
    expect(db.rows("conversations")[0]?.needs_human).toBe(true);
  });

  /**
   * Rule 6's sibling. The model may not invent a datetime and it may not invent
   * a URL, for the same reason: both reach a real person under a real rep's
   * name, and both are the kind of detail a model produces fluently and wrongly.
   */
  it("holds a draft carrying a link nobody gave the agent, even on autopilot", async () => {
    const { db, ctx, queues, linkedin } = harness();
    db.find("campaigns", { id: CAMPAIGN })!.reply_mode = "autopilot";
    db.find("campaign_prospects", { id: CP })!.status = "accepted";
    draftMock.mockResolvedValue({
      message: "Happy to help — grab a slot at https://acme.test/demo",
      proposesMeeting: false,
      proposedSlots: [],
      usedKnowledge: [],
      unansweredQuestions: [],
    });

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    expect(db.rows("reply_drafts")[0]?.status).toBe("pending");
    expect(linkedin.sentMessages).toHaveLength(0);
    // Held, not stripped: removing the URL leaves "grab a slot at" pointing at
    // nothing, which reads worse than the invented link did.
    expect(db.rows("reply_drafts")[0]?.body).toContain("https://acme.test/demo");
  });

  it("sends the rep's own scheduling link without holding it", async () => {
    const { db, ctx, queues } = harness();
    db.find("campaigns", { id: CAMPAIGN })!.reply_mode = "autopilot";
    db.find("campaign_prospects", { id: CP })!.status = "accepted";
    db.rows("profiles")[0]!.booking_url = "https://cal.com/sam/intro";
    draftMock.mockResolvedValue({
      message: "Grab a time here: https://cal.com/sam/intro",
      proposesMeeting: false,
      proposedSlots: [],
      usedKnowledge: [],
      unansweredQuestions: [],
    });

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    expect(db.rows("reply_drafts")[0]?.status).toBe("approved");
  });

  it("offers no times at all when the campaign is not asking for a meeting", async () => {
    // Proposing a call to somebody who was asked to look at a page is the
    // agent pursuing a goal nobody set.
    const { db, ctx, queues } = harness();
    db.find("campaigns", { id: CAMPAIGN })!.cta_kind = "link";
    db.find("campaigns", { id: CAMPAIGN })!.cta_url = "https://acme.test/signup";

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    const drafted = draftMock.mock.calls[0]?.[1] as {
      availableSlots: string[];
      goal: string;
      rules: { bookingLink?: string };
    };
    expect(drafted.availableSlots).toEqual([]);
    expect(drafted.goal).toBe("link");
    // And the one link it may send is the campaign's destination.
    expect(drafted.rules.bookingLink).toBe("https://acme.test/signup");
  });

  it("gives a conversation campaign no link at all", async () => {
    const { db, ctx, queues } = harness();
    db.find("campaigns", { id: CAMPAIGN })!.cta_kind = "reply";
    db.rows("profiles")[0]!.booking_url = "https://cal.com/sam/intro";

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    const drafted = draftMock.mock.calls[0]?.[1] as { rules: { bookingLink?: string } };
    // Not even the rep's own booking link: this campaign asked for a reply,
    // and a scheduling link turns it into a meeting request nobody wanted.
    expect(drafted.rules.bookingLink).toBeUndefined();
  });

  it("sends automatically on autopilot when nothing trips the gate", async () => {
    const { db, ctx, queues, enqueued } = harness();
    db.find("campaigns", { id: CAMPAIGN })!.reply_mode = "autopilot";
    db.find("campaign_prospects", { id: CP })!.status = "accepted";

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    expect(db.rows("reply_drafts")[0]?.status).toBe("approved");
    expect(enqueued.some((job) => (job.data as { kind?: string }).kind === "reply")).toBe(true);
  });

  it("holds a pricing question even on autopilot", async () => {
    const { db, ctx, queues, enqueued } = harness();
    db.find("campaigns", { id: CAMPAIGN })!.reply_mode = "autopilot";
    classifyMock.mockResolvedValue(classification({ mentionsPricing: true, intent: "question" }));

    await handleInboundMessage(ctx, queues, inboundJob("What does it cost?"));

    expect(db.rows("reply_drafts")[0]?.status).toBe("pending");
    expect(db.rows("conversations")[0]?.needs_human_reason).toBe("pricing question");
    expect(enqueued.some((job) => (job.data as { kind?: string }).kind === "reply")).toBe(false);
  });

  it("bans a prospect who opts out and writes no draft at all", async () => {
    const { db, ctx, queues } = harness();
    db.find("campaigns", { id: CAMPAIGN })!.reply_mode = "autopilot";
    classifyMock.mockResolvedValue(
      classification({ optOut: true, intent: "not_interested", sentiment: "negative", needsHuman: true }),
    );

    await handleInboundMessage(ctx, queues, inboundJob("Please remove me from your list"));

    expect(db.find("prospects", { id: PROSPECT })?.do_not_contact).toBe(true);
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("opted_out");
    expect(db.rows("reply_drafts")).toHaveLength(0);
    expect(draftMock).not.toHaveBeenCalled();
  });

  it("surfaces a reply it could not draft instead of losing it", async () => {
    // A model error must not turn a warm inbound reply into silence. The queue
    // retries; the flag is what makes sure a person sees it either way.
    const { db, ctx, queues } = harness();
    draftMock.mockRejectedValue(new Error("model unavailable"));

    await expect(handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"))).rejects.toThrow(
      "model unavailable",
    );

    const conversation = db.rows("conversations")[0]!;
    expect(conversation.needs_human).toBe(true);
    expect(conversation.needs_human_kind).toBe("reply");
  });

  it("ignores a redelivered webhook rather than answering twice", async () => {
    const { db, ctx, queues } = harness();
    const job = inboundJob("Sounds interesting");

    await handleInboundMessage(ctx, queues, job);
    await handleInboundMessage(ctx, queues, job);

    expect(db.rows("messages").filter((m) => m.direction === "inbound")).toHaveLength(1);
    expect(db.rows("reply_drafts")).toHaveLength(1);
  });

  it("ignores a message from someone the workspace never contacted", async () => {
    const { db, ctx, queues } = harness();

    await handleInboundMessage(ctx, queues, { ...inboundJob("hello"), fromProviderId: "prov_stranger" });

    expect(db.rows("messages")).toHaveLength(0);
    expect(classifyMock).not.toHaveBeenCalled();
  });

  it("stops outreach for a workspace whose trial has expired", async () => {
    const { db, queues, enqueued } = harness({
      trialEndsAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
    });

    const count = await runCampaignTick(db.asDb(), queues, NOW);

    expect(count).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("stops outreach for a paused LinkedIn account", async () => {
    const { db, queues, enqueued } = harness();
    db.find("linkedin_accounts", { id: ACCOUNT })!.status = "warning";

    expect(await runCampaignTick(db.asDb(), queues, NOW)).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("enqueues nothing outside the rep's working hours", async () => {
    const { db, queues, enqueued } = harness();
    const saturday = new Date("2026-09-12T14:00:00Z");

    expect(await runCampaignTick(db.asDb(), queues, saturday)).toBe(0);
    expect(enqueued).toHaveLength(0);
  });

  it("respects the daily invite cap already spent", async () => {
    const { db, queues, enqueued } = harness();
    db.find("linkedin_accounts", { id: ACCOUNT })!.invites_today = 35;

    expect(await runCampaignTick(db.asDb(), queues, NOW)).toBe(0);
    expect(enqueued).toHaveLength(0);
  });
});

function inboundJob(text: string) {
  return {
    workspaceId: WORKSPACE,
    linkedinAccountId: ACCOUNT,
    providerChatId: "chat_1",
    providerMessageId: "msg_1",
    fromProviderId: "prov_jane",
    text,
    receivedAt: NOW.toISOString(),
  };
}

export type { LinkedInActionJob };

describe("regressions found in review", () => {
  it("holds an approved reply back when the daily message cap is spent", async () => {
    const { db, ctx, linkedin } = harness();
    db.find("linkedin_accounts", { id: ACCOUNT })!.messages_today = 50;
    db.seed("conversations", [
      { id: "conv1", workspace_id: WORKSPACE, prospect_id: PROSPECT, linkedin_account_id: ACCOUNT },
    ]);
    db.seed("reply_drafts", [
      {
        id: "draft1",
        workspace_id: WORKSPACE,
        conversation_id: "conv1",
        body: "Approved by a human",
        status: "approved",
        prompt_version: "v1",
      },
    ]);

    // A human approving a draft does not exempt it from the caps.
    await expect(
      runLinkedInAction(ctx, {
        kind: "reply",
        workspaceId: WORKSPACE,
        conversationId: "conv1",
        draftId: "draft1",
      }),
    ).rejects.toThrow(/rate limited/i);
    expect(linkedin.sentMessages).toHaveLength(0);
  });

  it("sends an approved reply when the account has room", async () => {
    const { db, ctx, linkedin } = harness();
    db.seed("conversations", [
      { id: "conv1", workspace_id: WORKSPACE, prospect_id: PROSPECT, linkedin_account_id: ACCOUNT },
    ]);
    db.seed("reply_drafts", [
      {
        id: "draft1",
        workspace_id: WORKSPACE,
        conversation_id: "conv1",
        body: "Approved by a human",
        status: "approved",
        prompt_version: "v1",
      },
    ]);

    await runLinkedInAction(ctx, {
      kind: "reply",
      workspaceId: WORKSPACE,
      conversationId: "conv1",
      draftId: "draft1",
    });

    expect(linkedin.sentMessages).toHaveLength(1);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.messages_today).toBe(1);
  });

  it("never clears an existing opt-out when a later message is merely negative", async () => {
    const { db, ctx, queues } = harness();
    const prospect = db.find("prospects", { id: PROSPECT })!;
    prospect.do_not_contact = true;
    prospect.do_not_contact_reason = "opted out on LinkedIn";
    // Sentiment must be neutral and needsHuman false, or applyRules routes to
    // hold_for_human and the stop_sequence branch under test never runs. An
    // earlier version of this test passed for exactly that reason.
    classifyMock.mockResolvedValue(
      classification({ intent: "not_interested", sentiment: "neutral", needsHuman: false, optOut: false }),
    );

    await handleInboundMessage(ctx, queues, inboundJob("Still not for us"));

    // Guard the guard: confirm the branch actually executed.
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("negative");

    // Returning an opted-out person to the contactable pool is the one mistake
    // this product cannot make.
    expect(db.find("prospects", { id: PROSPECT })?.do_not_contact).toBe(true);
    expect(db.find("prospects", { id: PROSPECT })?.do_not_contact_reason).toBe("opted out on LinkedIn");
  });
});

const CONVERSATION = "77777777-7777-4777-8777-777777777777";

describe("holds on a conversation", () => {
  function conversationHarness() {
    const { db } = harness();
    db.seed("conversations", [
      { id: CONVERSATION, workspace_id: WORKSPACE, prospect_id: PROSPECT, needs_human: false },
    ]);
    return db;
  }

  it("sending a reply clears the reply hold but never a booking hold", async () => {
    // The bug this exists to stop: a prospect accepts a time, the calendar
    // write fails, someone is asked to book it by hand — and the confirmation
    // reply going out moments later wipes the only record of that.
    const db = conversationHarness();
    const { clearHold, flagForHuman } = await import("../src/holds.js");

    await flagForHuman(db.asDb(), CONVERSATION, "calendar write failed, book this manually", "booking");
    await clearHold(db.asDb(), CONVERSATION, "reply");

    const conversation = db.find("conversations", { id: CONVERSATION })!;
    expect(conversation.needs_human).toBe(true);
    expect(conversation.needs_human_reason).toBe("calendar write failed, book this manually");
  });

  it("clears a reply hold once the reply is sent", async () => {
    const db = conversationHarness();
    const { clearHold, flagForHuman } = await import("../src/holds.js");

    await flagForHuman(db.asDb(), CONVERSATION, "pricing question");
    await clearHold(db.asDb(), CONVERSATION, "reply");

    const conversation = db.find("conversations", { id: CONVERSATION })!;
    expect(conversation.needs_human).toBe(false);
    expect(conversation.needs_human_kind).toBeNull();
  });
});

describe("when a follow-up falls due after an acceptance", () => {
  it("honours the delay a human configured on a campaign that tests angles", async () => {
    /*
     * The bug this replaces: `firstStepDelay` asked for step 1 with
     * `maybeSingle()`, and a campaign with three angles has four rows for step
     * 1. PostgREST fails that request, the result is null, and the function
     * silently returned its default of one day — so the configured delay was
     * ignored on every campaign this product builds.
     */
    const { db, ctx, linkedin } = harness({
      trialEndsAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    });
    db.seed("campaign_variants", [
      {
        id: "variant-1",
        workspace_id: WORKSPACE,
        campaign_id: CAMPAIGN,
        name: "Angle",
        angle: "a",
        pain_point: null,
        connection_note: "n",
        enabled: true,
        pitch_id: null,
        hook_id: null,
      },
    ]);
    // Four rows for step 1, exactly as a campaign with angles has.
    db.seed("campaign_steps", [
      { id: "s1v", campaign_id: CAMPAIGN, variant_id: "variant-1", step_number: 1, delay_days: 3, message: "m" },
    ]);
    db.find("campaign_prospects", { id: CP })!.variant_id = "variant-1";
    // Invited through the real path, as the working acceptance test does:
    // hand-setting the status skips whatever else the send writes.
    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: CP });
    linkedin.relations = [{ providerId: "prov_jane", connectedAt: NOW.toISOString() }];

    await detectAcceptedInvitations(ctx, NOW);

    const after = db.find("campaign_prospects", { id: CP })!;
    expect(after.status).toBe("accepted");
    // Three days, as configured — not the one-day default it used to fall back to.
    const due = new Date(after.next_action_at as string).getTime() - NOW.getTime();
    expect(Math.round(due / 86_400_000)).toBe(3);
  });
});

describe("followUpDueAt", () => {
  it("never sends in the same second somebody accepted", () => {
    /*
     * A message landing the instant an invitation is accepted is a robot
     * announcing itself, and it is the pattern LinkedIn's own heuristics watch
     * for — on the account this product exists to protect.
     */
    const at = followUpDueAt(NOW, 0, () => 0);
    expect(at.getTime() - NOW.getTime()).toBe(LINKEDIN_LIMITS.acceptFollowUpMinMs);
  });

  it("spreads a prompt follow-up rather than sending them all together", () => {
    // Every acceptance in one hourly poll would otherwise be written to at the
    // same minute, which is its own pattern.
    const early = followUpDueAt(NOW, 0, () => 0).getTime();
    const late = followUpDueAt(NOW, 0, () => 0.999).getTime();
    expect(late).toBeGreaterThan(early);
    expect(late - NOW.getTime()).toBeLessThanOrEqual(LINKEDIN_LIMITS.acceptFollowUpMaxMs);
  });

  it("still honours a delay measured in days", () => {
    expect(followUpDueAt(NOW, 2).getTime() - NOW.getTime()).toBe(2 * 86_400_000);
  });
});
