import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { IDLE_RELEASE_DETAIL, SIGNED_OUT_RELEASE_DETAIL, isIdleForRelease, isIdleReleased, isReleasedByUs } from "@le/shared";
import type { WorkerContext } from "../src/context.js";
import { releaseIdleAccounts, releaseSignedOutAccounts } from "../src/jobs/idle-accounts.js";
import { FakeDb } from "./fake-db.js";

const NOW = new Date("2026-10-30T03:00:00Z");
const OLD = "2026-10-01T12:00:00Z";
const RECENT = "2026-10-25T12:00:00Z";

function setup(account: Record<string, unknown> = {}, lastSeen: string | null = OLD) {
  const db = new FakeDb();
  db.seed("linkedin_accounts", [
    {
      id: "a1",
      workspace_id: "w1",
      user_id: "u1",
      status: "active",
      status_detail: null,
      provider_account_id: "acct-1",
      connected_at: OLD,
      last_action_at: OLD,
      ...account,
    },
  ]);
  db.seed("auth_last_seen", [{ user_id: "u1", last_seen_at: lastSeen }]);
  const linkedin = new MockLinkedInProvider();
  const ctx = { db: db.asDb(), linkedin } as unknown as WorkerContext;
  return { db, linkedin, ctx };
}

describe("releaseIdleAccounts", () => {
  it("releases an account with no running campaign and nothing done for 14 days", async () => {
    const { db, linkedin, ctx } = setup();
    db.seed("campaigns", [
      { id: "c1", linkedin_account_id: "a1", status: "paused", created_at: OLD, updated_at: OLD, launched_at: OLD },
    ]);

    const run = await releaseIdleAccounts(ctx, NOW);

    expect(run.released).toBe(1);
    expect(linkedin.deletedAccounts).toEqual(["acct-1"]);
    const row = db.find("linkedin_accounts", { id: "a1" })!;
    expect(row.status).toBe("disconnected");
    expect(row.provider_account_id).toBeNull();
    expect(isIdleReleased(row as { status: string; status_detail: string })).toBe(true);
    expect(db.rows("events").some((e) => e.name === "linkedin.account.released_idle")).toBe(true);
  });

  it("keeps an account with a running campaign, however quiet", async () => {
    const { db, linkedin, ctx } = setup();
    db.seed("campaigns", [
      { id: "c1", linkedin_account_id: "a1", status: "running", created_at: OLD, updated_at: OLD, launched_at: OLD },
    ]);
    expect((await releaseIdleAccounts(ctx, NOW)).released).toBe(0);
    expect(linkedin.deletedAccounts).toEqual([]);
    expect(db.find("linkedin_accounts", { id: "a1" })?.status).toBe("active");
  });

  it("keeps an account whose rep signed in within the window", async () => {
    const { linkedin, ctx } = setup({}, RECENT);
    await releaseIdleAccounts(ctx, NOW);
    expect(linkedin.deletedAccounts).toEqual([]);
  });

  it("keeps an account a prospect wrote to within the window", async () => {
    const { db, linkedin, ctx } = setup();
    db.seed("conversations", [{ id: "v1", linkedin_account_id: "a1", last_message_at: RECENT }]);
    await releaseIdleAccounts(ctx, NOW);
    expect(linkedin.deletedAccounts).toEqual([]);
  });

  it("keeps an account that sent within the window, or was connected within it", async () => {
    for (const recent of [{ last_action_at: RECENT }, { connected_at: RECENT }]) {
      const { linkedin, ctx } = setup(recent);
      await releaseIdleAccounts(ctx, NOW);
      expect(linkedin.deletedAccounts).toEqual([]);
    }
  });

  it("keeps an account with a campaign being built", async () => {
    const { db, linkedin, ctx } = setup();
    db.seed("campaigns", [
      { id: "c1", linkedin_account_id: "a1", status: "draft", created_at: OLD, updated_at: RECENT, launched_at: null },
    ]);
    await releaseIdleAccounts(ctx, NOW);
    expect(linkedin.deletedAccounts).toEqual([]);
  });

  it("releases nobody when it cannot read when reps signed in", async () => {
    // Rule 17: a lookup that could not look is not "no activity".
    const { db, linkedin, ctx } = setup();
    db.lastSeenFails = true;
    await expect(releaseIdleAccounts(ctx, NOW)).rejects.toThrow(/signed in/);
    expect(linkedin.deletedAccounts).toEqual([]);
    expect(db.find("linkedin_accounts", { id: "a1" })?.status).toBe("active");
  });

  it("keeps an account whose rep the sign-in lookup did not answer for", async () => {
    const { db, linkedin, ctx } = setup();
    db.tables.set("auth_last_seen", []);
    await releaseIdleAccounts(ctx, NOW);
    expect(linkedin.deletedAccounts).toEqual([]);
  });

  it("leaves the row alone when the provider refuses, and says so", async () => {
    const { db, linkedin, ctx } = setup();
    linkedin.deleteAccount = async () => ({ ok: false, error: "500 upstream" });
    await expect(releaseIdleAccounts(ctx, NOW)).rejects.toThrow(/500 upstream/);
    const row = db.find("linkedin_accounts", { id: "a1" })!;
    expect(row.status).toBe("active");
    expect(row.provider_account_id).toBe("acct-1");
  });

  it("never touches an account that is only waiting for a sign-in or holds nothing", async () => {
    const { db, linkedin, ctx } = setup({ status: "connecting", provider_account_id: null });
    db.seed("linkedin_accounts", [
      { id: "a2", workspace_id: "w1", user_id: "u1", status: "disconnected", provider_account_id: null, connected_at: OLD },
    ]);
    expect((await releaseIdleAccounts(ctx, NOW)).checked).toBe(0);
    expect(linkedin.deletedAccounts).toEqual([]);
  });
});

