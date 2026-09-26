import { describe, expect, it, vi } from "vitest";
import { RECALL_THRESHOLD, report, type Result } from "../evals/run-classification.js";
import type { ClassificationCase } from "../evals/classification-cases.js";

/**
 * Does the eval score correctly?
 *
 * The classification eval had never been run once — `CLAUDE.md` says so — which
 * means the harness had never been exercised either. A first run that makes
 * thirty-three paid model calls and then reports a wrong number is worse than
 * no run at all, because the number gets written down and believed.
 *
 * None of this spends anything: the arithmetic is fed synthetic results.
 */

function testCase(id: string, needsHuman: boolean): ClassificationCase {
  return {
    id,
    message: "m",
    note: "n",
    expect: { needsHuman, intent: "question" },
  } as ClassificationCase;
}

function result(id: string, expected: boolean, actual: boolean, over: Partial<Result> = {}): Result {
  return {
    testCase: testCase(id, expected),
    needsHuman: actual,
    intent: "question",
    optOut: false,
    confidence: 0.9,
    ...over,
  };
}

/** Runs `report` with the console quiet and the exit code isolated. */
function score(results: Result[]): { recall: number; failed: boolean } {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const before = process.exitCode;
  process.exitCode = 0;
  try {
    const recall = report(results);
    return { recall, failed: process.exitCode === 1 };
  } finally {
    process.exitCode = before;
    log.mockRestore();
  }
}

describe("the eval's own arithmetic", () => {
  it("measures recall over the cases a human must handle, not over everything", () => {
    /*
     * The headline number. Nineteen of twenty escalations caught is 95%, and
     * it must not be diluted by the automatable cases sitting beside them — a
     * run with ninety easy cases and ten missed escalations would otherwise
     * report 90% and pass.
     */
    const results = [
      ...Array.from({ length: 19 }, (_, i) => result(`esc-${i}`, true, true)),
      result("esc-missed", true, false),
      ...Array.from({ length: 80 }, (_, i) => result(`auto-${i}`, false, false)),
    ];
    expect(score(results).recall).toBeCloseTo(0.95, 3);
  });

  it("fails the run when an escalation was missed", () => {
    // A miss is an AI answering a pricing question, a security question or an
    // angry prospect, in the rep's name, to a real buyer.
    const results = [
      ...Array.from({ length: 9 }, (_, i) => result(`esc-${i}`, true, true)),
      result("esc-missed", true, false),
    ];
    const scored = score(results);
    expect(scored.recall).toBeLessThan(RECALL_THRESHOLD);
    expect(scored.failed).toBe(true);
  });

  it("does not fail the run for an over-escalation", () => {
    // A human reviewing something the agent could have handled costs fifteen
    // seconds. The two errors are not symmetric and the gate is not either.
    const results = [
      ...Array.from({ length: 10 }, (_, i) => result(`esc-${i}`, true, true)),
      result("over", false, true),
    ];
    const scored = score(results);
    expect(scored.recall).toBe(1);
    expect(scored.failed).toBe(false);
  });

  it("fails the run when a case errored, rather than counting it as automated", () => {
    /*
     * The one that would have made a paid run lie. A case that throws is
     * scored `needsHuman: false` so the report can still be assembled — and
     * read as a result, that is a *miss* turned into a pass by a network blip.
     * Recall computed over cases that never ran is not recall.
     */
    const results = [
      ...Array.from({ length: 10 }, (_, i) => result(`esc-${i}`, true, true)),
      result("boom", false, false, { error: "429 rate limited" }),
    ];
    const scored = score(results);
    expect(scored.recall).toBe(1);
    expect(scored.failed).toBe(true);
  });

  it("passes a clean run", () => {
    const results = Array.from({ length: 20 }, (_, i) => result(`esc-${i}`, i % 2 === 0, i % 2 === 0));
    const scored = score(results);
    expect(scored.recall).toBe(1);
    expect(scored.failed).toBe(false);
  });
});
