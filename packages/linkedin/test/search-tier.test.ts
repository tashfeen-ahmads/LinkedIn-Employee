import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";
import type { SearchQuery } from "../src/provider.js";

/**
 * Which search surface a customer profile is sent to, and what its words turn
 * into on the way.
 *
 * Sales Navigator is a separate paid seat — around $120 a month, more than
 * everything else in this product's stack combined. Assuming every account has
 * one made the subscription mandatory in practice, and the failure was silent:
 * a search against a tier the account lacks returns nothing, which reads on
 * screen as "your customer profile matched nobody".
 *
 * The same sentence describes the other bug these tests exist for. LinkedIn
 * does not search by the name of a place or an industry, only by its id, and
 * `location: ["United States"]` is not a loose match returning fewer people —
 * it is not a location, and the search comes back empty. That is what actually
 * happened on the first live campaign: three approved customer profiles, a
 * connected account, a queued job, and nobody found.
 */

const QUERY: SearchQuery = {
  titles: ["Head of Operations"],
  seniorities: ["Director"],
  industries: ["Software"],
  companyHeadcount: ["51-200"],
  geographies: ["United Kingdom"],
  keywords: ["revops"],
  excludeTitles: ["Intern"],
};

/**
 * The provider captures `fetch` at construction, so it is injected rather than
 * spied on. A spy installed afterwards leaves the real fetch in place: the
 * request fails, `bodies` stays empty, and every `expect(bodies[0]?.x)` passes
 * against undefined. Three of these tests did exactly that before this changed.
 *
 * `parameters` is what LinkedIn's taxonomy lookup answers, keyed by the words
 * asked with. A name missing from it is a name LinkedIn does not know.
 */
