import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";
import type { SearchQuery } from "../src/provider.js";

/**
 * Which search surface a customer profile is sent to.
 *
 * Sales Navigator is a separate paid seat — around $120 a month, more than
 * everything else in this product's stack combined. Assuming every account has
 * one made the subscription mandatory in practice, and the failure was silent:
 * a search against a tier the account lacks returns nothing, which reads on
 * screen as "your customer profile matched nobody".
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
 */
function providerWithCapturedBody() {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ items: [], cursor: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });
  return { provider, bodies };
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

  it("keeps the filters classic search does have", async () => {
    const { provider, bodies } = providerWithCapturedBody();

    await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "classic" });

    expect(bodies[0]?.title).toEqual({ include: ["Head of Operations"] });
    expect(bodies[0]?.industry).toEqual({ include: ["Software"] });
    expect(bodies[0]?.location).toEqual({ include: ["United Kingdom"] });
    // Seniority survives as a text hint rather than vanishing entirely — worth
    // something, and still reported as dropped because a hint is not a filter.
    expect(bodies[0]?.keywords).toBe("revops Director");
  });

  it("reports nothing dropped when the profile asked for nothing classic lacks", async () => {
    const { provider } = providerWithCapturedBody();

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["Founder"], geographies: ["Ireland"] },
      tier: "classic",
    });

    // An empty list is what the campaign page checks; a notice on every
    // campaign would train people to ignore the one that matters.
    expect(page.droppedFilters).toEqual([]);
  });
});
