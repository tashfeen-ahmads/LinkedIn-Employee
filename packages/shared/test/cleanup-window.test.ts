import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "../src/constants.js";
import { cleanupWindow } from "../src/time.js";

describe("cleanupWindow", () => {
  /*
   * Withdrawals never share the account's sending hours, and never run
   * overnight: the evening after a sending day, and the whole of a day off.
   */
  const hours = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };
  const tz = "America/New_York";
  const at = (iso: string) => cleanupWindow(new Date(iso), hours, tz, LINKEDIN_LIMITS);

  it("is closed while the account sends and overnight", () => {
    expect(at("2026-10-30T15:00:00Z")).toBeNull(); // Friday 11am New York
    expect(at("2026-10-30T21:00:00Z")).toBeNull(); // Friday 5:00pm, the last sending minute
    expect(at("2026-10-31T04:00:00Z")).toBeNull(); // Saturday midnight
    expect(at("2026-10-31T11:00:00Z")).toBeNull(); // Saturday 7am
  });

  it("opens the evening after a sending day, gently", () => {
    expect(at("2026-10-30T22:00:00Z")).toMatchObject({ kind: "evening", perDay: LINKEDIN_LIMITS.withdrawPerDayEvening });
  });

  it("opens all of a day off, with more room", () => {
    expect(at("2026-10-31T14:00:00Z")).toMatchObject({ kind: "day_off", perDay: LINKEDIN_LIMITS.withdrawPerDayDayOff });
    expect(at("2026-11-01T18:00:00Z")).toMatchObject({ kind: "day_off" }); // Sunday 1pm
  });
});
