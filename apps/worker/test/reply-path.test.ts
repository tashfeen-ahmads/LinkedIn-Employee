import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { handleInboundMessage } from "../src/jobs/inbound.js";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { INBOUND_POLL_BEAT, pollInbound } from "../src/jobs/inbound-poll.js";
import { runMaintenance } from "../src/jobs/maintenance.js";
import { createServer } from "../src/server.js";
import { clearHold, flagForHuman } from "../src/holds.js";
import { jobId, type Queues } from "../src/queues.js";
import type { WorkerContext } from "../src/context.js";

/**
 * The reply path, from a prospect's message to the rep's Send button.
 *
 * Every test here is a place a real reply went missing or a real Send did
 * nothing: a held draft nobody was told about, a job id held by a finished job,
 * a reply stored and never read, a booking hold erased by the reply drafted a
 * moment later. Kept apart from `pipeline.test.ts` so the queue double can
 * model the one BullMQ behaviour all of them turn on — an `add()` whose id is
 * taken adds nothing — which that file's bare `add` cannot.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const CP = "66666666-6666-4666-8666-666666666666";
const SECRET = "s".repeat(48);
const DRAFT = "88888888-8888-4888-8888-888888888888";

// Wednesday 14:00 UTC — inside the default working window.
const NOW = new Date("2026-09-09T14:00:00Z");

/** A queue that behaves like BullMQ where it matters: a taken id wins. */
function bullQueue(name: string, log: Array<{ queue: string; id: string; data: unknown }>) {
  const jobs = new Map<string, { state: string; data: unknown }>();
  const removed: string[] = [];
  const wrap = (id: string) => ({
    getState: async () => jobs.get(id)!.state,
    remove: async () => {
      jobs.delete(id);
      removed.push(id);
    },
  });
  return {
    jobs,
    removed,
    add: async (_jobName: string, data: unknown, opts: { jobId: string }) => {
      if (jobs.has(opts.jobId)) return wrap(opts.jobId);
      jobs.set(opts.jobId, { state: "waiting", data });
      log.push({ queue: name, id: opts.jobId, data });
      return wrap(opts.jobId);
    },
    getJob: async (id: string) => (jobs.has(id) ? wrap(id) : undefined),
  };
}

function harness() {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();
  const log: Array<{ queue: string; id: string; data: unknown }> = [];

  db.seed("workspaces", [{ id: WORKSPACE, name: "Acme", plan: "trial", seats: 1 }]);
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
      connected_at: new Date(NOW.getTime() - 90 * 86_400_000).toISOString(),
      first_action_at: new Date(NOW.getTime() - 90 * 86_400_000).toISOString(),
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
      connection_note: "Hi {{first_name}}.",
      daily_invite_cap: 20,
      reply_mode: "autopilot",
      rules: {},
      stop_conditions: [],
    },
  ]);
  db.seed("campaign_steps", [
    { workspace_id: WORKSPACE, campaign_id: CAMPAIGN, step_number: 1, delay_days: 0, message: "Hi {{first_name}}, worth a look?" },
  ]);
  db.seed("prospects", [
    {
      id: PROSPECT,
      workspace_id: WORKSPACE,
      linkedin_url: "linkedin.com/in/jane-doe",
      provider_id: "prov_jane",
      first_name: "Jane",
      last_name: "Doe",
      company: "Northwind",
      do_not_contact: false,
      last_contacted_at: null,
    },
  ]);
  db.seed("campaign_prospects", [
    { id: CP, workspace_id: WORKSPACE, campaign_id: CAMPAIGN, prospect_id: PROSPECT, status: "accepted", last_step_sent: 0, next_action_at: null },
  ]);

  const linkedinAction = bullQueue("linkedinAction", log);
  const inbound = bullQueue("inbound", log);
  const plain = { add: async () => undefined };
  const queues = {
    strategy: plain,
    targeting: plain,
    campaignTick: plain,
    linkedinAction,
    inbound,
    maintenance: plain,
    digest: plain,
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
      INTERNAL_API_SECRET: SECRET,
    } as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  return { db, ctx, linkedin, queues, linkedinAction, inbound, log };
}

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

function draft(message: string, proposesMeeting = false) {
  return { message, proposesMeeting, proposedSlots: [], usedKnowledge: [], unansweredQuestions: [] };
}

