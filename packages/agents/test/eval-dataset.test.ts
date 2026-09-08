import { describe, expect, it } from "vitest";
import { OPT_OUT_PHRASES } from "@le/shared";
import { CLASSIFICATION_CASES } from "../evals/classification-cases.js";
import { containsOptOut } from "../src/reply.js";

/**
 * The eval dataset itself is worth testing: a labelled set that contradicts
 * itself silently weakens every measurement taken against it.
 */
describe("classification dataset", () => {
  it("has unique ids", () => {
    const ids = CLASSIFICATION_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers both decisions with enough cases to mean something", () => {
    const escalate = CLASSIFICATION_CASES.filter((c) => c.expect.needsHuman);
    const automate = CLASSIFICATION_CASES.filter((c) => !c.expect.needsHuman);
    expect(escalate.length).toBeGreaterThanOrEqual(10);
    expect(automate.length).toBeGreaterThanOrEqual(10);
  });

  it("explains why every case exists", () => {
    for (const testCase of CLASSIFICATION_CASES) {
      expect(testCase.note.length, testCase.id).toBeGreaterThan(20);
    }
  });

  it("never labels an opt-out as safe to automate", () => {
    for (const testCase of CLASSIFICATION_CASES.filter((c) => c.expect.optOut)) {
      expect(testCase.expect.needsHuman, testCase.id).toBe(true);
      expect(testCase.expect.intent, testCase.id).toBe("not_interested");
    }
  });

  it("agrees with the deterministic opt-out matcher", () => {
    for (const testCase of CLASSIFICATION_CASES) {
      // The matcher is a safety net, not a classifier: it may miss an opt-out
      // the model catches, but it must never fire on a case labelled otherwise.
      if (containsOptOut(testCase.message)) {
        expect(testCase.expect.optOut, `${testCase.id} matches ${OPT_OUT_PHRASES.join("/")}`).toBe(true);
      }
    }
  });

  it("keeps soft nos out of the opt-out bucket", () => {
    for (const testCase of CLASSIFICATION_CASES.filter((c) => c.expect.intent === "not_now")) {
      expect(testCase.expect.optOut, testCase.id).toBe(false);
      expect(containsOptOut(testCase.message), testCase.id).toBe(false);
    }
  });
});
