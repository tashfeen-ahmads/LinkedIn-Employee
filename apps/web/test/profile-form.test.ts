import { describe, expect, it } from "vitest";
import { applyProfileEdits, formatList, parseList } from "../src/lib/profile-form.js";

const SPEC = {
  name: "Ops leaders",
  summary: "People who run revenue operations at mid-market B2B companies.",
  jobTitles: ["Head of Operations"],
  seniority: ["Director"],
  industries: ["Software"],
  companySize: "51-200",
  geography: ["United Kingdom"],
  triggerEvents: ["Hired a RevOps manager"],
  pains: ["Manual pipeline hygiene"],
  valueProposition: "We automate the chasing.",
  salesNavFilters: {
    titles: ["Head of Operations"],
    seniorities: ["Director"],
    industries: ["Software"],
    companyHeadcount: ["51-200"],
    geographies: ["United Kingdom"],
    keywords: [],
    excludeTitles: [],
  },
  hooks: ["a", "b", "c"],
  connectionNote: "Hi {{first_name}}, we work with ops leaders.",
  followUps: [
    { delayDays: 2, message: "Worth a look?" },
    { delayDays: 4, message: "Closing the loop." },
  ],
  priority: 1,
};

function edits(overrides: Partial<Record<string, string>> = {}, priority = 1) {
  return {
    priority,
    filters: {
      titles: "Head of Operations",
      seniorities: "Director",
      industries: "Software",
      companyHeadcount: "51-200",
      geographies: "United Kingdom",
      keywords: "",
      excludeTitles: "",
      ...overrides,
    },
  } as Parameters<typeof applyProfileEdits>[1];
}

describe("parseList", () => {
  it("keeps a comma inside one value", () => {
    // "VP, Operations" is one title, not two.
    expect(parseList("VP, Operations\nHead of Ops")).toEqual(["VP, Operations", "Head of Ops"]);
  });

  it("drops blank lines and surrounding whitespace", () => {
    expect(parseList("  Director \n\n  VP  \n")).toEqual(["Director", "VP"]);
  });

  it("round-trips", () => {
    const values = ["VP, Operations", "Head of Ops"];
    expect(parseList(formatList(values))).toEqual(values);
  });
});

describe("applyProfileEdits", () => {
  it("writes the edited filters back onto the profile", () => {
    const result = applyProfileEdits(SPEC, edits({ titles: "Head of Operations\nDirector of Ops" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.salesNavFilters.titles).toEqual(["Head of Operations", "Director of Ops"]);
  });

  it("refuses a search with nothing to match on", () => {
    // Every criterion blank returns whoever LinkedIn feels like returning.
    const result = applyProfileEdits(
      SPEC,
      edits({ titles: "", seniorities: "", industries: "", keywords: "" }),
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a search narrowed to a keyword alone", () => {
    const result = applyProfileEdits(
      SPEC,
      edits({ titles: "", seniorities: "", industries: "", keywords: "revenue operations" }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a priority outside the range the agent uses", () => {
    expect(applyProfileEdits(SPEC, edits({}, 9)).ok).toBe(false);
  });

  it("keeps everything it was not asked to change", () => {
    const result = applyProfileEdits(SPEC, edits({ keywords: "revenue operations" }, 2));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.connectionNote).toBe(SPEC.connectionNote);
      expect(result.spec.followUps).toEqual(SPEC.followUps);
      expect(result.spec.priority).toBe(2);
    }
  });

  it("refuses to edit a profile that is not readable", () => {
    expect(applyProfileEdits({ nonsense: true }, edits()).ok).toBe(false);
  });
});
