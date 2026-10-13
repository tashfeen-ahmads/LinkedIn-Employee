import { describe, expect, it } from "vitest";
import { checkAction, toUsage } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { recordAction, resetCountersIfNeeded, type AccountRecord } from "../src/accounts.js";

/*
 * LinkedIn's weekly invitation limit is a rolling seven days
 * (docs/06-research.md section 2). The counter was zeroed on the calendar
 * Monday, so a campaign launched on a Wednesday sent a hundred Wednesday to
 * Friday and another hundred Monday to Wednesday — a hundred and seventy
 * inside seven consecutive days.
 */

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct-1",
    workspace_id: "w",
    user_id: "u",
    provider_account_id: "p",
    status: "active",
    connected_at: "2026-06-01T09:00:00Z",
    first_action_at: "2026-06-01T09:00:00Z",
    invites_today: 30,
    invites_this_week: 100, // 35 Wed + 35 Thu + 30 Fri
    messages_today: 0,
    profile_views_today: 0,
    counters_reset_on: "2026-10-09", // Friday
    last_action_at: "2026-10-09T16:00:00Z",
    working_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
    ...overrides,
  };
}

async function onMonday(seed: Record<string, unknown>) {
  const db = new FakeDb();
  db.seed("linkedin_accounts", [seed]);
  const account = await resetCountersIfNeeded(db.asDb(), { ...seed } as unknown as AccountRecord, "2026-10-12");
  return { db, account, decision: checkAction("invite", toUsage(account, "UTC"), new Date("2026-10-12T09:30:00Z")) };
}

describe("the weekly invitation ceiling", () => {
  it("still holds on Monday after a hundred invitations Wednesday to Friday", async () => {
    const { decision } = await onMonday(row());
    expect(decision.allowed).toBe(false);
  });

  it("reads the week from the per-day record, not the calendar", async () => {
    const { db, account, decision } = await onMonday(
      row({ invites_by_day: { "2026-10-07": 35, "2026-10-08": 35, "2026-10-09": 30 } }),
    );
    expect(decision.allowed).toBe(false);
    expect(account.invites_this_week).toBe(100);
    // Written back, so a screen reading the column reads the same week.
    expect(db.find("linkedin_accounts", { id: "acct-1" })?.invites_this_week).toBe(100);
  });

  it("lets a day go once it is seven days old", async () => {
    // Monday the 12th: the 5th has left the window, the 6th has not.
    const { account, decision } = await onMonday(
      row({ invites_this_week: 100, invites_by_day: { "2026-10-05": 60, "2026-10-06": 40 } }),
    );
    expect(account.invites_this_week).toBe(40);
    expect(decision.allowed).toBe(true);
  });

  it("is counted per day in the same statement as the totals", async () => {
    const db = new FakeDb();
    db.seed("linkedin_accounts", [row({ invites_by_day: { "2026-10-09": 30 } })]);
    await Promise.all([recordAction(db.asDb(), "acct-1", "invite"), recordAction(db.asDb(), "acct-1", "invite")]);
    expect(db.find("linkedin_accounts", { id: "acct-1" })?.invites_by_day).toEqual({ "2026-10-09": 32 });
  });
});
