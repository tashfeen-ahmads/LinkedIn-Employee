import { describe, expect, it } from "vitest";
import { invitationSentAt } from "../src/invitations.js";

/*
 * The provider's pending list often says only "Sent 3 weeks ago". Read as a
 * timestamp that was nothing, so no invitation on any account had an age and
 * none could ever be withdrawn as old.
 */
const NOW = new Date("2026-10-30T12:00:00Z");
const daysAgo = (iso: string | null) => (iso ? Math.round((NOW.getTime() - Date.parse(iso)) / 86_400_000) : null);

describe("invitationSentAt", () => {
  it("reads a timestamp", () => {
    expect(invitationSentAt("2026-10-01T09:00:00Z", NOW)).toBe("2026-10-01T09:00:00.000Z");
  });

  it("reads LinkedIn's own words, as the least time they can mean", () => {
    expect(daysAgo(invitationSentAt("Sent 3 weeks ago", NOW))).toBe(21);
    expect(daysAgo(invitationSentAt("1 month ago", NOW))).toBe(28);
    expect(daysAgo(invitationSentAt("Sent a year ago", NOW))).toBe(365);
    expect(daysAgo(invitationSentAt("Sent 4 days ago", NOW))).toBe(4);
    expect(daysAgo(invitationSentAt("Sent yesterday", NOW))).toBe(1);
    expect(daysAgo(invitationSentAt("Sent today", NOW))).toBe(0);
    expect(daysAgo(invitationSentAt("5 hours ago", NOW))).toBe(0);
  });

  it("never guesses: anything it cannot read has no age", () => {
    expect(invitationSentAt("last spring", NOW)).toBeNull();
    expect(invitationSentAt("", NOW)).toBeNull();
    expect(invitationSentAt(null, NOW)).toBeNull();
    expect(invitationSentAt(42, NOW)).toBeNull();
  });
});
