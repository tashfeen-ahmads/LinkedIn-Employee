import { describe, expect, it } from "vitest";
import { MODELS } from "../src/constants.js";
import { MODEL_PRICING, cacheHitRate, estimateCostUsd, formatUsd } from "../src/pricing.js";

describe("MODEL_PRICING", () => {
  it("prices every model the product actually calls", () => {
    // A model used but unpriced reports its spend as unknown forever.
    for (const roles of Object.values(MODELS)) {
      for (const model of Object.values(roles)) {
        expect(MODEL_PRICING[model], model).toBeDefined();
      }
    }
  });

  it("prices a cache read below a fresh input token, or caching is pointless", () => {
    for (const [model, price] of Object.entries(MODEL_PRICING)) {
      expect(price.cacheRead, model).toBeLessThan(price.input);
    }
  });
});

describe("estimateCostUsd", () => {
  it("adds input, output and cache reads at their own rates", () => {
    const cost = estimateCostUsd({
      model: "claude-haiku-4-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1 + 5 + 0.1);
  });

  it("says it does not know rather than saying zero", () => {
    // Zero for an unpriced model is how a spend report stays reassuring while
    // the bill grows.
    const cost = estimateCostUsd({
      model: "some-model-we-added-and-forgot",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
    });
    expect(cost).toBeNull();
  });

  it("costs nothing for a call that used nothing", () => {
    expect(estimateCostUsd({ model: "claude-opus-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })).toBe(0);
  });
});

describe("formatUsd", () => {
  it("never displays a real cost as zero", () => {
    // One classification costs a fraction of a cent; two decimal places would
    // read as free.
    expect(formatUsd(0.00042)).not.toBe("$0.00");
    expect(Number(formatUsd(0.00042).slice(1))).toBeGreaterThan(0);
  });

  it("shows ordinary amounts to the penny", () => {
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(1)).toBe("$1.00");
  });

  it("distinguishes free from unknown", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(null)).toBe("unpriced");
  });
});

describe("cacheHitRate", () => {
  it("is the share of input that came from cache", () => {
    expect(cacheHitRate(200, 800)).toBeCloseTo(0.8);
  });

  it("withholds a rate when nothing was read at all", () => {
    expect(cacheHitRate(0, 0)).toBeNull();
  });
});