describe("isIdleForRelease", () => {
  const base = {
    runningCampaigns: 0,
    connectedAt: OLD,
    lastActionAt: OLD,
    lastCampaignTouch: null,
    lastMessageAt: null,
    lastSeenAt: OLD,
  };

  it("needs every signal older than the window", () => {
    expect(isIdleForRelease(base, NOW)).toBe(true);
    expect(isIdleForRelease({ ...base, lastCampaignTouch: RECENT }, NOW)).toBe(false);
    expect(isIdleForRelease({ ...base, runningCampaigns: 1 }, NOW)).toBe(false);
  });

  it("reads an unreadable date as activity, never as idleness", () => {
    expect(isIdleForRelease({ ...base, lastActionAt: "not a date" }, NOW)).toBe(false);
    expect(isIdleForRelease({ ...base, lastSeenAt: undefined }, NOW)).toBe(false);
  });

  it("is told apart from any other disconnection by its detail", () => {
    expect(isIdleReleased({ status: "disconnected", status_detail: IDLE_RELEASE_DETAIL })).toBe(true);
    expect(isIdleReleased({ status: "disconnected", status_detail: "No sign-in happened" })).toBe(false);
  });
});

/*
 * A signed-out account sends nothing and is billed every month all the same.
 * Monic's sat signed out from 30 October, two running campaigns waiting on
 * it, paid for and doing nothing.
 */
describe("releaseSignedOutAccounts", () => {
  const THREE_DAYS_AGO = new Date(NOW.getTime() - 3 * 86_400_000 - 60_000).toISOString();
  const YESTERDAY = new Date(NOW.getTime() - 86_400_000).toISOString();

  it("releases an account left signed out for three days, and keeps its campaigns and people", async () => {
    const { db, linkedin, ctx } = setup({ status: "reauth_required", paused_at: THREE_DAYS_AGO });
    db.seed("campaigns", [{ id: "c1", linkedin_account_id: "a1", status: "running" }]);
    db.seed("campaign_prospects", [{ id: "cp1", campaign_id: "c1", status: "queued" }]);

    const run = await releaseSignedOutAccounts(ctx, NOW);

    expect(run.released).toBe(1);
    expect(linkedin.deletedAccounts).toEqual(["acct-1"]);
    const row = db.find("linkedin_accounts", { id: "a1" })!;
    expect(row).toMatchObject({ status: "disconnected", provider_account_id: null, status_detail: SIGNED_OUT_RELEASE_DETAIL });
    expect(isReleasedByUs(row as { status: string; status_detail: string })).toBe(true);
    expect(db.find("campaigns", { id: "c1" })?.status).toBe("running");
    expect(db.find("campaign_prospects", { id: "cp1" })?.status).toBe("queued");
  });

  it("leaves one signed out only since yesterday, one mid-reconnect, and a working one", async () => {
    for (const account of [
      { status: "reauth_required", paused_at: YESTERDAY },
      { status: "reauth_required", paused_at: THREE_DAYS_AGO, pending_provider_account_id: "acct-new" },
      { status: "active", paused_at: THREE_DAYS_AGO },
    ]) {
      const { db, linkedin, ctx } = setup(account);
      expect((await releaseSignedOutAccounts(ctx, NOW)).released).toBe(0);
      expect(linkedin.deletedAccounts).toEqual([]);
      expect(db.find("linkedin_accounts", { id: "a1" })?.provider_account_id).toBe("acct-1");
    }
  });

  it("leaves the row as it was when the provider refuses", async () => {
    const { db, linkedin, ctx } = setup({ status: "reauth_required", paused_at: THREE_DAYS_AGO });
    linkedin.deleteAccount = async () => ({ ok: false, error: "500" });
    await expect(releaseSignedOutAccounts(ctx, NOW)).rejects.toThrow(/refused/);
    expect(db.find("linkedin_accounts", { id: "a1" })).toMatchObject({ status: "reauth_required", provider_account_id: "acct-1" });
  });
});
