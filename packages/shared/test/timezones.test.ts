import { describe, expect, it } from "vitest";
import { COMMON_TIMEZONES, describeWorkingHours, isValidTimezone } from "../src/timezones.js";

/**
 * The setting that had this deployment inviting New Yorkers at 4am.
 *
 * `profiles.timezone` was a free-text box and read `UTC` on every account, so
 * a window saved as "8 to 18" was 04:00–14:00 Eastern. Nothing on any screen
 * said so, and the account was throttled by LinkedIn inside three days.
 */
describe("timezones", () => {
  it("offers zones this runtime can actually evaluate", () => {
    for (const zone of COMMON_TIMEZONES) {
      expect(isValidTimezone(zone.id), `${zone.id} is not usable here`).toBe(true);
    }
  });

  it("rejects what a person types into a free-text box", () => {
    // Each of these fell back to UTC in silence.
    for (const typed of ["Eastern", "GMT+5", "PKT", "Mars/Olympus", "", "   ", null, undefined]) {
      expect(isValidTimezone(typed), `${typed} was accepted`).toBe(false);
    }
  });

  it("offers no fixed-offset zone, which is wrong for half the year", () => {
    /*
     * The subtler half of the free-text problem. "EST" and "MST" are real
     * identifiers this runtime accepts — and they are fixed offsets that do not
     * observe daylight saving, so an account set to EST sends an hour early
     * from March to November while every screen reads back exactly what was
     * typed. A rep who types the abbreviation they say out loud gets a window
     * that is quietly wrong for eight months.
     *
     * So they stay valid (the limiter can evaluate them, and an account already
     * on one must not be silently moved) and they are never offered.
     */
    expect(isValidTimezone("EST")).toBe(true);
    const offered = COMMON_TIMEZONES.map((z) => z.id);
    for (const fixed of ["EST", "MST", "HST", "EST5EDT", "US/Eastern"]) {
      expect(offered, `${fixed} is offered`).not.toContain(fixed);
    }
    // Every zone offered is a region/city identifier, which is what carries DST.
    for (const zone of COMMON_TIMEZONES) {
      if (zone.id === "UTC") continue;
      expect(zone.id, `${zone.id} is not a region zone`).toMatch(/^[A-Za-z_]+\/[A-Za-z_+-]+$/);
    }
  });

  it("says what a window means, including the zone", () => {
    const said = describeWorkingHours(
      { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
      "America/New_York",
      new Date("2026-09-28T18:00:00Z"), // 14:00 in New York
    );
    expect(said).toContain("08:00–18:00");
    expect(said).toContain("Mon–Fri");
    expect(said).toContain("America/New_York");
    expect(said).toContain("14:00");
  });

  it("collapses a run of days rather than listing five", () => {
    expect(describeWorkingHours({ start: 9, end: 17, days: [1, 2, 3, 4, 5] }, "UTC")).toContain("Mon–Fri");
    expect(describeWorkingHours({ start: 9, end: 17, days: [1, 3, 5] }, "UTC")).toContain("Mon, Wed, Fri");
    // Saturday and Sunday are consecutive in a Mon-first week, so they collapse
    // exactly as Mon-Fri does.
    expect(describeWorkingHours({ start: 9, end: 17, days: [6, 0] }, "UTC")).toContain("Sat–Sun");
    expect(describeWorkingHours({ start: 9, end: 17, days: [1, 0] }, "UTC")).toContain("Mon, Sun");
  });

  it("never presents an unreadable zone as if it were being applied", () => {
    // Falling back to UTC is what the code does; saying nothing about it is
    // what made this invisible for a fortnight.
    const said = describeWorkingHours({ start: 8, end: 18, days: [1] }, "Eastern");
    expect(said).toContain("not one this can read");
    expect(said).toContain("UTC is used");
  });
});
