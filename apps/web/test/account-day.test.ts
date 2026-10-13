import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AccountRecord } from "@le/linkedin";
import { countersForToday } from "../src/lib/account-day";
import { describePacing } from "../src/lib/pacing";

/**
 * Yesterday's count is not today's.
 *
 * The worker zeroes an account's daily counters on its first action of the
 * rep's day. Until then the row holds yesterday's numbers, and every screen
 * that read it as it stood opened each morning on "allowance used up" about an
 * account that was about to send at full allowance.
 */

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: "a1",
    workspace_id: "w1",
    user_id: "u1",
    provider_account_id: "acct",
    status: "active",
    connected_at: "2026-09-01T09:00:00Z",
    first_action_at: "2026-09-10T09:00:00Z",
    invites_today: 12,
    invites_this_week: 40,
    messages_today: 9,
    profile_views_today: 20,
    counters_reset_on: "2026-09-16",
    last_action_at: "2026-09-16T17:00:00Z",
    working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
    ...overrides,
  };
}

// Thursday 17 September, 10:00 in New York.
const NOW = new Date("2026-09-17T14:00:00Z");

describe("countersForToday", () => {
  it("zeroes yesterday's daily counters and keeps the week inside the same week", () => {
    const row = countersForToday(account(), "America/New_York", NOW);
    expect(row.invites_today).toBe(0);
    expect(row.messages_today).toBe(0);
    expect(row.profile_views_today).toBe(0);
    expect(row.invites_this_week).toBe(40);
  });

  it("lets the week go only once it is a full rolling week old", () => {
    // LinkedIn's week is the last seven days, not the calendar's
    // (docs/06-research.md section 2). Friday the 11th is still inside the
    // seven days ending Thursday the 17th; Thursday the 10th is not.
    expect(countersForToday(account({ counters_reset_on: "2026-09-11" }), "America/New_York", NOW).invites_this_week).toBe(40);
    expect(countersForToday(account({ counters_reset_on: "2026-09-10" }), "America/New_York", NOW).invites_this_week).toBe(0);
  });

  it("reads the week from the per-day record when the row has one", () => {
    const row = countersForToday(
      account({
        invites_this_week: 40,
        invites_by_day: { "2026-09-09": 15, "2026-09-11": 10, "2026-09-16": 15 },
      }),
      "America/New_York",
      NOW,
    );
    // The 9th has left the window; the 11th and the 16th have not.
    expect(row.invites_this_week).toBe(25);
  });

  it("leaves a row already stamped with the rep's today alone", () => {
    const row = countersForToday(account({ counters_reset_on: "2026-09-17" }), "America/New_York", NOW);
    expect(row.invites_today).toBe(12);
  });

  it("uses the rep's date, not the server's", () => {
    // 02:00 UTC on the 17th is still the 16th in New York.
    const early = new Date("2026-09-17T02:00:00Z");
    const row = countersForToday(account(), "America/New_York", early);
    expect(row.invites_today).toBe(12);
  });

  it("only ever rolls forwards", () => {
    const row = countersForToday(account({ counters_reset_on: "2026-09-18" }), "America/New_York", NOW);
    expect(row.invites_today).toBe(12);
  });
});

describe("the morning screens read today's counters", () => {
  it("does not tell the campaign page the allowance is spent on yesterday's count", () => {
    const state = describePacing({
      status: "running",
      queued: 5,
      // Yesterday ended at the cap; today has not sent anything yet.
      account: account({ invites_today: 30 }),
      timezone: "America/New_York",
      lastBeatAt: "2026-09-17T13:58:00Z",
      now: NOW,
    });
    expect(state?.title).not.toMatch(/used up/);
  });

  it("is what the overview meter and the daily report read too", () => {
    const limits = readFileSync(join(__dirname, "../src/app/app/limits-section.tsx"), "utf8");
    const report = readFileSync(join(__dirname, "../src/lib/daily-report.ts"), "utf8");
    expect(limits).toMatch(/toUsage\(countersForToday\(/);
    expect(report).toMatch(/countersForToday\(account/);
  });
});