function inboundJob(text: string, providerMessageId = "msg_1") {
  return {
    workspaceId: WORKSPACE,
    linkedinAccountId: ACCOUNT,
    providerChatId: "chat_1",
    providerMessageId,
    fromProviderId: "prov_jane",
    text,
    receivedAt: NOW.toISOString(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  classifyMock.mockReset();
  draftMock.mockReset();
  classifyMock.mockResolvedValue(classification());
  draftMock.mockResolvedValue(draft("Happy to talk — what does your week look like?"));
});

const conversation = (db: FakeDb) => db.rows("conversations")[0]!;
const replyJobs = (log: Array<{ queue: string; data: unknown }>) =>
  log.filter((entry) => (entry.data as { kind?: string }).kind === "reply");

describe("a draft the gate held", () => {
  it("is flagged for a person and never queued", async () => {
    /*
     * The link check turns a `send` into a hold after the classifier has
     * spoken. The draft was saved from the final gate and everything after it
     * read the classifier's decision: no flag, so nobody was told, and a reply
     * job that found the draft unapproved and finished doing nothing — under
     * the id the rep's own Send would use a minute later.
     */
    const { db, ctx, queues, log } = harness();
    draftMock.mockResolvedValue(draft("Grab a slot at acme.com/demo"));

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    expect(db.rows("reply_drafts")[0]?.status).toBe("pending");
    expect(conversation(db).needs_human).toBe(true);
    expect(conversation(db).needs_human_kind).toBe("reply");
    expect(String(conversation(db).needs_human_reason)).toContain("acme.com/demo");
    expect(replyJobs(log)).toHaveLength(0);
  });

  it("still sends a clean draft on autopilot", async () => {
    const { db, ctx, queues, log } = harness();

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    expect(db.rows("reply_drafts")[0]?.status).toBe("approved");
    // Stamped, so the maintenance sweep can find it if its job never sends.
    expect(db.rows("reply_drafts")[0]?.resolved_at).toBeTruthy();
    expect(replyJobs(log)).toHaveLength(1);
  });
});

describe("a reply job id held by a finished job", () => {
  async function approvedDraft(db: FakeDb) {
    db.seed("conversations", [{ id: "conv-1", workspace_id: WORKSPACE, prospect_id: PROSPECT, linkedin_account_id: ACCOUNT }]);
    db.seed("reply_drafts", [
      {
        id: DRAFT,
        workspace_id: WORKSPACE,
        conversation_id: "conv-1",
        body: "Thanks — here is what it does.",
        status: "approved",
        resolved_at: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
      },
    ]);
  }

  it("does not swallow the rep's Send", async () => {
    // The job that ran while the draft was still pending finished without
    // sending and kept `reply:draft-1`. A plain `add` handed that corpse back,
    // the route said "queued", and nothing went.
    const { db, ctx, queues, linkedinAction } = harness();
    await approvedDraft(db);
    linkedinAction.jobs.set(jobId("reply", DRAFT), { state: "completed", data: null });

    const res = await createServer(ctx, queues).request("/jobs/send-reply", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER, draftId: DRAFT }),
    });

    expect(res.status).toBe(200);
    expect(linkedinAction.removed).toContain(jobId("reply", DRAFT));
    expect(linkedinAction.jobs.get(jobId("reply", DRAFT))?.state).toBe("waiting");
  });

  it("is revived by the maintenance sweep", async () => {
    const { db, ctx, queues, linkedinAction } = harness();
    await approvedDraft(db);
    linkedinAction.jobs.set(jobId("reply", DRAFT), { state: "failed", data: null });

    await runMaintenance(ctx, queues, NOW);

    expect(linkedinAction.removed).toContain(jobId("reply", DRAFT));
    expect(linkedinAction.jobs.get(jobId("reply", DRAFT))?.state).toBe("waiting");
  });

  it("is left alone while it is still waiting to run", async () => {
    const { db, ctx, queues, linkedinAction } = harness();
    await approvedDraft(db);
    linkedinAction.jobs.set(jobId("reply", DRAFT), { state: "delayed", data: null });

    await createServer(ctx, queues).request("/jobs/send-reply", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER, draftId: DRAFT }),
    });

    expect(linkedinAction.removed).toHaveLength(0);
  });
});

