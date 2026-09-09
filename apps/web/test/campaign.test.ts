import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { CONNECTION_NOTE_MAX, daysToSendAll, launchBlockers, type LaunchState } from "../src/lib/campaign.js";

function state(overrides: Partial<LaunchState> = {}): LaunchState {
  return {
    connectionNote: "Hi {{first_name}}, we work with ops leaders on the same problem.",
    steps: [
      { message: "Worth a look?", delayDays: 2 },
      { message: "Closing the loop.", delayDays: 4 },
    ],
    dailyInviteCap: 20,
    prospectCount: 120,
    accountStatus: "active",
    ...overrides,
  };
}

describe("launchBlockers", () => {
  it("allows a campaign that is ready", () => {
    expect(launchBlockers(state())).toEqual([]);
  });

  it("refuses a campaign with nobody on it", () => {
    expect(launchBlockers(state({ prospectCount: 0 }))).toContain("There is nobody on the list yet.");
  });

  it("refuses an empty connection note", () => {
    expect(launchBlockers(state({ connectionNote: "   " }))).toContain("The connection note is empty.");
  });

  it("refuses a note LinkedIn would truncate", () => {
    const long = "a".repeat(CONNECTION_NOTE_MAX + 1);
    expect(launchBlockers(state({ connectionNote: long })).join(" ")).toContain("LinkedIn allows");
  });

  it("accepts a note of exactly the maximum length", () => {
    expect(launchBlockers(state({ connectionNote: "a".repeat(CONNECTION_NOTE_MAX) }))).toEqual([]);
  });

  it("names which follow-up is blank rather than just refusing", () => {
    const steps = [
      { message: "Worth a look?", delayDays: 2 },
      { message: "  ", delayDays: 4 },
    ];
    expect(launchBlockers(state({ steps }))).toContain("Follow-up 2 has no message.");
  });

  it("refuses to send from an account that is not connected", () => {
    expect(launchBlockers(state({ accountStatus: null }))).toContain(
      "No LinkedIn account is connected to this campaign.",
    );
  });

  it("refuses to send from a restricted account, and says so", () => {
    // The one case where launching would make a bad situation worse.
    expect(launchBlockers(state({ accountStatus: "restricted" })).join(" ")).toContain("restricted");
  });

  it("refuses a daily cap above the safe ceiling", () => {
    const blockers = launchBlockers(state({ dailyInviteCap: LINKEDIN_LIMITS.invitesPerDayMax + 1 }));
    expect(blockers.join(" ")).toContain("above the safe ceiling");
  });

  it("allows a cap below the ceiling, because slower is always permitted", () => {
    expect(launchBlockers(state({ dailyInviteCap: 5 }))).toEqual([]);
  });

  it("refuses a cap of zero", () => {
    expect(launchBlockers(state({ dailyInviteCap: 0 })).join(" ")).toContain("nothing would send");
  });

  it("reports every problem at once, not the first one", () => {
    const blockers = launchBlockers(
      state({ prospectCount: 0, connectionNote: "", accountStatus: null }),
    );
    expect(blockers).toHaveLength(3);
  });
});

describe("daysToSendAll", () => {
  it("rounds up, because a partial day is still a day", () => {
    expect(daysToSendAll(41, 20)).toBe(3);
  });

  it("says nothing rather than dividing by a cap of zero", () => {
    expect(daysToSendAll(100, 0)).toBeNull();
    expect(daysToSendAll(0, 20)).toBeNull();
  });
});
