import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { normalizeExclusionValue } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import { runCampaignTick } from "../src/jobs/campaign-tick.js";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
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
    expect(after.status).toBe("replied");
    // A prospect who answered must never receive the next scheduled follow-up.
    expect(after.next_action_at).toBeNull();
  });

  it("holds the reply for a human in approval mode rather than sending it", async () => {
    const { db, ctx, queues, linkedin } = harness();

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    const draft = db.rows("reply_drafts")[0];
    expect(draft?.status).toBe("pending");
    expect(linkedin.sentMessages).toHaveLength(0);
    expect(db.rows("conversations")[0]?.needs_human).toBe(true);
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