describe("the two doors replies arrive by", () => {
  function webhook(ctx: WorkerContext, queues: Queues, messages: unknown[]) {
    return createServer(ctx, queues).request("/webhooks/unipile/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(messages),
    });
  }

  it("does not queue a webhook delivery with no sender", async () => {
    // Nothing can match it to a prospect, and the poll already skips these.
    const { ctx, queues, inbound } = harness();

    await webhook(ctx, queues, [
      { providerMessageId: "m-empty", providerChatId: "c", providerAccountId: "acct_1", fromProviderId: "", text: "hi", receivedAt: NOW.toISOString() },
    ]);

    expect(inbound.jobs.size).toBe(0);
  });

  it("does not let a finished webhook job turn the poll away", async () => {
    // A webhook job that finished without storing the message held
    // `inbound:<id>` for a day, and the poll's `add` was taken for a duplicate.
    const { ctx, queues, inbound, linkedin } = harness();
    inbound.jobs.set(jobId("inbound", "m-1"), { state: "completed", data: null });
    linkedin.inbox = [
      { providerMessageId: "m-1", providerChatId: "c", providerAccountId: "acct_1", fromProviderId: "prov_jane", text: "Yes please", receivedAt: NOW.toISOString() },
    ];

    const result = await pollInbound(ctx, queues, NOW);

    expect(result.enqueued).toBe(1);
    expect(inbound.removed).toContain(jobId("inbound", "m-1"));
    expect(inbound.jobs.get(jobId("inbound", "m-1"))?.state).toBe("waiting");
  });

  it("revives a finished job from the webhook too", async () => {
    const { ctx, queues, inbound } = harness();
    inbound.jobs.set(jobId("inbound", "m-2"), { state: "completed", data: null });

    await webhook(ctx, queues, [
      { providerMessageId: "m-2", providerChatId: "c", providerAccountId: "acct_1", fromProviderId: "prov_jane", text: "Yes", receivedAt: NOW.toISOString() },
    ]);

    expect(inbound.removed).toContain(jobId("inbound", "m-2"));
  });

  it("answers a revived job for a stored message without calling a model", async () => {
    // Most replies arrive through both doors, so this is the common case and
    // it has to cost a lookup, not a classification.
    const { db, ctx, queues } = harness();
    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));
    classifyMock.mockClear();
    draftMock.mockClear();

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    expect(classifyMock).not.toHaveBeenCalled();
    expect(draftMock).not.toHaveBeenCalled();
    expect(db.rows("reply_drafts")).toHaveLength(1);
  });
});

describe("polling past an account that failed", () => {
  it("does not move a failed account's starting point", async () => {
    /*
     * One stamp for every account, written after every run, told the next run
     * a failed account had been read. Anything it received more than the
     * overlap before that was never asked for again.
     */
    const { db, ctx, queues, linkedin } = harness();
    db.seed("linkedin_accounts", [
      { id: "row-2", workspace_id: WORKSPACE, user_id: "u2", provider_account_id: "acct_2", status: "active" },
    ]);
    const asked: Record<string, string[]> = {};
    let failSecond = true;
    linkedin.listNewMessages = async (input: { accountId: string; since: string }) => {
      (asked[input.accountId] ??= []).push(input.since);
      if (input.accountId === "acct_2" && failSecond) throw new Error("provider said no");
      return [];
    };

    await pollInbound(ctx, queues, NOW);
    const firstLookback = new Date(NOW.getTime() - 7 * 86_400_000).toISOString();
    expect(asked.acct_2?.[0]).toBe(firstLookback);

    const later = new Date(NOW.getTime() + 15 * 60_000);
    failSecond = false;
    await pollInbound(ctx, queues, later);

    // The healthy account moved on; the failed one is asked from where it was.
    expect(asked.acct_1?.[1]).toBe(new Date(NOW.getTime() - 30 * 60_000).toISOString());
    expect(asked.acct_2?.[1]).toBe(new Date(later.getTime() - 7 * 86_400_000).toISOString());

    const beat = db.find("worker_heartbeats", { name: INBOUND_POLL_BEAT })!.detail as {
      at: string | null;
      accountsAt: Record<string, string>;
    };
    expect(beat.accountsAt[ACCOUNT]).toBe(later.toISOString());
    expect(beat.accountsAt["row-2"]).toBe(later.toISOString());
    expect(beat.at).toBe(later.toISOString());
  });

  it("holds the shared stamp back while any account is failing", async () => {
    const { db, ctx, queues, linkedin } = harness();
    linkedin.listNewMessages = async () => {
      throw new Error("provider said no");
    };

    await pollInbound(ctx, queues, NOW);

    const beat = db.find("worker_heartbeats", { name: INBOUND_POLL_BEAT })!.detail as { at: string | null };
    expect(beat.at).toBeNull();
  });
});

