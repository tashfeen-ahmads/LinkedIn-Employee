import { describe, expect, it } from "vitest";
import { checkAction, invitesInLastWeek, rollCounters, toUsage, type AccountRecord } from "../src/index.js";

/*
 * LinkedIn's weekly invitation limit is a rolling seven days
 * (docs/06-research.md section 2), and this is the one reading of it the loop,
 * the send path and every screen share. The calendar Monday used to zero it,
 * which let a campaign launched on a Wednesday send 170 inside seven days.
 */

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: "a",
    workspace_id: "w",
    user_id: "u",
    provider_account_id: "p",
    status: "active",
    connected_at: "2026-06-01T09:00:00Z",
    first_action_at: "2026-06-01T09:00:00Z",
    invites_today: 0,
    invites_this_week: 0,
    messages_today: 0,
    counters_reset_on: "2026-10-12",
    last_action_at: null,
    working_hours: { start: 0, end: 24, days: [0, 1, 2, 3, 4, 5, 6] },
    ...overrides,
  };
}

describe("invitesInLastWeek", () => {
  it("sums the seven days ending today and nothing older", () => {
    const row = account({ invites_by_day: { "2026-10-05": 50, "2026-10-06": 20, "2026-10-12": 3 } });
    // The 5th is seven days before the 12th: outside. The 6th is inside.
    expect(invitesInLastWeek(row, "2026-10-12")).toBe(23);
  });

  it("never reads less than the stored total on the stamped day", () => {
    const row = account({ invites_this_week: 30, invites_by_day: { "2026-10-12": 3 } });
    expect(invitesInLastWeek(row, "2026-10-12")).toBe(30);
  });

  it("does not reset on a Monday", () => {
    // Friday's hundred, read on the following Monday.
    const row = account({ invites_this_week: 100, counters_reset_on: "2026-10-09" });
    const monday = rollCounters(row, "2026-10-12");
    expect(monday.invites_this_week).toBe(100);
    expect(checkAction("invite", toUsage(monday, "UTC"), new Date("2026-10-12T10:00:00Z")).allowed).toBe(false);
  });

  it("lets a total go once its last day is a full week old", () => {
    const row = account({ invites_this_week: 100, counters_reset_on: "2026-10-05" });
    expect(rollCounters(row, "2026-10-12").invites_this_week).toBe(0);
  });

  it("rolls only forwards", () => {
    const row = account({ invites_today: 9, counters_reset_on: "2026-10-13" });
    expect(rollCounters(row, "2026-10-12")).toBe(row);
  });
});
