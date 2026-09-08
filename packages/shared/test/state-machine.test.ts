import { describe, expect, it } from "vitest";
import { CAMPAIGN_TRANSITIONS, canTransition } from "../src/schemas.js";

describe("campaign state machine", () => {
  it("allows the happy path from queued to a booked meeting", () => {
    const path = ["queued", "invited", "accepted", "messaged_1", "replied", "positive", "meeting_booked"] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  it("never re-opens a terminal state", () => {
    for (const terminal of ["closed", "opted_out"] as const) {
      expect(CAMPAIGN_TRANSITIONS[terminal]).toHaveLength(0);
    }
  });

  it("refuses to skip the invitation", () => {
    expect(canTransition("queued", "messaged_1")).toBe(false);
    expect(canTransition("invited", "messaged_1")).toBe(false);
  });

  it("lets an opted-out prospect out of every non-terminal state that can reach it", () => {
    expect(canTransition("replied", "opted_out")).toBe(true);
    expect(canTransition("positive", "opted_out")).toBe(true);
  });
});