describe("a reply the model could not read", () => {
  it("records an opt-out without asking the model", async () => {
    // Rule 7: deterministic as well as by the model — and as well as means
    // not after it. A provider outage threw before the classifier's own
    // override was reached, and "remove me" was never recorded.
    const { db, ctx, queues } = harness();
    classifyMock.mockRejectedValue(new Error("model unavailable"));

    await handleInboundMessage(ctx, queues, inboundJob("Please remove me from your list"));

    expect(classifyMock).not.toHaveBeenCalled();
    expect(db.find("prospects", { id: PROSPECT })?.do_not_contact).toBe(true);
    expect(db.find("campaign_prospects", { id: CP })?.status).toBe("opted_out");
    expect(db.rows("reply_drafts")).toHaveLength(0);
  });

  it("is put in front of a person before the error goes back to the queue", async () => {
    const { db, ctx, queues } = harness();
    classifyMock.mockRejectedValue(new Error("model unavailable"));

    await expect(handleInboundMessage(ctx, queues, inboundJob("Can you tell me more?"))).rejects.toThrow(
      "model unavailable",
    );

    expect(conversation(db).needs_human).toBe(true);
    expect(conversation(db).needs_human_kind).toBe("reply");
    expect(String(conversation(db).needs_human_reason)).toMatch(/could not read this reply/);
  });

  it("is repaired by a retry when the first run died before flagging it", async () => {
    // The old `if (existing) return` made a stored, unread message permanent.
    const { db, ctx, queues } = harness();
    db.seed("conversations", [
      { id: "conv-1", workspace_id: WORKSPACE, prospect_id: PROSPECT, linkedin_account_id: ACCOUNT, needs_human: false },
    ]);
    db.seed("messages", [
      { workspace_id: WORKSPACE, conversation_id: "conv-1", direction: "inbound", body: "Can you tell me more?", provider_message_id: "msg_1", classification: null },
    ]);

    await handleInboundMessage(ctx, queues, inboundJob("Can you tell me more?"));

    expect(classifyMock).not.toHaveBeenCalled();
    expect(db.find("conversations", { id: "conv-1" })?.needs_human).toBe(true);
  });

  it("does not raise again a hold somebody already dismissed", async () => {
    const { db, ctx, queues } = harness();
    classifyMock.mockRejectedValue(new Error("model unavailable"));
    await expect(handleInboundMessage(ctx, queues, inboundJob("Can you tell me more?"))).rejects.toThrow();
    // The rep reads it and dismisses it.
    Object.assign(conversation(db), { needs_human: false, needs_human_kind: null, needs_human_reason: null });

    await handleInboundMessage(ctx, queues, inboundJob("Can you tell me more?"));

    expect(conversation(db).needs_human).toBe(false);
  });
});

