import { describe, expect, it, vi } from "vitest";
import { CustomerProfileSchema, MIN_FIT_TO_QUEUE } from "@le/shared";
import {
  FIT_BANDS,
  FIT_EVAL_PROFILES,
  FIT_SCORE_CASES,
  FIT_TRAPS,
  toCandidate,
  type FitScoreCase,
} from "../evals/fit-score-cases.js";
import {
  MAX_FALSE_POSITIVE_RATE,
  isQueued,
  missingKeyMessage,
  report,
  type FitResult,
} from "../evals/run-fit-score.js";

/**
 * The fit-score eval spends money and needs a key, so it is not in CI. The
 * dataset and the arithmetic are, because a labelled set that contradicts
 * itself or a harness that miscounts would make the first paid run lie.
 */
describe("fit-score dataset", () => {
  it("has between 25 and 40 cases with unique ids", () => {
    const ids = FIT_SCORE_CASES.map((c) => c.id);
    expect(ids.length).toBeGreaterThanOrEqual(25);
    expect(ids.length).toBeLessThanOrEqual(40);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels every case with a valid band and explains it", () => {
    for (const c of FIT_SCORE_CASES) {
      expect(FIT_BANDS, c.id).toContain(c.expect);
      if (c.trap !== null) expect(FIT_TRAPS, c.id).toContain(c.trap);
      expect(c.note.length, c.id).toBeGreaterThan(20);
    }
  });

  it("scores every case against a profile that exists and parses", () => {
    const ids = FIT_EVAL_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const p of FIT_EVAL_PROFILES) {
      expect(CustomerProfileSchema.safeParse(p.profile).success, p.id).toBe(true);
      // The two fields a peer cannot fill honestly are the point of rule 49.
      expect(p.profile.whatTheyBuy, p.id).toBeTruthy();
      expect(p.profile.insteadOfToday, p.id).toBeTruthy();
      expect(p.business.competitors.length, p.id).toBeGreaterThan(0);
      const cases = FIT_SCORE_CASES.filter((c) => c.profileId === p.id);
      expect(cases.some((c) => c.expect === "fit"), p.id).toBe(true);
      expect(cases.some((c) => c.expect === "no_fit"), p.id).toBe(true);
    }
    for (const c of FIT_SCORE_CASES) expect(ids, c.id).toContain(c.profileId);
  });

  it("carries at least five traps, of every kind, labelled the way rule 49 reads them", () => {
    const traps = FIT_SCORE_CASES.filter((c) => c.trap !== null);
    expect(traps.length).toBeGreaterThanOrEqual(5);
    for (const kind of FIT_TRAPS) expect(traps.some((c) => c.trap === kind), kind).toBe(true);
    for (const c of traps) {
      // A competitor or a peer never buys; a buyer in other words always does.
      expect(c.expect, c.id).toBe(c.trap === "different_words" ? "fit" : "no_fit");
    }
  });

  it("builds a distinct candidate for every case", () => {
    const urls = FIT_SCORE_CASES.map((c) => toCandidate(c).linkedinUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("fit-score harness", () => {
  function result(id: string, expect: FitScoreCase["expect"], queued: boolean, over: Partial<FitResult> = {}): FitResult {
    return {
      testCase: { id, profileId: "p", prospect: {} as FitScoreCase["prospect"], expect, trap: null, note: "n" },
      fitScore: queued ? 80 : 20,
      disqualified: !queued,
      queued,
      reasons: [],
      ...over,
    };
  }

  function run(results: FitResult[]) {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const before = process.exitCode;
    try {
      return report(results);
    } finally {
      process.exitCode = before;
      log.mockRestore();
    }
  }

  it("queues by the targeting job's own rule", () => {
    expect(isQueued({ disqualified: false, fitScore: MIN_FIT_TO_QUEUE })).toBe(true);
    expect(isQueued({ disqualified: false, fitScore: MIN_FIT_TO_QUEUE - 1 })).toBe(false);
    expect(isQueued({ disqualified: true, fitScore: 95 })).toBe(false);
  });

  it("refuses to run without a key, in words", () => {
    expect(missingKeyMessage({})).toMatch(/OPENAI_API_KEY or ANTHROPIC_API_KEY/);
    expect(missingKeyMessage({ ANTHROPIC_API_KEY: "k" })).toBeNull();
  });

  it("passes a clean run", () => {
    const out = run([result("a", "fit", true), result("b", "no_fit", false)]);
    expect(out.accuracy).toBe(1);
    expect(out.failed).toBe(false);
  });

  it("fails when too many no_fit people would be queued", () => {
    const noFits = Array.from({ length: 9 }, (_, i) => result(`n${i}`, "no_fit", false));
    const out = run([result("a", "fit", true), ...noFits, result("fp", "no_fit", true), result("fp2", "no_fit", true)]);
    expect(out.falsePositives).toBe(2);
    expect(out.falsePositiveRate).toBeGreaterThan(MAX_FALSE_POSITIVE_RATE);
    expect(out.failed).toBe(true);
  });

  it("fails a scorer that drops every buyer, even with no false positives", () => {
    const out = run([result("a", "fit", false), result("b", "fit", false), result("c", "no_fit", false)]);
    expect(out.falsePositives).toBe(0);
    expect(out.fitRecall).toBe(0);
    expect(out.failed).toBe(true);
  });

  it("fails on an errored case rather than counting it as a correct rejection", () => {
    const out = run([result("a", "fit", true), result("boom", "no_fit", false, { error: "429" })]);
    expect(out.errors).toBe(1);
    expect(out.accuracy).toBe(1);
    expect(out.failed).toBe(true);
  });
});
