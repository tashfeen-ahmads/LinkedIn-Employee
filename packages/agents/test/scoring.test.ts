import { describe, expect, it } from "vitest";
import type { IntentSignal } from "@le/shared";
import { dedupeCandidates, intentScore, normalizeLinkedInUrl, rankScore } from "../src/scoring.js";

const now = new Date("2026-09-08T12:00:00Z");

function signal(overrides: Partial<IntentSignal> = {}): IntentSignal {
  return { type: "new_role", detail: "Started 3 weeks ago", observedAt: now.toISOString(), weight: 1, ...overrides };
}

describe("intentScore", () => {
  it("scores zero when nothing is known", () => {
    expect(intentScore([], now).score).toBe(0);
  });

  it("accumulates signals and caps at 100", () => {
    const many = [
      signal({ type: "new_role" }),
      signal({ type: "engaged_with_content" }),
      signal({ type: "viewed_profile" }),
      signal({ type: "recent_funding" }),
      signal({ type: "company_hiring" }),
    ];
    expect(intentScore(many, now).score).toBe(100);
  });

  it("decays an old signal towards nothing", () => {
    const fresh = intentScore([signal()], now).score;
    const stale = intentScore([signal({ observedAt: "2026-06-01T00:00:00Z" })], now).score;
    expect(stale).toBeLessThan(fresh);
    expect(stale).toBe(0);
  });

  it("returns the contributing signals strongest first, for the lead card", () => {
    const { contributing } = intentScore(
      [signal({ type: "posted_recently" }), signal({ type: "new_role" })],
      now,
    );
    expect(contributing[0]?.type).toBe("new_role");
  });
});

describe("rankScore", () => {
  it("weights fit above intent", () => {
    expect(rankScore(90, 0)).toBeGreaterThan(rankScore(40, 100));
  });
});

describe("normalizeLinkedInUrl", () => {
  it("treats the same person written five ways as one key", () => {
    const variants = [
      "https://www.linkedin.com/in/jane-doe/",
      "http://linkedin.com/in/jane-doe",
      "https://uk.linkedin.com/in/jane-doe",
      "LinkedIn.com/in/Jane-Doe?originalSubdomain=uk",
      "  https://www.linkedin.com/in/jane-doe  ",
    ];
    const keys = new Set(variants.map(normalizeLinkedInUrl));
    expect(keys.size).toBe(1);
  });
});

describe("dedupeCandidates", () => {
  it("keeps the first occurrence of a duplicated profile", () => {
    const base = { providerId: "a", firstName: "Jane", lastName: "Doe", signals: [] };
    const result = dedupeCandidates([
      { ...base, linkedinUrl: "https://www.linkedin.com/in/jane-doe" },
      { ...base, providerId: "b", linkedinUrl: "https://linkedin.com/in/jane-doe/" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.providerId).toBe("a");
  });
});

describe("runStrategyAgent input guard", () => {
  it("refuses to run with nothing to work from", async () => {
    const { runStrategyAgent } = await import("../src/strategy.js");

    // Inventing an ICP from nothing would produce confident nonsense that a
    // customer then sends to real people. Better to fail loudly at signup.
    await expect(
      runStrategyAgent({ client: {} as never }, { workspaceId: "w" } as never),
    ).rejects.toThrow(/website|linkedin|description/i);
  });

  it("accepts a description alone", async () => {
    const { runStrategyAgent } = await import("../src/strategy.js");
    let called = false;
    const ctx = {
      client: {
        messages: {
          parse: async () => {
            called = true;
            throw new Error("stop here — the guard let it through, which is the point");
          },
        },
      },
    } as never;

    await expect(runStrategyAgent(ctx, { description: "We sell revenue tooling." })).rejects.toThrow(
      /stop here/,
    );
    expect(called).toBe(true);
  });
});
