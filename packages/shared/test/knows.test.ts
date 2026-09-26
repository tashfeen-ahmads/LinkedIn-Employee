import { describe, expect, it } from "vitest";
import { describeKnowledge, knowledgeSentences, type AgentKnowledge } from "../src/knows.js";

/**
 * What a workspace has accumulated that a competitor could not hand somebody on
 * day one. It was accruing silently behind screens that showed only rates.
 */

const NEW: AgentKnowledge = {
  openers: 0,
  offers: 0,
  anglesTested: 0,
  peopleContacted: 0,
  knowledgeDocuments: 0,
  repliesSent: 0,
};

const SIX_MONTHS: AgentKnowledge = {
  openers: 5,
  offers: 3,
  anglesTested: 4,
  peopleContacted: 240,
  knowledgeDocuments: 7,
  repliesSent: 62,
};

describe("a workspace that has been running", () => {
  it("says what it holds, in one sentence", () => {
    const said = knowledgeSentences(SIX_MONTHS).join(" ");
    expect(said).toContain("5 approved openers");
    expect(said).toContain("3 approved offer lines");
    expect(said).toContain("4 angles tested against each other");
  });

  it("gives the dedupe record its own sentence", () => {
    /*
     * Not a feature among features. It is the reason nobody here is written to
     * twice (rule 24), and the most expensive thing to walk away from: leaving
     * means losing the only list of who must never be approached again.
     */
    const lines = knowledgeSentences(SIX_MONTHS);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("240 people");
    expect(lines[1]).toContain("will not write to any of them twice");
  });
});

describe("a workspace on its first day", () => {
  it("is told what will accumulate, not what has not", () => {
    // An apology for an empty list is how a new customer learns the product is
    // not working yet. This is a promise about what the next month buys.
    const lines = knowledgeSentences(NEW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("makes the next campaign better than the last");
    expect(lines[0]).not.toContain("0");
  });

  it("never prints a zero as a holding", () => {
    // "0 angles tested" reads as failure on a workspace three days old;
    // leaving it out reads as "not yet", which is the truth.
    expect(describeKnowledge({ ...NEW, openers: 2 })).toEqual(["2 approved openers"]);
  });
});

describe("counting", () => {
  it("speaks in the singular for one", () => {
    const said = knowledgeSentences({
      ...NEW,
      openers: 1,
      offers: 1,
      anglesTested: 1,
      peopleContacted: 1,
      repliesSent: 1,
    }).join(" ");
    expect(said).toContain("1 approved opener,");
    expect(said).toContain("1 approved offer line");
    expect(said).toContain("1 angle tested");
    expect(said).toContain("1 reply you approved");
    expect(said).toContain("1 person you have already spoken to");
  });
});
