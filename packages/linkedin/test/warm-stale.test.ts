import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { warmStillCounts } from "../src/rate-limit.js";

/**
 * The other half of `invitationCouldFollow`.
 *
 * That guard stops a view being spent when no invitation could follow it. It
 * was added after eight real people were viewed on a Friday afternoon against a
 * hold that ran into the following week — but it did nothing for those eight,
 * who kept a `warmed_at` from the Friday. The invite path asked only whether
 * the column was set, never how old it was, so three days later they were
 * first in line for a "warm" invitation on a view whose value had gone.
 */
const WINDOW = LINKEDIN_LIMITS.warmUpToInviteMaxMs;
const now = new Date("2026-09-28T13:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("warmStillCounts", () => {
  it("counts a view inside the window", () => {
    expect(warmStillCounts(ago(0), now)).toBe(true);
    expect(warmStillCounts(ago(60 * 60_000), now)).toBe(true);
    expect(warmStillCounts(ago(WINDOW - 60_000), now)).toBe(true);
  });

  it("stops counting the moment the window closes", () => {
    expect(warmStillCounts(ago(WINDOW), now)).toBe(true);
    expect(warmStillCounts(ago(WINDOW + 1000), now)).toBe(false);
  });

  it("does not count the three-day-old views this deployment is holding", () => {
    // The real stamps: warmed 2026-09-25 14:43, still queued on the 28th.
    expect(warmStillCounts("2026-09-25T14:43:25.961Z", now)).toBe(false);
    expect(warmStillCounts("2026-09-25T14:45:29.733Z", now)).toBe(false);
  });

  it("treats no view, and a view it cannot read, as no warm-up", () => {
    // A corrupt stamp read as a warm-up invites somebody cold on the strength
    // of a broken column, which is worse than re-spending one view.
    for (const bad of [null, undefined, "", "not a date", "0000-13-45"]) {
      expect(warmStillCounts(bad, now), `${bad} counted as warm`).toBe(false);
    }
  });

  it("takes a Date as readily as the string the database returns", () => {
    expect(warmStillCounts(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(warmStillCounts(new Date(now.getTime() - WINDOW - 60_000), now)).toBe(false);
  });
});
