import { describe, expect, it } from "vitest";
import { draftLinkCheck, extractLinks, sameDestination, unknownLinks } from "../src/links.js";

/**
 * The agent may not invent a URL, for the same reason it may not invent a
 * datetime: both reach a real person under a real rep's name, and both are the
 * kind of detail a language model produces fluently and wrongly.
 */

const BOOKING = "https://cal.com/sam/intro";

describe("extractLinks", () => {
  it("finds a link in a sentence", () => {
    expect(extractLinks(`Book here: ${BOOKING} — any time.`)).toEqual([BOOKING]);
  });

  it("does not swallow the full stop that ends the sentence", () => {
    // Otherwise every link at the end of a sentence looks invented.
    expect(extractLinks("Book here: https://cal.com/sam.")).toEqual(["https://cal.com/sam"]);
  });

  it("finds nothing in a message with no links", () => {
    expect(extractLinks("Happy to talk next week if that helps.")).toEqual([]);
  });
});

describe("sameDestination", () => {
  it("ignores a dropped query parameter", () => {
    // A model that copies a booking link and drops ?month=... has not invented
    // anything, and the link still works.
    expect(sameDestination("https://cal.com/sam/intro", `${BOOKING}?month=2026-09`)).toBe(true);
  });

  it("ignores www and a trailing slash", () => {
    expect(sameDestination("https://www.acme.test/signup/", "https://acme.test/signup")).toBe(true);
  });

  it("does not ignore an invented path", () => {
    // The case this exists for. Plausible, specific, and a 404.
    expect(sameDestination("https://acme.test/demo", "https://acme.test")).toBe(false);
  });

  it("does not ignore a different host", () => {
    expect(sameDestination("https://acme.co/signup", "https://acme.test/signup")).toBe(false);
  });
});

describe("unknownLinks", () => {
  it("passes the link the agent was given", () => {
    expect(unknownLinks(`Book here: ${BOOKING}`, [BOOKING])).toEqual([]);
  });

  it("catches one the agent made up", () => {
    expect(unknownLinks("See https://acme.test/demo", [BOOKING])).toEqual(["https://acme.test/demo"]);
  });

  it("treats every link as unknown when the agent was given none", () => {
    // A conversation-goal campaign has no link at all, so any link in the
    // draft came from somewhere the agent invented.
    expect(unknownLinks("See https://acme.test", [])).toEqual(["https://acme.test"]);
  });

  it("ignores blanks in the allowed list", () => {
    // A rep with no booking link set must not accidentally permit everything.
    expect(unknownLinks("See https://acme.test", ["", "   "])).toEqual(["https://acme.test"]);
  });
});

describe("draftLinkCheck", () => {
  it("names the offending link", () => {
    // A draft held back has to say which link was wrong, or the person
    // reviewing it re-reads three paragraphs looking for the problem.
    const result = draftLinkCheck("Try https://acme.test/demo", [BOOKING]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("https://acme.test/demo");
  });

  it("lets a clean draft through", () => {
    expect(draftLinkCheck("Happy to talk next week.", []).ok).toBe(true);
  });
});
