import { describe, expect, it } from "vitest";
import {
  exclusionReason,
  matchExclusion,
  normalizeCompany,
  normalizeExclusionValue,
  normalizeLinkedInUrl,
  type ExclusionRule,
} from "../src/exclusions.js";

const rule = (kind: ExclusionRule["kind"], raw: string, reason?: string): ExclusionRule => ({
  kind,
  value: normalizeExclusionValue(kind, raw),
  rawValue: raw,
  reason: reason ?? null,
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
    expect(new Set(variants.map(normalizeLinkedInUrl)).size).toBe(1);
  });
});

describe("normalizeCompany", () => {
  it("treats one company written several ways as one account", () => {
    const variants = ["Acme Corp.", "acme corporation", "ACME, Inc.", "  Acme   Ltd  "];
    expect(new Set(variants.map(normalizeCompany)).size).toBe(1);
  });

  it("keeps a suffix word that is part of the name", () => {
    // "Group Nine" is not "Nine"; only a trailing suffix is a legal form.
    expect(normalizeCompany("Group Nine")).toBe("group nine");
    expect(normalizeCompany("Nine Group")).toBe("nine");
  });

  it("does not collapse a name that is only a suffix", () => {
    expect(normalizeCompany("Group")).toBe("group");
  });

  it("keeps distinct companies distinct", () => {
    expect(normalizeCompany("Acme")).not.toBe(normalizeCompany("Acme Health"));
  });

  it("folds accents and ampersands so one spelling matches", () => {
    expect(normalizeCompany("Nestlé & Co")).toBe(normalizeCompany("Nestle and Company"));
  });
});

describe("matchExclusion", () => {
  it("blocks everyone at an excluded company, however the name is written", () => {
    const rules = [rule("company", "Acme Inc.", "existing customer")];
    expect(matchExclusion(rules, { company: "ACME Corporation" })).not.toBeNull();
  });

  it("blocks one named person without blocking their colleagues", () => {
    const rules = [rule("person", "https://www.linkedin.com/in/jane-doe")];
    expect(matchExclusion(rules, { linkedinUrl: "linkedin.com/in/jane-doe/", company: "Acme" })).not.toBeNull();
    expect(matchExclusion(rules, { linkedinUrl: "linkedin.com/in/john-roe", company: "Acme" })).toBeNull();
  });

  it("lets everyone else through", () => {
    const rules = [rule("company", "Acme"), rule("person", "linkedin.com/in/jane-doe")];
    expect(matchExclusion(rules, { company: "Northwind", linkedinUrl: "linkedin.com/in/john-roe" })).toBeNull();
  });

  it("does not match a prospect with no company against a company rule", () => {
    // An empty company must never normalize to the same thing as a real one.
    expect(matchExclusion([rule("company", "Acme")], { company: null })).toBeNull();
    expect(matchExclusion([rule("company", "Acme")], { company: "" })).toBeNull();
  });

  it("returns the rule so the block can explain itself", () => {
    const rules = [rule("company", "Acme Inc.", "existing customer")];
    const hit = matchExclusion(rules, { company: "Acme" });
    expect(exclusionReason(hit!)).toBe("excluded: Acme Inc. — existing customer");
  });

  it("explains itself even when nobody wrote a reason", () => {
    expect(exclusionReason(rule("company", "Acme"))).toBe("excluded: Acme");
  });
});
