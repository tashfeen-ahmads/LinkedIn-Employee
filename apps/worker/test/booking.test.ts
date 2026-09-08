import { describe, expect, it } from "vitest";
import { matchOfferedSlot } from "../src/jobs/booking.js";

// Tuesday 14:00, Wednesday 10:00, Friday 16:00 — all UTC.
const OFFERED = ["2026-09-08T14:00:00Z", "2026-09-09T10:00:00Z", "2026-09-11T16:00:00Z"];

describe("matchOfferedSlot", () => {
  it("matches an ordinal reference", () => {
    expect(matchOfferedSlot("The second one works for me", OFFERED, "UTC")).toBe(OFFERED[1]);
    expect(matchOfferedSlot("let's do option 3", OFFERED, "UTC")).toBe(OFFERED[2]);
  });

  it("matches a weekday", () => {
    expect(matchOfferedSlot("Wednesday works, thanks", OFFERED, "UTC")).toBe(OFFERED[1]);
  });

  it("matches a weekday with an explicit time", () => {
    expect(matchOfferedSlot("Friday at 4pm sounds good", OFFERED, "UTC")).toBe(OFFERED[2]);
  });

  it("refuses to book when the acceptance is ambiguous", () => {
    expect(matchOfferedSlot("The first or the second both work", OFFERED, "UTC")).toBeNull();
  });

  it("refuses a time we never offered", () => {
    expect(matchOfferedSlot("Can we do Monday at 9am instead?", OFFERED, "UTC")).toBeNull();
  });

  it("refuses a weekday mention that is not an acceptance", () => {
    expect(matchOfferedSlot("I am travelling all Wednesday", OFFERED, "UTC")).toBeNull();
  });

  it("refuses when a stated hour does not match the offered slot", () => {
    expect(matchOfferedSlot("Wednesday at 3pm works", OFFERED, "UTC")).toBeNull();
  });

  it("books nothing when no slots were offered", () => {
    expect(matchOfferedSlot("Yes, that works", [], "UTC")).toBeNull();
  });

  it("reads the day in the rep's time zone, not UTC", () => {
    // 2026-09-08T02:00Z is still Monday evening in Los Angeles.
    const lateSlots = ["2026-09-08T02:00:00Z"];
    expect(matchOfferedSlot("Monday works", lateSlots, "America/Los_Angeles")).toBe(lateSlots[0]);
    expect(matchOfferedSlot("Monday works", lateSlots, "UTC")).toBeNull();
  });
});
