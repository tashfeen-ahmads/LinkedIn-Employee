import { describe, expect, it } from "vitest";
import { parseHeadline } from "../src/headline.js";
import { renderMerge, missingFields } from "../src/merge-fields.js";

/**
 * Every headline below is a real one from the live campaign. They are the
 * reason this exists: `prospects.company` was null for all of them, so a
 * message written from `{{company}}` had nothing to put there.
 */
describe("reading a company out of a headline", () => {
  it("reads 'ROLE at COMPANY'", () => {
    const parsed = parseHeadline("CEO at Laila Enterprise LLC (Self employed)");
    expect(parsed.company).toBe("Laila Enterprise LLC");
    expect(parsed.title).toBe("CEO");
    expect(parsed.role).toBe("owner");
  });

  it("reads a company out of the middle of a pipe-separated headline", () => {
    const parsed = parseHeadline("Servant Leader | Owner of The Wynners Club | Business Broker");
    expect(parsed.company).toBe("The Wynners Club");
    expect(parsed.role).toBe("owner");
  });

  it("stops at the comma when a headline names a second role", () => {
    // "Founder … of International Ally Federation, CEO of PathPilot Coaching"
    // names two companies. Taking the whole right-hand side would produce a
    // company nobody works at.
    const parsed = parseHeadline(
      "Founder and Executive Director of International Ally Federation, CEO of PathPilot Coaching",
    );
    expect(parsed.company).toBe("International Ally Federation");
    expect(parsed.role).toBe("owner");
  });

  it("finds no company in a headline that is a list of services", () => {
    /*
     * The one that matters. Guessing here produces "regarding your
     * Photo-realistic Product Animation" in front of a stranger, under a real
     * rep's name.
     */
    const parsed = parseHeadline(
      "Photo-realistic Product Animation | 3D Modeling for Prototypes | Interactive Product Visualizations | High-quality 3D Models for E-commerce Listing",
    );
    expect(parsed.company).toBeNull();
  });

  it("refuses a one-word company that is really a discipline", () => {
    // "Director of Photography" does not work at a company called Photography.
    expect(parseHeadline("Director of Photography").company).toBeNull();
    expect(parseHeadline("Head of Engineering").company).toBeNull();
  });

  it("trusts a one-word company after 'at', where 'of' has to prove itself", () => {
    /*
     * "at X" means employed at X. "of X" does not: a Director of Photography
     * does not work for a company called Photography. Treating them the same
     * either invents companies or loses real ones.
     */
    expect(parseHeadline("Community Manager at Datex").company).toBe("Datex");
    expect(parseHeadline("Founding Executive Director at SLETATE").company).toBe("SLETATE");
    expect(parseHeadline("Director of Photography").company).toBeNull();
  });

  it("takes a company from a segment of its own when it carries a legal suffix", () => {
    // "… | Owner & Certified Life Coach | Perfect You LLC" names the employer
    // in a segment with no join word in it at all.
    expect(
      parseHeadline("I help professionals thrive | Owner & Certified Life Coach | Perfect You LLC").company,
    ).toBe("Perfect You LLC");
  });

  it("splits at the last join, not the first", () => {
    // "Vice President of Membership at National Charity League" was yielding a
    // company called "Membership at National Charity League".
    expect(
      parseHeadline("Vice President of Membership at National Charity League, Inc., Walnut Creek Chapter").company,
    ).toBe("National Charity League");
  });

  it("accepts a one-word company that is unmistakable", () => {
    expect(parseHeadline("Engineer at PathPilot").company).toBe("PathPilot");
    expect(parseHeadline("Analyst at Wynners LLC").company).toBe("Wynners LLC");
  });

  it("still reads the role when no company is named", () => {
    // This is what decides whether the opener asks "are you the owner" or
    // "are you the manager", so it is useful on its own.
    expect(parseHeadline("Founder | Business Broker").role).toBe("owner");
    expect(parseHeadline("Operations Manager").role).toBe("manager");
  });

  it("says nothing about an empty headline rather than guessing", () => {
    expect(parseHeadline(null)).toEqual({ title: null, company: null, role: null });
    expect(parseHeadline("   ")).toEqual({ title: null, company: null, role: null });
  });
});

describe("writing a message from what we know", () => {
  const OPENER =
    "Hi {{first_name}}, {{rep_name}} here{{#company}} regarding {{company}}{{/company}}.{{^company}} Are you the owner of the business?{{/company}}";

  it("names the company when we have one", () => {
    expect(
      renderMerge(OPENER, { first_name: "Kristina", rep_name: "Tashfeen", company: "The Wynners Club" }),
    ).toBe("Hi Kristina, Tashfeen here regarding The Wynners Club.");
  });

  it("changes the sentence when we do not, rather than leaving a hole", () => {
    /*
     * The whole reason a template declares both halves. Plain substitution
     * gives "Hi Desmond, Tashfeen here regarding your ." — to a stranger, as
     * the first thing they ever read from this rep.
     */
    expect(renderMerge(OPENER, { first_name: "Desmond", rep_name: "Tashfeen", company: null })).toBe(
      "Hi Desmond, Tashfeen here. Are you the owner of the business?",
    );
  });

  it("falls back to 'there' for a name we do not have", () => {
    expect(renderMerge("Hi {{first_name}}", {})).toBe("Hi there");
  });

  it("reads the shapes people actually type, not only the documented one", () => {
    // `[Name]` reached a real prospect once. A placeholder sent verbatim is
    // worse than being relaxed about reading it.
    for (const t of ["Hi {{first_name}}", "Hi {first_name}", "Hi [first_name]", "Hi {{ first_name }}"]) {
      expect(renderMerge(t, { first_name: "Jane" })).toBe("Hi Jane");
    }
  });

  it("leaves no double spaces or orphaned punctuation behind", () => {
    const out = renderMerge("Hi {{first_name}},{{#company}} about {{company}},{{/company}} quick one.", {
      first_name: "Jane",
      company: null,
    });
    expect(out).toBe("Hi Jane, quick one.");
    expect(out).not.toMatch(/ {2}/);
  });

  it("leaves an unguarded field it cannot fill visible, rather than blank", () => {
    /*
     * Rule 29's habit. An empty substitution sends "regarding your ." to a
     * stranger, which reads as a broken product; a visible {{company}} is
     * caught on the review screen before anybody sees it.
     */
    expect(renderMerge("Hi {{first_name}}, regarding {{company}}.", { first_name: "Jane" })).toBe(
      "Hi Jane, regarding {{company}}.",
    );
  });

  it("reports an unguarded field it cannot fill, and stays quiet about a guarded one", () => {
    // A guarded field is a decision already made; reporting it as a gap would
    // train somebody to ignore the report.
    expect(missingFields("Hi {{first_name}} at {{company}}", { first_name: "Jane" })).toEqual(["company"]);
    expect(missingFields(OPENER, { first_name: "Jane", rep_name: "Tashfeen" })).toEqual([]);
  });
});