describe("holds on one conversation", () => {
  async function seeded() {
    const db = new FakeDb();
    db.seed("conversations", [{ id: "c", workspace_id: WORKSPACE, needs_human: false, needs_human_kind: null }]);
    return { db, row: () => db.find("conversations", { id: "c" })! };
  }

  it("never lets a reply hold erase a booking hold", async () => {
    // The inbound job books first and drafts second, so this ordering is the
    // normal one — and the second flag used to overwrite the first.
    const { db, row } = await seeded();
    await flagForHuman(db.asDb(), "c", "calendar write failed, book this manually", "booking");
    await flagForHuman(db.asDb(), "c", "pricing question", "reply");

    expect(row().needs_human_kind).toBe("booking");
    expect(row().needs_human_reason).toBe("calendar write failed, book this manually");
  });

  it("lets a booking hold replace a reply hold", async () => {
    const { db, row } = await seeded();
    await flagForHuman(db.asDb(), "c", "pricing question", "reply");
    await flagForHuman(db.asDb(), "c", "calendar write failed, book this manually", "booking");

    expect(row().needs_human_kind).toBe("booking");
  });

  it("lets a reply replace a copy hold, and not the other way round", async () => {
    const { db, row } = await seeded();
    await flagForHuman(db.asDb(), "c", "no approved pitch", "copy");
    await flagForHuman(db.asDb(), "c", "pricing question", "reply");
    expect(row().needs_human_kind).toBe("reply");

    await flagForHuman(db.asDb(), "c", "no approved pitch", "copy");
    expect(row().needs_human_kind).toBe("reply");
  });

  it("clears only the kind it is asked to", async () => {
    const { db, row } = await seeded();
    await flagForHuman(db.asDb(), "c", "calendar write failed", "booking");
    await clearHold(db.asDb(), "c", "reply");
    expect(row().needs_human).toBe(true);

    await clearHold(db.asDb(), "c", "booking");
    expect(row().needs_human).toBe(false);
  });

  it("keeps the booking hold when the inbound job then holds its reply", async () => {
    // Asserted on the real path, not only on the helper (rule 39's lesson).
    // Somebody accepts an offered Thursday; the rep's day is already at its
    // cap, so the booking is refused and held — and the reply drafted next,
    // which knows nothing about that, waits for the same person.
    const { db, ctx, queues, log } = harness();
    db.seed("availability", [
      {
        workspace_id: WORKSPACE,
        user_id: USER,
        timezone: "UTC",
        working_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
        meeting_minutes: 30,
        min_notice_hours: 12,
        buffer_minutes: 15,
        max_per_day: 1,
        location: null,
      },
    ]);
    db.seed("meetings", [
      { workspace_id: WORKSPACE, rep_user_id: USER, prospect_id: "someone-else", starts_at: "2026-09-10T10:00:00.000Z", ends_at: "2026-09-10T10:30:00.000Z", status: "scheduled", cancelled_at: null },
    ]);
    db.seed("conversations", [
      { id: "conv-1", workspace_id: WORKSPACE, prospect_id: PROSPECT, linkedin_account_id: ACCOUNT, campaign_id: CAMPAIGN, needs_human: false },
    ]);
    db.seed("reply_drafts", [
      { workspace_id: WORKSPACE, conversation_id: "conv-1", proposes_meeting: true, proposed_slots: ["2026-09-10T14:00:00.000Z"], status: "sent", body: "Thursday at 2pm?" },
    ]);

    await handleInboundMessage(ctx, queues, inboundJob("Thursday at 2pm works"));

    expect(db.rows("meetings")).toHaveLength(1);
    const row = db.find("conversations", { id: "conv-1" })!;
    expect(row.needs_human_kind).toBe("booking");
    expect(replyJobs(log)).toHaveLength(0);
    expect(db.rows("reply_drafts").filter((d) => d.status === "pending")).toHaveLength(1);
  });
});

describe("a follow-up held for copy", () => {
  it("clears its hold once it has actually been sent", async () => {
    // Nothing ever cleared a copy hold. Approving the pitch released the
    // message on the next tick and left the conversation in the inbox asking
    // for an approval that had already happened.
    const { db, ctx, linkedin } = harness();
    db.seed("pitches", [
      { id: "pitch-1", workspace_id: WORKSPACE, body: "We match you and make the intro.", written_by: "agent", facts_used: [], approved_at: null, is_default: true },
    ]);
    db.rows("campaign_steps")[0]!.message = "Hi {{first_name}} — {{pitch}}";

    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });
    expect(conversation(db).needs_human_kind).toBe("copy");

    db.find("pitches", { id: "pitch-1" })!.approved_at = NOW.toISOString();
    await runLinkedInAction(ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: CP, stepNumber: 1 });

    expect(linkedin.sentMessages).toHaveLength(1);
    expect(conversation(db).needs_human).toBe(false);
    expect(conversation(db).needs_human_kind).toBeNull();
  });
});

