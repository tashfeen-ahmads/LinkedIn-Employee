import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { MockLinkedInProvider } from "@le/linkedin";
import { LINKEDIN_LIMITS } from "@le/shared";
import { withdrawStaleInvites } from "../src/jobs/withdraw.js";
import type { WorkerContext } from "../src/context.js";

/*
 * 30 October: four of five sending accounts were refused by LinkedIn all day
 * under piles of unanswered invitations (165 and 258 on two of them). The
 * sweep withdrew Nora's own only, only after 21 days, and fifty a night
 * across the whole deployment.
 */
const NOW = new Date("2026-10-30T03:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function harness(options: { cleanup?: boolean; pending?: Array<{ id: string; days: number | null }> } = {}) {
  const db = new FakeDb();
  db.seed("workspaces", [
    { id: "w1", withdraw_old_invites: options.cleanup ?? false },
    { id: "w2", withdraw_old_invites: false },
  ]);
  db.seed("linkedin_accounts", [
    { id: "a1", workspace_id: "w1", provider_account_id: "pa1", status: "active" },
    { id: "a2", workspace_id: "w2", provider_account_id: "pa2", status: "active" },
  ]);
  db.seed("campaigns", [
    { id: "c1", workspace_id: "w1", linkedin_account_id: "a1" },
    { id: "c2", workspace_id: "w2", linkedin_account_id: "a2" },
  ]);
  db.seed("campaign_prospects", []);
  db.seed("events", []);
  const linkedin = new MockLinkedInProvider();
  const withdrawn: Array<{ accountId: string; invitationId: string }> = [];
  linkedin.withdrawInvitation = async (input) => {
    withdrawn.push(input);
    return { ok: true };
  };
  linkedin.pendingInvitations = (options.pending ?? []).map((p) => ({
    invitationId: p.id,
    providerId: null,
    name: null,
    sentAt: p.days === null ? null : daysAgo(p.days),
  }));
  const ctx = { db: db.asDb(), linkedin } as unknown as WorkerContext;
  return { db, ctx, withdrawn };
}

const invited = (id: string, campaign: string, days: number) => ({
  id,
  workspace_id: campaign === "c1" ? "w1" : "w2",
  campaign_id: campaign,
  status: "invited",
  invitation_id: `inv-${id}`,
  invited_at: daysAgo(days),
});

describe("withdrawing Nora's own invitations", () => {
  it("withdraws at 14 days and closes the prospect, never a younger one", async () => {
    const { db, ctx, withdrawn } = harness();
    db.seed("campaign_prospects", [invited("old", "c1", 15), invited("young", "c1", 10)]);
    await withdrawStaleInvites(ctx, NOW);
    expect(withdrawn.map((w) => w.invitationId)).toEqual(["inv-old"]);
    expect(db.find("campaign_prospects", { id: "old" })).toMatchObject({ status: "closed", status_reason: "invitation expired" });
    expect(db.find("campaign_prospects", { id: "young" })?.status).toBe("invited");
  });

  it("gives every account its own night, so one pile never starves another", async () => {
    const { db, ctx, withdrawn } = harness();
    const many = Array.from({ length: 60 }, (_, i) => invited(`a${i}`, "c1", 20));
    db.seed("campaign_prospects", [...many, invited("other", "c2", 20)]);
    await withdrawStaleInvites(ctx, NOW);
    const forA1 = withdrawn.filter((w) => w.accountId === "pa1").length;
    expect(forA1).toBe(LINKEDIN_LIMITS.withdrawPerAccountPerNight);
    expect(withdrawn.some((w) => w.invitationId === "inv-other")).toBe(true);
  });
});

describe("cleaning up invitations sent outside Nora", () => {
  it("does nothing until an owner turns it on", async () => {
    const { ctx, withdrawn } = harness({ cleanup: false, pending: [{ id: "x-old", days: 60 }] });
    await withdrawStaleInvites(ctx, NOW);
    expect(withdrawn).toHaveLength(0);
  });

  it("withdraws only those LinkedIn says are three weeks old, oldest first, never one of unknown age", async () => {
    const { ctx, withdrawn } = harness({
      cleanup: true,
      pending: [
        { id: "x-30", days: 30 },
        { id: "x-10", days: 10 },
        { id: "x-unknown", days: null },
        { id: "x-90", days: 90 },
      ],
    });
    await withdrawStaleInvites(ctx, NOW);
    expect(withdrawn.map((w) => w.invitationId)).toEqual(["x-90", "x-30"]);
    expect(withdrawn.every((w) => w.accountId === "pa1")).toBe(true);
  });
});
