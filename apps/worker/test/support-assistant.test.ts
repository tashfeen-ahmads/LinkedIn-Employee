import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportDraft } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";

/*
 * The support assistant, end to end on the worker side: it reads a ticket,
 * drafts, and the gate — not the model — decides whether the customer sees the
 * answer now or an operator reads it first.
 *
 * The model is replaced, because what is under test is what happens to its
 * answer, and an answer that depends on a live model is a test that passes on
 * Tuesdays.
 */
const draft = vi.fn<() => Promise<SupportDraft>>();
vi.mock("@le/agents", () => ({ draftSupportAnswer: (..._args: unknown[]) => draft() }));

const { answerSupportTicket, sweepSupportTickets } = await import("../src/jobs/support.js");

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const TICKET = "33333333-3333-4333-8333-333333333333";

const HOW_TO: SupportDraft = {
  category: "how_to",
  answer:
    "Your campaign \"Founders\" is ready and still a draft. Open it on the Campaigns page, read the names and the notes, then press Launch.",
  confidence: 0.92,
  needsHuman: false,
  reasonForHuman: null,
};

function harness(over: { autopilot?: boolean; createdAt?: string; reopened?: boolean } = {}) {
  const db = new FakeDb();
  db.seed("support_tickets", [
    {
      id: TICKET,
      workspace_id: WORKSPACE,
      raised_by: USER,
      subject: "How do I start?",
      body: "I have prospects but do not see how to approve or start.",
      status: "open",
      context: {},
      answer: over.reopened ? "Press Launch." : null,
      answered_by: over.reopened ? "agent" : null,
      followup: over.reopened ? "There is no Launch button." : null,
      reopened_at: over.reopened ? "2026-10-06T11:00:00Z" : null,
      drafted_at: null,
      created_at: over.createdAt ?? "2026-10-06T11:30:00Z",
    },
  ]);
  db.seed("platform_settings", [{ id: true, outreach_paused_at: null, support_autopilot: over.autopilot ?? true }]);
  for (const t of [
    "business_profiles",
    "customer_profiles",
    "linkedin_accounts",
    "campaigns",
    "conversations",
    "pitches",
    "hooks",
    "worker_heartbeats",
    "campaign_prospects",
    "events",
  ]) {
    db.seed(t, []);
  }
  const ctx = { db: db.asDb(), agentsFor: () => ({ client: {} as never }) } as unknown as WorkerContext;
  return { db, ctx };
}

const ticket = (db: FakeDb) => db.find("support_tickets", { id: TICKET })!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  draft.mockReset();
});

describe("answerSupportTicket", () => {
  it("answers a confident how-to by itself, and says it was the assistant", async () => {
    draft.mockResolvedValue(HOW_TO);
    const { db, ctx } = harness();
    expect(await answerSupportTicket(ctx, TICKET)).toBe("answered");
    expect(ticket(db).status).toBe("answered");
    expect(ticket(db).answer).toBe(HOW_TO.answer);
    expect(ticket(db).answered_by).toBe("agent");
  });

  it("holds the draft for a person when autopilot is off", async () => {
    draft.mockResolvedValue(HOW_TO);
    const { db, ctx } = harness({ autopilot: false });
    expect(await answerSupportTicket(ctx, TICKET)).toBe("held");
    expect(ticket(db).status).toBe("open");
    expect(ticket(db).answer).toBeNull();
    expect(ticket(db).draft_answer).toBe(HOW_TO.answer);
    expect(ticket(db).draft_reason).toMatch(/Autopilot is off/);
  });

  it("gives a customer who said the last answer did not help a person", async () => {
    draft.mockResolvedValue(HOW_TO);
    const { db, ctx } = harness({ reopened: true });
    expect(await answerSupportTicket(ctx, TICKET)).toBe("held");
    expect(ticket(db).status).toBe("open");
    // Their earlier answer is not overwritten by the new draft.
    expect(ticket(db).answer).toBe("Press Launch.");
  });

  it("holds an answer to a ticket that waited days", async () => {
    draft.mockResolvedValue(HOW_TO);
    const { db, ctx } = harness({ createdAt: "2026-10-02T16:05:22Z" });
    expect(await answerSupportTicket(ctx, TICKET)).toBe("held");
    expect(ticket(db).status).toBe("open");
  });

  it("holds an answer that names our plumbing", async () => {
    draft.mockResolvedValue({ ...HOW_TO, answer: `${HOW_TO.answer} Your Unipile session expired.` });
    const { db, ctx } = harness();
    expect(await answerSupportTicket(ctx, TICKET)).toBe("held");
    expect(ticket(db).status).toBe("open");
  });

  it("never overwrites an operator who answered while the model was thinking", async () => {
    const { db, ctx } = harness();
    draft.mockImplementation(async () => {
      Object.assign(ticket(db), { status: "answered", answer: "Fixed it for you.", answered_by: "operator" });
      return HOW_TO;
    });
    expect(await answerSupportTicket(ctx, TICKET)).toBe("skipped");
    expect(ticket(db).answer).toBe("Fixed it for you.");
    expect(ticket(db).answered_by).toBe("operator");
  });

  it("records a model failure on the ticket and leaves it open for a person", async () => {
    draft.mockRejectedValue(new Error("model unavailable"));
    const { db, ctx } = harness();
    expect(await answerSupportTicket(ctx, TICKET)).toBe("failed");
    expect(ticket(db).status).toBe("open");
    expect(ticket(db).draft_reason).toMatch(/could not answer/);
    // Stamped, so the hourly sweep does not pay for it again.
    expect(ticket(db).drafted_at).toBeTruthy();
  });

  it("is looked at once by the sweep, never twice", async () => {
    draft.mockResolvedValue({ ...HOW_TO, confidence: 0.5 });
    const { ctx } = harness();
    expect((await sweepSupportTickets(ctx)).held).toBe(1);
    expect((await sweepSupportTickets(ctx)).held).toBe(0);
    expect(draft).toHaveBeenCalledTimes(1);
  });
});
