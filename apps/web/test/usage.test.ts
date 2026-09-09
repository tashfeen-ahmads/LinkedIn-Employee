import { describe, expect, it } from "vitest";
import { costPerMeeting, groupBy, median, type UsageRow } from "../src/lib/usage.js";

function row(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    agent: "reply.draft",
    model: "claude-opus-5",
    prompt_version: "reply.draft.v1",
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 900,
    latency_ms: 1200,
    cost_usd: 0.005,
    error: null,
    created_at: "2026-09-09T09:00:00Z",
    ...overrides,
  };
}

describe("groupBy", () => {
  it("totals cost, tokens and failures per group", () => {
    const groups = groupBy([row(), row(), row({ error: "overloaded", cost_usd: 0 })], (r) => r.agent);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.calls).toBe(3);
    expect(groups[0]!.failed).toBe(1);
    expect(groups[0]!.costUsd).toBeCloseTo(0.01);
  });

  it("refuses to total a group containing a call it cannot price", () => {
    // A partly-guessed total shown as a number is worse than no number.
    const groups = groupBy([row(), row({ cost_usd: null })], (r) => r.agent);
    expect(groups[0]!.costUsd).toBeNull();
  });

  it("reports the cache hit rate, which is why the prompt is split at all", () => {
    const groups = groupBy([row({ input_tokens: 100, cache_read_tokens: 900 })], (r) => r.agent);
    expect(groups[0]!.cacheHitRate).toBeCloseTo(0.9);
  });

  it("separates the agents rather than reporting one blended number", () => {
    const groups = groupBy([row({ agent: "reply.draft" }), row({ agent: "reply.classify" })], (r) => r.agent);
    expect(groups.map((g) => g.key).sort()).toEqual(["reply.classify", "reply.draft"]);
  });

  it("puts the most expensive group first, because that is the one to look at", () => {
    const groups = groupBy(
      [row({ agent: "cheap", cost_usd: 0.001 }), row({ agent: "dear", cost_usd: 5 })],
      (r) => r.agent,
    );
    expect(groups[0]!.key).toBe("dear");
  });

  it("survives a row whose token counts were never recorded", () => {
    const groups = groupBy([row({ input_tokens: null, output_tokens: null, cache_read_tokens: null })], (r) => r.agent);
    expect(groups[0]!.inputTokens).toBe(0);
    expect(groups[0]!.cacheHitRate).toBeNull();
  });
});

describe("median", () => {
  it("ignores one slow retry rather than letting it describe every call", () => {
    expect(median([100, 120, 140, 40_000])).toBe(130);
  });

  it("has no answer for no calls", () => {
    expect(median([])).toBeNull();
  });
});

describe("costPerMeeting", () => {
  it("divides spend by meetings booked", () => {
    expect(costPerMeeting(12, 4)).toBe(3);
  });

  it("has no answer before the first meeting", () => {
    // Not an enormous cost — not yet a number.
    expect(costPerMeeting(12, 0)).toBeNull();
  });

  it("has no answer when the spend itself is unknown", () => {
    expect(costPerMeeting(null, 4)).toBeNull();
  });
});