describe("the times a reply offers", () => {
  function availability(overrides: Record<string, unknown> = {}) {
    return {
      workspace_id: WORKSPACE,
      user_id: USER,
      timezone: "UTC",
      working_hours: { start: 13, end: 15, days: [1, 2, 3, 4, 5] },
      meeting_minutes: 45,
      min_notice_hours: 12,
      buffer_minutes: 15,
      max_per_day: 3,
      location: null,
      ...overrides,
    };
  }

  const offeredHours = (db: FakeDb) =>
    ((db.rows("reply_drafts")[0]?.proposed_slots as string[]) ?? []).map((iso) => ({
      start: new Date(iso).getUTCHours() * 60 + new Date(iso).getUTCMinutes(),
    }));

  it("come from the rep's own hours and meeting length", async () => {
    // The campaign parser answered nine-to-five when the campaign said
    // nothing, so the rep's availability row was never read for a reply.
    const { db, ctx, queues } = harness();
    db.seed("availability", [availability()]);
    db.find("campaigns", { id: CAMPAIGN })!.reply_mode = "approval";
    draftMock.mockResolvedValue(draft("Does one of these work?", true));

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    const offered = offeredHours(db);
    expect(offered.length).toBeGreaterThan(0);
    // 45 minutes inside 13:00–15:00: the last start that fits is 14:00.
    for (const { start } of offered) {
      expect(start).toBeGreaterThanOrEqual(13 * 60);
      expect(start + 45).toBeLessThanOrEqual(15 * 60);
    }
  });

  it("win over a campaign's hours", async () => {
    const { db, ctx, queues } = harness();
    db.seed("availability", [availability()]);
    db.find("campaigns", { id: CAMPAIGN })!.rules = { workingHours: { start: 9, end: 11, days: [1, 2, 3, 4, 5] } };
    db.find("campaigns", { id: CAMPAIGN })!.reply_mode = "approval";
    draftMock.mockResolvedValue(draft("Does one of these work?", true));

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    for (const { start } of offeredHours(db)) expect(start).toBeGreaterThanOrEqual(13 * 60);
  });

  it("use a campaign's explicit hours when the rep has set none", async () => {
    const { db, ctx, queues } = harness();
    // The afternoon, so the default nine o'clock cannot pass for it.
    db.find("campaigns", { id: CAMPAIGN })!.rules = { workingHours: { start: 15, end: 17, days: [1, 2, 3, 4, 5] } };
    db.find("campaigns", { id: CAMPAIGN })!.reply_mode = "approval";
    draftMock.mockResolvedValue(draft("Does one of these work?", true));

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    const offered = offeredHours(db);
    expect(offered.length).toBeGreaterThan(0);
    for (const { start } of offered) expect(start).toBeGreaterThanOrEqual(15 * 60);
  });

  it("skip a day already at the rep's meeting cap", async () => {
    const { db, ctx, queues } = harness();
    db.seed("availability", [availability({ max_per_day: 1 })]);
    // Thursday is the first day with enough notice; fill it.
    db.seed("meetings", [
      { workspace_id: WORKSPACE, rep_user_id: USER, prospect_id: "x", starts_at: "2026-09-10T09:00:00.000Z", ends_at: "2026-09-10T09:30:00.000Z", status: "scheduled", cancelled_at: null },
    ]);
    db.find("campaigns", { id: CAMPAIGN })!.reply_mode = "approval";
    draftMock.mockResolvedValue(draft("Does one of these work?", true));

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    const slots = (db.rows("reply_drafts")[0]?.proposed_slots as string[]) ?? [];
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((iso) => iso.startsWith("2026-09-10"))).toBe(false);
  });
});

describe("a conversation opened by a reply", () => {
  it("belongs to the campaign its prospect is on", async () => {
    // Created with no campaign and kept none, so every count read by campaign
    // left out the replies the campaign existed to produce.
    const { db, ctx, queues } = harness();

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    expect(conversation(db).campaign_id).toBe(CAMPAIGN);
  });

  it("keeps a campaign it already has", async () => {
    const { db, ctx, queues } = harness();
    db.seed("conversations", [
      { id: "conv-1", workspace_id: WORKSPACE, prospect_id: PROSPECT, linkedin_account_id: ACCOUNT, campaign_id: "other-campaign" },
    ]);

    await handleInboundMessage(ctx, queues, inboundJob("Sounds interesting"));

    expect(db.find("conversations", { id: "conv-1" })?.campaign_id).toBe("other-campaign");
  });
});
