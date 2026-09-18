import { describe, expect, it } from "vitest";
import {
  assignVariants,
  comparisonReady,
  MIN_SENDS_TO_COMPARE,
  nextVariant,
  standings,
  wilson,
} from "../src/variants.js";

/**
 * Comparing one angle against another without inventing a result.
 *
 * The failure this guards against is not a wrong number, it is a confident
 * one: a rep who kills the better angle because it read 40% against 60% on
 * eleven invitations has lost more than the test could ever have won.
 */

const v = (id: string, sent: number, accepted: number, enabled = true) => ({
  id,
  name: id,
  enabled,
  sent,
  accepted,
  replied: 0,
  meetings: 0,
});

describe("wilson", () => {
  it("does not claim certainty from no evidence", () => {
    // The textbook interval gives ±0 here — a perfect claim from eight
    // failures — which is exactly the reading that gets an angle killed.
    const { low, high } = wilson(0, 8);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0.2);
  });

  it("stays inside nought and one", () => {
    for (const [s, n] of [[0, 1], [1, 1], [0, 3], [3, 3], [1, 2]] as const) {
      const { low, high } = wilson(s, n);
      expect(low, `${s}/${n}`).toBeGreaterThanOrEqual(0);
      expect(high, `${s}/${n}`).toBeLessThanOrEqual(1);
    }
  });

  it("narrows as the evidence grows", () => {
    const thin = wilson(3, 10);
    const thick = wilson(300, 1000);
    expect(thick.high - thick.low).toBeLessThan(thin.high - thin.low);
  });

  it("says nothing at all about an angle nothing has been sent from", () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("standings", () => {
  it("refuses to separate two angles on thin data", () => {
    // 1/4 against 3/4 is the most tempting table on this screen and it is
    // noise. Both lead, which is the honest reading.
    const result = standings([v("a", 4, 1), v("b", 4, 3)]);
    expect(result.every((r) => r.leading)).toBe(true);
  });

  it("separates them once there is enough to separate", () => {
    const result = standings([v("a", 200, 10), v("b", 200, 120)]);
    expect(result.find((r) => r.id === "a")?.leading).toBe(false);
    expect(result.find((r) => r.id === "b")?.leading).toBe(true);
  });

  it("does not let a barely-started variant beat an established one", () => {
    // 5/5 is 100%, and its Wilson interval starts around 57% — comfortably
    // above an established angle running at 30%. Without the sample floor it
    // would knock that angle out on five invitations.
    const result = standings([v("established", 200, 60), v("new", 5, 5)]);
    expect(result.find((r) => r.id === "established")?.leading).toBe(true);
  });

  it("does not separate two angles whose ranges overlap, even past the floor", () => {
    // 5/20 against 8/20 is 25% against 40% — the most persuasive table on this
    // screen, and still two angles this campaign cannot tell apart. Compared as
    // bare rates, the first is "losing" and gets killed.
    const result = standings([v("a", 20, 5), v("b", 20, 8)]);
    expect(result.every((r) => r.leading)).toBe(true);
  });

  it("ignores a disabled variant when deciding who is ahead", () => {
    const result = standings([v("a", 200, 10), v("retired", 200, 120, false)]);
    // A angle nobody is sending any more cannot beat the one that replaced it.
    expect(result.find((r) => r.id === "a")?.leading).toBe(true);
  });

  it("reports no rate rather than zero for an angle never sent", () => {
    // 0% and "not tried" are different facts and the screen must not merge
    // them: one is a bad angle, the other is an untested one.
    expect(standings([v("a", 0, 0)])[0]?.acceptanceRate).toBeNull();
  });
});

describe("comparisonReady", () => {
  it("is false until every live angle has had a fair run", () => {
    expect(comparisonReady([{ sent: 40, accepted: 9, replied: 0, meetings: 0 }, { sent: 3, accepted: 1, replied: 0, meetings: 0 }])).toBe(false);
  });

  it("is false with only one angle in play", () => {
    expect(comparisonReady([{ sent: 400, accepted: 90, replied: 0, meetings: 0 }])).toBe(false);
  });

  it("is true once both have cleared the floor", () => {
    const enough = MIN_SENDS_TO_COMPARE;
    expect(
      comparisonReady([
        { sent: enough, accepted: 5, replied: 0, meetings: 0 },
        { sent: enough, accepted: 7, replied: 0, meetings: 0 },
      ]),
    ).toBe(true);
  });
});

describe("assignment", () => {
  it("splits a batch evenly rather than randomly", () => {
    // Random assignment of fifty across two angles lands 32/18 often enough to
    // matter, and the gap it invents is then read as a result.
    const assigned = assignVariants([{ id: "a" }, { id: "b" }], 50);
    const a = assigned.filter((x) => x?.id === "a").length;
    expect(a).toBe(25);
  });

  it("continues the rotation instead of restarting it", () => {
    // What makes "Find more" sound: a second batch must not hand the first
    // angle another even split on top of the one it already has.
    const assigned = assignVariants([{ id: "a" }, { id: "b" }], 4, new Map([["a", 10]]));
    expect(assigned.every((x) => x?.id === "b")).toBe(true);
  });

  it("keeps the declared order on a tie, so the same list assigns the same way", () => {
    expect(nextVariant([{ id: "a" }, { id: "b" }], new Map())?.id).toBe("a");
  });

  it("assigns nobody when a campaign has no variants", () => {
    // The campaign's own note is used, exactly as before variants existed.
    expect(assignVariants([], 3)).toEqual([null, null, null]);
  });
});
