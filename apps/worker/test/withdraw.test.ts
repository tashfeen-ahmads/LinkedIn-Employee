import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { MockLinkedInProvider, type PendingInvitation } from "@le/linkedin";
import { LINKEDIN_LIMITS } from "@le/shared";
import { WITHDRAWN_EVENT, WITHDRAW_REFUSED_EVENT, withdrawStaleInvites } from "../src/jobs/withdraw.js";
import type { WorkerContext } from "../src/context.js";

/*
 * 30 October: four of five sending accounts were refused by LinkedIn all day
 * under piles of 150 to 258 unanswered invitations, and nothing had ever been
 * withdrawn on any account: the call went to the wrong address, ran at 3am
 * across the whole deployment, and trusted our rows over LinkedIn's list.
 */
const FRIDAY_2PM = new Date("2026-10-30T14:00:00Z"); // inside the default 8 to 6, Mon to Fri, UTC
const daysAgo = (n: number, from = FRIDAY_2PM) => new Date(from.getTime() - n * 86_400_000).toISOString();

type Pending = { id: string; person?: string; days: number | null };

function harness(options: { cleanup?: boolean; pending?: Record<string, Pending[]>; truncated?: boolean } = {}) {
  const db = new FakeDb();
  db.seed("workspaces", [
    { id: "w1", withdraw_old_invites: options.cleanup ?? false },
    { id: "w2", withdraw_old_invites: false },
  ]);
  db.seed("linkedin_accounts", [
    { id: "a1", workspace_id: "w1", user_id: "u1", provider_account_id: "pa1", status: "active", working_hours: null },
    { id: "a2", workspace_id: "w2", user_id: "u2", provider_account_id: "pa2", status: "active", working_hours: null },
  ]);
  db.seed("profiles", [
    { id: "u1", timezone: "UTC" },
    { id: "u2", timezone: "UTC" },
  ]);
  db.seed("campaigns", [
    { id: "c1", workspace_id: "w1", linkedin_account_id: "a1" },
    { id: "c2", workspace_id: "w2", linkedin_account_id: "a2" },
  ]);
  db.seed("prospects", []);
  db.seed("campaign_prospects", []);
  db.seed("events", []);
  db.seed("platform_settings", []);
  const linkedin = new MockLinkedInProvider();
  const withdrawn: Array<{ accountId: string; invitationId: string }> = [];
  linkedin.withdrawInvitation = async (input) => {
    withdrawn.push(input);
    return { ok: true };
  };
  linkedin.listPendingInvitations = async (input: { accountId: string }) => ({
    invitations: (options.pending?.[input.accountId] ?? []).map(
      (p): PendingInvitation => ({
        invitationId: p.id,
        providerId: p.person ?? null,
        name: null,
        sentAt: p.days === null ? null : daysAgo(p.days),
      }),
    ),
    raw: null,
    truncated: options.truncated ?? false,
  });
  const ctx = { db: db.asDb(), linkedin } as unknown as WorkerContext;
  return { db, ctx, withdrawn, linkedin };
}

/** One of Nora's own: a prospect, and their invitation still waiting. */
function own(db: FakeDb, id: string, campaign: "c1" | "c2", days: number) {
  db.seed("prospects", [{ id: `p-${id}`, workspace_id: campaign === "c1" ? "w1" : "w2", provider_id: `person-${id}` }]);
  db.seed("campaign_prospects", [
    {
      id,
      workspace_id: campaign === "c1" ? "w1" : "w2",
      campaign_id: campaign,
      prospect_id: `p-${id}`,
      status: "invited",
      invitation_id: `inv-${id}`,
      invited_at: daysAgo(days),
    },
  ]);
}

describe("withdrawing Nora's own invitations", () => {
  it("withdraws one LinkedIn still lists as pending once it is 14 days old, and closes it", async () => {
    const { db, ctx, withdrawn } = harness({ pending: { pa1: [{ id: "inv-old", days: 15 }, { id: "inv-young", days: 10 }] } });
    own(db, "old", "c1", 15);
    own(db, "young", "c1", 10);
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn.map((w) => w.invitationId)).toEqual(["inv-old"]);
    expect(db.find("campaign_prospects", { id: "old" })).toMatchObject({ status: "closed", status_reason: "invitation expired" });
    expect(db.find("campaign_prospects", { id: "young" })?.status).toBe("invited");
  });

  it("never withdraws an invitation LinkedIn no longer lists: that person may have said yes", async () => {
    const { db, ctx, withdrawn } = harness({ pending: { pa1: [] } });
    own(db, "accepted", "c1", 20);
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn).toHaveLength(0);
    expect(db.find("campaign_prospects", { id: "accepted" })?.status).toBe("invited");
  });

  it("finds an invitation by the person when LinkedIn's id differs from the one stored", async () => {
    const { db, ctx, withdrawn } = harness({ pending: { pa1: [{ id: "linkedin-own-id", person: "person-old", days: 16 }] } });
    own(db, "old", "c1", 16);
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn.map((w) => w.invitationId)).toEqual(["linkedin-own-id"]);
  });

  it("tries the stored id when LinkedIn's list was too long to read whole", async () => {
    const { db, ctx, withdrawn } = harness({ pending: { pa1: [] }, truncated: true });
    own(db, "old", "c1", 16);
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn.map((w) => w.invitationId)).toEqual(["inv-old"]);
  });
});

