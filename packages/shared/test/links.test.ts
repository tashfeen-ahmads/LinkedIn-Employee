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

/**
 * A link without a scheme is still a link.
 *
 * `acme.com/demo` is the exact shape rule 30 names — the thing a model writes
 * when a reply wants a link and none was given — and only `http(s)://` used to
 * count, so the canonical case walked through the check that exists for it.
 */
describe("addresses written without a scheme", () => {
  it("finds a bare domain with a path", () => {
    expect(extractLinks("Book a time at acme.com/demo.")).toEqual(["acme.com/demo"]);
    expect(extractLinks("Pricing: acme.co.uk/preise")).toEqual(["acme.co.uk/preise"]);
  });

  it("finds a www address with or without a path", () => {
    expect(extractLinks("See www.acme.com/pricing!")).toEqual(["www.acme.com/pricing"]);
    expect(extractLinks("Visit www.acme.com.")).toEqual(["www.acme.com"]);
  });

  it("keeps schemed and bare addresses in the order they appear, once each", () => {
    expect(extractLinks("https://cal.com/sam/intro or acme.com/demo")).toEqual([
      "https://cal.com/sam/intro",
      "acme.com/demo",
    ]);
  });

  it("does not mistake prose for an address", () => {
    // Holding drafts for these would teach somebody to approve held drafts
    // without reading them, which is worse than not checking.
    for (const text of [
      "e.g. a quick call, i.e. fifteen minutes",
      "Mr.Smith suggested it",
      "Rated 4.5/5 by customers",
      "We use Node.js/React and README.md/docs",
      "Write to sam@acme.com or sam@acme.com/x",
      "acme.com is the company",
      "Version 2.0 shipped",
      "U.S./Canada only",
    ]) {
      expect(extractLinks(text), text).toEqual([]);
    }
  });

  it("holds an invented bare link and passes the one the agent was given", () => {
    expect(draftLinkCheck("Grab a slot at acme.com/demo", [BOOKING]).ok).toBe(false);
    expect(draftLinkCheck("Grab a slot at www.acme.com/pricing", [BOOKING]).ok).toBe(false);
    // Host and path compared as today: the given link written without its
    // scheme is the same destination.
    expect(draftLinkCheck("Grab a time at cal.com/sam/intro", [BOOKING]).ok).toBe(true);
    expect(sameDestination("www.cal.com/sam/intro/", BOOKING)).toBe(true);
    expect(sameDestination("cal.com/sam/demo", BOOKING)).toBe(false);
  });
});