function providerWithCapturedBody(parameters: Record<string, { id: string; title: string }> = {
  "united kingdom": { id: "101165590", title: "United Kingdom" },
  software: { id: "4", title: "Software Development" },
}) {
  const bodies: Record<string, unknown>[] = [];
  const lookups: string[] = [];

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/search/parameters")) {
      const asked = new URL(href).searchParams.get("keywords") ?? "";
      lookups.push(asked);
      const hit = parameters[asked.trim().toLowerCase()];
      return json({ items: hit ? [hit] : [] });
    }
    bodies.push(JSON.parse(String(init?.body)));
    return json({ items: [], cursor: null });
  }) as typeof fetch;

  const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });
  return { provider, bodies, lookups };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("searchProspects tier", () => {
  it("sends the whole customer profile to Sales Navigator", async () => {
    const { provider, bodies } = providerWithCapturedBody();

    const page = await provider.searchProspects({
      accountId: "a1",
      query: QUERY,
      tier: "sales_navigator",
    });

    expect(bodies[0]?.api).toBe("sales_navigator");
    expect(bodies[0]?.seniority).toEqual({ include: ["Director"] });
    expect(bodies[0]?.company_headcount).toEqual(["51-200"]);
    expect(page.droppedFilters).toEqual([]);
  });

  it("defaults to classic, because a seat nobody bought is the costlier assumption", async () => {
    const { provider, bodies } = providerWithCapturedBody();

    await provider.searchProspects({ accountId: "a1", query: QUERY });

    expect(bodies[0]?.api).toBe("classic");
  });

  it("names every filter classic search cannot apply", async () => {
    const { provider, bodies } = providerWithCapturedBody();

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "classic" });

    // Silently dropping these returns a list that looks like the profile asked
    // for and is not, and the reviewer approves it.
    expect(page.droppedFilters).toEqual(["seniority", "company size", "excluded titles"]);
    // Asserted against a body that exists: `bodies[0]?.seniority` is undefined
    // when no request was made at all, which would pass while proving nothing.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.seniority).toBeUndefined();
    expect(bodies[0]?.company_headcount).toBeUndefined();
  });

  it("searches locations and industries by LinkedIn's id, never by name", async () => {
    const { provider, bodies, lookups } = providerWithCapturedBody();

    await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "classic" });

    expect(lookups).toEqual(["United Kingdom", "Software"]);
    // The whole bug, in two lines. Sending the words returns nobody.
    expect(bodies[0]?.location).toEqual(["101165590"]);
    expect(bodies[0]?.industry).toEqual(["4"]);
  });

  it("asks Sales Navigator by id too", async () => {
    const { provider, bodies } = providerWithCapturedBody();

    await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "sales_navigator" });

    expect(bodies[0]?.location).toEqual({ include: ["101165590"] });
    expect(bodies[0]?.industry).toEqual({ include: ["4"] });
  });

  it("says when a term was searched as something LinkedIn calls by another name", async () => {
    const { provider } = providerWithCapturedBody();

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "classic" });

    // "Software" is a real thing to ask for and is not what LinkedIn calls it.
    // The narrower list is fine; the reviewer not knowing it narrowed is not.
    expect(page.filterNotes).toEqual([
      'The industry "Software" was searched as LinkedIn\'s "Software Development".',
    ]);
  });

  it("leaves out a term LinkedIn does not have, and says so", async () => {
    const { provider, bodies } = providerWithCapturedBody({});

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { geographies: ["Wakanda"], titles: ["Founder"] },
      tier: "classic",
    });

    expect(bodies[0]?.location).toBeUndefined();
    expect(page.filterNotes).toEqual([
      'LinkedIn has no location called "Wakanda", so it was left out of the search.',
    ]);
  });

  it("says the provider's own words, not just its status code", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ status: 404, type: "errors/no_account", title: "Account not found" }),
        { status: 404, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });

    // A 404 here means no such account, or a feature the subscription lacks,
    // or a route that is not on this deployment. Three different things to do
    // about it, and the number alone picks none of them.
    await expect(
      provider.searchProspects({ accountId: "a1", query: { titles: ["Founder"] }, tier: "classic" }),
    ).rejects.toThrow(/Account not found/);
  });

  it("does not report a lookup it could not make as a term LinkedIn lacks", async () => {
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/search/parameters")) {
        return new Response(JSON.stringify({ title: "Account not found" }), { status: 404 });
      }
      void init;
      return json({ items: [], cursor: null });
    }) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { geographies: ["United Kingdom"] },
      tier: "classic",
    });

    // "LinkedIn has no location called United Kingdom" would be a lie, and the
    // kind that sends someone off to rewrite a customer profile that is fine.
    expect(page.filterNotes?.[0]).toMatch(/could not be looked up/);
    expect(page.filterNotes?.[0]).toMatch(/Account not found/);
  });

  it("asks LinkedIn for each term once, however many searches run", async () => {
    const { provider, lookups } = providerWithCapturedBody();

    await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "classic" });
    await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "classic" });

    expect(lookups).toEqual(["United Kingdom", "Software"]);
  });

  it("keeps the filters classic search does have", async () => {
    const { provider, bodies } = providerWithCapturedBody();

    await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "classic" });

    expect(bodies[0]?.advanced_keywords).toEqual({ title: '"Head of Operations"' });
    // First-degree connections have already accepted; inviting them spends the
    // day's allowance on nothing.
    expect(bodies[0]?.network_distance).toEqual([2, 3]);
    // Seniority survives as a text hint rather than vanishing entirely — worth
    // something, and still reported as dropped because a hint is not a filter.
    expect(bodies[0]?.keywords).toBe('"revops" OR "Director"');
  });

  it("joins several terms as alternatives, not as a single unsatisfiable phrase", async () => {
    const { provider, bodies } = providerWithCapturedBody();

    await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["Chapter President", "Group Leader"], keywords: ["BNI", "Chamber"] },
      tier: "classic",
    });

    // Space-joined, these are an AND: a profile had to contain every word, and
    // essentially nobody does. A list of titles is a list of alternatives.
    expect(bodies[0]?.keywords).toBe('"BNI" OR "Chamber"');
    expect(bodies[0]?.advanced_keywords).toEqual({
      title: '"Chapter President" OR "Group Leader"',
    });
  });

  it("reports nothing dropped when the profile asked for nothing classic lacks", async () => {
    const { provider } = providerWithCapturedBody({ ireland: { id: "104738515", title: "Ireland" } });

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["Founder"], geographies: ["Ireland"] },
      tier: "classic",
    });

    // An empty list is what the campaign page checks; a notice on every
    // campaign would train people to ignore the one that matters.
    expect(page.droppedFilters).toEqual([]);
    expect(page.filterNotes).toEqual([]);
  });
});