describe("when and how many", () => {
  it("does nothing outside the owner's working hours", async () => {
    const night = new Date("2026-10-30T03:00:00Z");
    const { db, ctx, withdrawn } = harness({ pending: { pa1: [{ id: "inv-old", days: 15 }] } });
    own(db, "old", "c1", 15);
    await withdrawStaleInvites(ctx, night);
    expect(withdrawn).toHaveLength(0);
  });

  it("takes a few an hour, oldest first, never a burst", async () => {
    const pending = Array.from({ length: 10 }, (_, i) => ({ id: `inv-o${i}`, days: 15 + i }));
    const { db, ctx, withdrawn } = harness({ pending: { pa1: pending } });
    for (let i = 0; i < 10; i++) own(db, `o${i}`, "c1", 15 + i);
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn).toHaveLength(LINKEDIN_LIMITS.withdrawPerAccountPerHour);
    expect(withdrawn[0]?.invitationId).toBe("inv-o9");
  });

  it("stops at the day's allowance, counted from the account's own record", async () => {
    const pending = Array.from({ length: 10 }, (_, i) => ({ id: `inv-o${i}`, days: 15 + i }));
    const { db, ctx, withdrawn } = harness({ pending: { pa1: pending } });
    for (let i = 0; i < 10; i++) own(db, `o${i}`, "c1", 15 + i);
    db.seed("events", [
      {
        id: "e-today",
        workspace_id: "w1",
        name: WITHDRAWN_EVENT,
        subject_id: "a1",
        payload: { withdrawn: LINKEDIN_LIMITS.withdrawPerAccountPerDay - 1 },
        created_at: "2026-10-30T10:00:00Z",
      },
    ]);
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn).toHaveLength(1);
  });

  it("gives every account its own turn", async () => {
    const { db, ctx, withdrawn } = harness({
      pending: {
        pa1: Array.from({ length: 8 }, (_, i) => ({ id: `inv-a${i}`, days: 20 })),
        pa2: [{ id: "inv-b", days: 20 }],
      },
    });
    for (let i = 0; i < 8; i++) own(db, `a${i}`, "c1", 20);
    own(db, "b", "c2", 20);
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn.some((w) => w.accountId === "pa2" && w.invitationId === "inv-b")).toBe(true);
  });

  it("waits while the operator has paused outreach", async () => {
    const { db, ctx, withdrawn } = harness({ pending: { pa1: [{ id: "inv-old", days: 15 }] } });
    own(db, "old", "c1", 15);
    db.seed("platform_settings", [{ id: 1, outreach_paused_at: "2026-10-30T09:00:00Z", outreach_paused_reason: "incident" }]);
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn).toHaveLength(0);
  });
});

describe("when LinkedIn refuses", () => {
  it("records the refusal in LinkedIn's words, leaves the person waiting, and stops the account for the day on pushback", async () => {
    const pending = [
      { id: "inv-o1", days: 20 },
      { id: "inv-o2", days: 19 },
    ];
    const { db, ctx, linkedin } = harness({ pending: { pa1: pending } });
    own(db, "o1", "c1", 20);
    own(db, "o2", "c1", 19);
    const calls: string[] = [];
    linkedin.withdrawInvitation = async (input) => {
      calls.push(input.invitationId);
      return { ok: false, error: "429: Too many requests — errors/too_many_requests", health: "warning" };
    };
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(calls).toEqual(["inv-o1"]);
    expect(db.find("campaign_prospects", { id: "o1" })?.status).toBe("invited");
    const refusal = db.rows("events").find((e) => e.name === WITHDRAW_REFUSED_EVENT) as { payload: { stop: boolean; provider: string } };
    expect(refusal.payload.stop).toBe(true);
    expect(refusal.payload.provider).toContain("429");

    // An hour later the same day: nothing more is asked of that account.
    calls.length = 0;
    await withdrawStaleInvites(ctx, new Date("2026-10-30T15:00:00Z"));
    expect(calls).toHaveLength(0);
  });
});

describe("cleaning up invitations sent outside Nora", () => {
  it("does nothing until an owner turns it on", async () => {
    const { ctx, withdrawn } = harness({ cleanup: false, pending: { pa1: [{ id: "x-old", days: 60 }] } });
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn).toHaveLength(0);
  });

  it("withdraws only those LinkedIn says are three weeks old, oldest first, never one of unknown age", async () => {
    const { ctx, withdrawn } = harness({
      cleanup: true,
      pending: {
        pa1: [
          { id: "x-30", days: 30 },
          { id: "x-10", days: 10 },
          { id: "x-unknown", days: null },
          { id: "x-90", days: 90 },
        ],
      },
    });
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn.map((w) => w.invitationId)).toEqual(["x-90", "x-30"]);
  });

  it("leaves a person Nora is still waiting on to Nora's own rule", async () => {
    const { db, ctx, withdrawn } = harness({
      cleanup: true,
      pending: { pa1: [{ id: "some-other-id", person: "person-young", days: 40 }] },
    });
    own(db, "young", "c1", 5);
    await withdrawStaleInvites(ctx, FRIDAY_2PM);
    expect(withdrawn).toHaveLength(0);
  });
});
