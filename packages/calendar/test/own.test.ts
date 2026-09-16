import { describe, expect, it } from "vitest";
import { OwnCalendarProvider, buildIcs, findFreeSlots } from "../src/index.js";

/**
 * The calendar this product owns.
 *
 * It exists because Google will not grant calendar scopes to an unverified app,
 * and verification needs a verified domain and a review measured in weeks — so
 * the final stage of the product could not be shown at all on a test
 * deployment. What it gives up is the one thing an external calendar is for: it
 * cannot see a meeting booked elsewhere. That makes the blackout list the whole
 * defence against double-booking, and these tests exist because the cost of
 * getting it wrong is a real person sitting in an empty call.
 */

const MEETING = { start: "2026-10-05T14:00:00.000Z", end: "2026-10-05T14:30:00.000Z" };

describe("OwnCalendarProvider", () => {
  it("reports both booked meetings and declared blackouts as busy", async () => {
    // Two sources, one answer. A blackout that only appeared in a settings page
    // and never in getBusy would be a promise the calendar quietly broke.
    const provider = new OwnCalendarProvider({
      meetings: [MEETING],
      blackouts: [{ start: "2026-10-06T09:00:00.000Z", end: "2026-10-06T17:00:00.000Z" }],
    });

    const busy = await provider.getBusy({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z" });

    expect(busy).toHaveLength(2);
  });

  it("keeps a blackout that starts before the window and ends inside it", async () => {
    // A week off that began on Friday still blocks Monday. Filtering for
    // intervals contained by the window drops it and offers the time anyway,
    // which is the exact shape of a double booking.
    const provider = new OwnCalendarProvider({
      meetings: [],
      blackouts: [{ start: "2026-10-01T00:00:00.000Z", end: "2026-10-08T00:00:00.000Z" }],
    });

    const busy = await provider.getBusy({ from: "2026-10-05T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" });

    expect(busy).toHaveLength(1);
  });

  it("drops an interval it cannot parse rather than treating it as free", async () => {
    const provider = new OwnCalendarProvider({
      meetings: [{ start: "not a date", end: "also not" }],
      blackouts: [],
    });

    expect(await provider.getBusy({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z" })).toEqual([]);
  });

  it("never offers a slot that collides with something it knows about", async () => {
    // The end-to-end property, stated against the real slot finder: what
    // getBusy reports is what findFreeSlots refuses to offer.
    const provider = new OwnCalendarProvider({ meetings: [MEETING], blackouts: [] });
    const from = new Date("2026-10-05T00:00:00.000Z");
    const to = new Date("2026-10-06T00:00:00.000Z");

    const slots = findFreeSlots({
      from,
      to,
      durationMinutes: 30,
      workingHours: { start: 0, end: 24, days: [0, 1, 2, 3, 4, 5, 6] },
      timezone: "UTC",
      busy: await provider.getBusy({ from: from.toISOString(), to: to.toISOString() }),
      minNoticeHours: 0,
      bufferMinutes: 0,
      maxSlots: 50,
    });

    expect(slots).not.toContain(MEETING.start);
  });
});

describe("buildIcs", () => {
  const event = {
    uid: "meeting-1@linkedin-employee",
    startsAt: "2026-10-05T14:00:00.000Z",
    endsAt: "2026-10-05T14:30:00.000Z",
    summary: "Jane Doe (Acme, Inc) · intro call",
    organizer: { name: "Sam Patel", email: "sam@acme.test" },
    attendees: [{ name: "Jane Doe", email: "jane@example.test" }],
  };

  it("writes an invitation a mail client will accept", () => {
    const ics = buildIcs(event);

    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("DTSTART:20261005T140000Z");
    expect(ics).toContain("DTEND:20261005T143000Z");
    expect(ics).toContain("ORGANIZER;CN=\"Sam Patel\":mailto:sam@acme.test");
    expect(ics).toContain("mailto:jane@example.test");
    // CRLF is required by RFC 5545 and Outlook rejects a file without it.
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("escapes a comma, so a company with one does not truncate the summary", () => {
    // "Acme, Inc" ends the property value at the comma otherwise, and the
    // prospect gets an invitation to a meeting called "Jane Doe (Acme".
    expect(buildIcs(event)).toContain("SUMMARY:Jane Doe (Acme\\, Inc) · intro call");
  });

  it("escapes newlines in the description rather than breaking the file", () => {
    const ics = buildIcs({ ...event, description: "line one\nline two" });

    expect(ics).toContain("DESCRIPTION:line one\\nline two");
    // A literal newline would end the property and make the rest of the file
    // unparseable, which mail clients respond to by showing nothing at all.
    expect(ics).not.toContain("DESCRIPTION:line one\nline two");
  });

  it("refuses a datetime it cannot parse instead of writing a broken invitation", () => {
    expect(() => buildIcs({ ...event, startsAt: "next tuesday" })).toThrow(/not a datetime/);
  });

  it("marks a cancellation so the meeting leaves the other side's diary", () => {
    const ics = buildIcs({ ...event, cancelled: true, sequence: 1 });

    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:1");
  });
});
