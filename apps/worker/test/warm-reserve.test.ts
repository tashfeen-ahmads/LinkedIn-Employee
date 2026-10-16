import { describe, expect, it } from "vitest";
import { LINKEDIN_LIMITS } from "@le/shared";
import { WARM_MARGIN_MS, warmUpWaitMs } from "../src/warm.js";

const MIN = 60_000;

describe("the wait after a view leaves room for the invitations already waiting (rule 64)", () => {
  it("draws no later than the window less a floor for each person waiting", () => {
    const reserve = 4 * 17 * MIN;
    const longest = warmUpWaitMs(() => 0.9999, Number.POSITIVE_INFINITY, reserve)!;
    expect(longest).toBeLessThanOrEqual(LINKEDIN_LIMITS.warmUpToInviteMaxMs - WARM_MARGIN_MS - reserve);
  });

  it("never draws under the shortest wait, however many are waiting", () => {
    expect(warmUpWaitMs(() => 0.9999, Number.POSITIVE_INFINITY, 100 * 3_600_000)).toBe(
      LINKEDIN_LIMITS.warmUpToInviteMinMs,
    );
  });

  it("draws exactly as before when nobody is waiting", () => {
    expect(warmUpWaitMs(() => 0.5, Number.POSITIVE_INFINITY, 0)).toBe(warmUpWaitMs(() => 0.5));
  });
});
