import { describe, expect, it } from "vitest";
import { profileHref } from "../src/exclusions.js";

/**
 * The link a rep clicks when a real person has just replied.
 *
 * Every `linkedin_url` this product stores is scheme-less, because that is what
 * LinkedIn's search returns. Put straight into an `href` it is a relative URL,
 * and the rep lands on `/app/linkedin.com/in/<name>` — our own 404, from a link
 * that reads correctly right up until it is clicked. It shipped broken on the
 * Inbox and on Meetings while working on two other screens, which is what four
 * copies of one rule buys you.
 */
describe("profileHref", () => {
  it("makes a stored, scheme-less address absolute", () => {
    // This exact value is in production.
    expect(profileHref("linkedin.com/in/laila-arjuman-8166a0209")).toBe(
      "https://linkedin.com/in/laila-arjuman-8166a0209",
    );
  });

  it("never returns something a browser would resolve against our own domain", () => {
    for (const stored of [
      "linkedin.com/in/danarizzo",
      "www.linkedin.com/in/jesse-kb",
      "/linkedin.com/in/parisa-ally",
      "  linkedin.com/in/lhostetler  ",
    ]) {
      const href = profileHref(stored);
      expect(href, `${stored} stayed relative`).toMatch(/^https:\/\//);
      expect(href, `${stored} kept a leading slash`).not.toMatch(/^https:\/\/\//);
    }
  });

  it("leaves an address that already has a scheme alone", () => {
    expect(profileHref("https://www.linkedin.com/in/x")).toBe("https://www.linkedin.com/in/x");
    expect(profileHref("http://www.linkedin.com/in/x")).toBe("http://www.linkedin.com/in/x");
  });

  it("returns null rather than a link to nowhere", () => {
    // Rule 13: a prospect with no public address is a real person, and the
    // screen must not offer a link that cannot open.
    for (const empty of [null, undefined, "", "   "]) expect(profileHref(empty)).toBeNull();
  });
});
