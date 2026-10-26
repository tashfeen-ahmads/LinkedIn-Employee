import { describe, expect, it } from "vitest";
import { UnipileProvider, currentIndustryName, matchParameter } from "../src/unipile.js";
import type { SearchQuery } from "../src/provider.js";

/**
 * A place or an industry is searched only as the thing it names (rule 12).
 *
 * The typeahead answers with whatever contains the words, in its own order,
 * and the first answer used to be taken: "New York, NY" was searched as
 * Nyack, and a real message then went to somebody about "HUD matters around
 * Nyack". "Residential Real Estate" became "Leasing Non-residential Real
 * Estate" and "Home Services" became "Home Health Care Services". Each wrong
 * answer was cached for the life of the process.
 */

type Item = { id: string; title: string };

function providerWithTypeahead(answers: Record<string, Item[]>) {
  const lookups: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/search/parameters")) {
      const asked = new URL(href).searchParams.get("keywords") ?? "";
      lookups.push(asked);
      return json({ items: answers[asked] ?? [] });
    }
    bodies.push(JSON.parse(String(init?.body)));
    return json({ items: [{ provider_id: "p1", public_identifier: "jane" }], cursor: null });
  }) as typeof fetch;
  const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });
  return { provider, lookups, bodies };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

const search = (provider: UnipileProvider, query: SearchQuery) =>
  provider.searchProspects({ accountId: "a1", query: { titles: ["Founder"], ...query }, tier: "classic" });

describe("looking up a place", () => {
  it("picks the city that was named, not the first answer", async () => {
    const { provider, bodies } = providerWithTypeahead({
      "New York, NY": [
        { id: "nyack", title: "Nyack, New York, United States" },
        { id: "nyc", title: "New York, New York, United States" },
      ],
    });

    const page = await search(provider, { geographies: ["New York, NY"] });

    expect(bodies[0]?.location).toEqual(["nyc"]);
    // Same place by its full name: not a rename, so no "searched as".
    expect(page.filterNotes ?? []).not.toContainEqual(expect.stringMatching(/searched as/));
  });

  it("drops a place the typeahead only has a neighbour for, and says so", async () => {
    const { provider, bodies } = providerWithTypeahead({
      "New York, NY": [{ id: "nyack", title: "Nyack, New York" }],
    });

    const page = await search(provider, { geographies: ["New York, NY"] });

    expect(bodies[0]?.location).toBeUndefined();
    expect(page.filterNotes).toContain(
      'LinkedIn has no location called "New York, NY", so it was left out of the search.',
    );
  });

  it("requires the region the term names", async () => {
    expect(matchParameter("LOCATION", "Portland, OR", ["Portland, Maine, United States"])).toBeNull();
    expect(
      matchParameter("LOCATION", "Portland, OR", ["Portland, Maine, United States", "Portland, Oregon, United States"]),
    ).toEqual({ index: 1, ambiguous: false });
    expect(matchParameter("LOCATION", "London, UK", ["London, England, United Kingdom"])).toEqual({
      index: 0,
      ambiguous: false,
    });
  });

  it("prefers an exact name over a city match", () => {
    expect(
      matchParameter("LOCATION", "New York, New York, United States", [
        "New York, New York, United States Metro",
        "New York, New York, United States",
      ]),
    ).toEqual({ index: 1, ambiguous: false });
  });

  it("says when a bare city name could be more than one place", async () => {
    const { provider, bodies } = providerWithTypeahead({
      Portland: [
        { id: "pdx", title: "Portland, Oregon, United States" },
        { id: "pwm", title: "Portland, Maine, United States" },
      ],
    });

    const page = await search(provider, { geographies: ["Portland"] });

    expect(bodies[0]?.location).toEqual(["pdx"]);
    expect(page.filterNotes).toContainEqual(expect.stringMatching(/"Portland" names more than one place/));
  });
});

describe("looking up an industry", () => {
  it("drops an industry the typeahead only has a near-miss for", async () => {
    const { provider, bodies } = providerWithTypeahead({
      "Residential Real Estate": [{ id: "9", title: "Leasing Non-residential Real Estate" }],
      "Home Services": [{ id: "8", title: "Home Health Care Services" }],
    });

    const page = await search(provider, { industries: ["Residential Real Estate", "Home Services"] });

    expect(bodies[0]?.industry).toBeUndefined();
    expect(page.filterNotes).toContain(
      'LinkedIn has no industry called "Residential Real Estate", so it was left out of the search.',
    );
    expect(page.filterNotes).toContain(
      'LinkedIn has no industry called "Home Services", so it was left out of the search.',
    );
    expect(page.filterNotes ?? []).not.toContainEqual(expect.stringMatching(/searched as/));
  });

  it("searches a pre-2022 name as LinkedIn's current one, and says so", async () => {
    const { provider, bodies, lookups } = providerWithTypeahead({
      "Software Development": [
        { id: "x", title: "Software Development Outsourcing" },
        { id: "4", title: "Software Development" },
      ],
    });

    const page = await search(provider, { industries: ["Computer Software"] });

    expect(lookups).toEqual(["Software Development"]);
    expect(bodies[0]?.industry).toEqual(["4"]);
    expect(page.filterNotes).toContain(
      'The industry "Computer Software" was searched as LinkedIn\'s "Software Development".',
    );
  });

  it("matches an exact name whatever its case, spacing or ampersand", async () => {
    const { provider, bodies } = providerWithTypeahead({
      "architecture & planning": [{ id: "50", title: "Architecture and Planning" }],
    });

    const page = await search(provider, { industries: ["architecture & planning"] });

    expect(bodies[0]?.industry).toEqual(["50"]);
    expect(page.filterNotes).toEqual([]);
  });

  it("knows the renames the Strategy Agent writes most", () => {
    expect(currentIndustryName("Information Technology and Services")).toBe("IT Services and IT Consulting");
    expect(currentIndustryName("Hospital & Health Care")).toBe("Hospitals and Health Care");
    expect(currentIndustryName("Management Consulting")).toBe("Business Consulting and Services");
    expect(currentIndustryName("health, wellness and fitness")).toBe("Wellness and Fitness Services");
    expect(currentIndustryName("Education Management")).toBe("Education Administration Programs");
    expect(currentIndustryName("Financial Services")).toBeUndefined();
  });
});

describe("remembering answers", () => {
  it("asks again after a miss rather than remembering it", async () => {
    const answers: Record<string, Item[]> = {};
    const { provider, lookups, bodies } = providerWithTypeahead(answers);

    await search(provider, { geographies: ["Ireland"] });
    answers.Ireland = [{ id: "104738515", title: "Ireland" }];
    await search(provider, { geographies: ["Ireland"] });

    expect(lookups).toEqual(["Ireland", "Ireland"]);
    expect(bodies.at(-1)?.location).toEqual(["104738515"]);
  });

  it("never remembers a near-miss as the answer", async () => {
    const answers: Record<string, Item[]> = {
      "New York, NY": [{ id: "nyack", title: "Nyack, New York, United States" }],
    };
    const { provider, bodies } = providerWithTypeahead(answers);

    await search(provider, { geographies: ["New York, NY"] });
    answers["New York, NY"] = [
      { id: "nyack", title: "Nyack, New York, United States" },
      { id: "nyc", title: "New York, New York, United States" },
    ];
    await search(provider, { geographies: ["New York, NY"] });

    expect(bodies[0]?.location).toBeUndefined();
    expect(bodies.at(-1)?.location).toEqual(["nyc"]);
  });
});
