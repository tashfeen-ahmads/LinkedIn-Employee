import { describe, expect, it } from "vitest";
import {
  CLASSIC_TITLES_OR_KEYWORDS_NOTE,
  SALES_NAVIGATOR_PARTIAL_NOTE,
  SALES_NAVIGATOR_REFUSED_NOTE,
  UnipileProvider,
  isSalesNavigatorFallbackNote,
  readSalesNavigatorCursor,
  salesNavigatorHeadcounts,
  salesNavigatorSeniorities,
} from "../src/unipile.js";
import { SEARCH_FILTERS, type SearchQuery } from "../src/provider.js";
import { isPublicProfileUrl } from "@le/shared";

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
    // One result, so the widening ladder never starts: these tests are about
    // what the first request looks like, and an empty answer would send the
    // provider off asking three more questions.
    return json({ items: [{ provider_id: "p1", public_identifier: "jane" }], cursor: null });
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
    // Sales Navigator's own levels and ranges, never the words the Strategy
    // Agent wrote: those had every search on the first live seat refused.
    expect(bodies[0]?.seniority).toEqual({ include: ["director"] });
    expect(bodies[0]?.company_headcount).toEqual([{ min: 51, max: 200 }]);
    expect(page.droppedFilters).toEqual([]);
  });

  it("sends job titles as Sales Navigator's role filter, never a field it does not have", async () => {
    const { provider, bodies } = providerWithCapturedBody();
    await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "sales_navigator" });
    expect(bodies[0]?.role).toEqual({ include: ["Head of Operations"], exclude: ["Intern"] });
    expect(bodies[0]).not.toHaveProperty("title");
  });

  it("maps seniority words to Sales Navigator's own levels", () => {
    expect(
      salesNavigatorSeniorities(["Owner", "Founder", "Partner", "CXO", "VP", "Vice President", "Director", "Mystery"]),
    ).toEqual(["owner/partner", "cxo", "vice_president", "director"]);
    // "Vice President" contains "president" and "Entry Level Manager" contains
    // "manager": the narrower level has to win.
    expect(salesNavigatorSeniorities(["Vice President"])).toEqual(["vice_president"]);
    expect(salesNavigatorSeniorities(["Entry Level Manager"])).toEqual(["entry_level_manager"]);
    expect(salesNavigatorSeniorities(["Senior Manager", "Senior"])).toEqual(["experienced_manager", "senior"]);
  });

  it("snaps company sizes to Sales Navigator's buckets", () => {
    expect(salesNavigatorHeadcounts(["1-10", "1,001-5,000", "10,000+", "small"])).toEqual([
      { min: 1, max: 10 },
      { min: 1001, max: 5000 },
      { min: 10001 },
    ]);
    // A range of the Strategy Agent's own is the buckets it covers, and an
    // edge it shares with a bucket by one number does not pull that bucket in.
    expect(salesNavigatorHeadcounts(["10-50"])).toEqual([{ min: 11, max: 50 }]);
    expect(salesNavigatorHeadcounts(["20-300 employees"])).toEqual([
      { min: 11, max: 50 },
      { min: 51, max: 200 },
      { min: 201, max: 500 },
    ]);
  });

  it("names seniority and size as dropped when none of the words can be sent", async () => {
    const { provider, bodies } = providerWithCapturedBody();
    const page = await provider.searchProspects({
      accountId: "a1",
      query: { ...QUERY, seniorities: ["Mystery"], companyHeadcount: ["small"] },
      tier: "sales_navigator",
    });
    expect(bodies[0]?.seniority).toBeUndefined();
    expect(bodies[0]?.company_headcount).toBeUndefined();
    expect(page.droppedFilters).toEqual(["seniority", "company size"]);
  });

  it("names the words it left out when only some of them can be sent", async () => {
    const { provider, bodies } = providerWithCapturedBody();
    const page = await provider.searchProspects({
      accountId: "a1",
      query: { ...QUERY, seniorities: ["Director", "Board Member"], companyHeadcount: ["51-200", "mid-market"] },
      tier: "sales_navigator",
    });
    expect(bodies[0]?.seniority).toEqual({ include: ["director"] });
    expect(bodies[0]?.company_headcount).toEqual([{ min: 51, max: 200 }]);
    expect(page.droppedFilters).toEqual(['seniority "Board Member"', 'company size "mid-market"']);
  });

  it("falls back to a narrower Sales Navigator search, then to regular search, when refused", async () => {
    const bodies: Record<string, unknown>[] = [];
    let refuse = 2;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/search/parameters")) return json({ items: [] });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.api === "sales_navigator" && refuse-- > 0) {
        return new Response(JSON.stringify({ title: "Invalid parameters" }), { status: 400 });
      }
      return json({ items: [{ provider_id: "p1", public_identifier: "jane" }], cursor: null });
    }) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "sales_navigator" });

    // Full profile, then keywords and location only, then regular search.
    expect(bodies.map((b) => b.api)).toEqual(["sales_navigator", "sales_navigator", "classic", "classic"]);
    expect(bodies[1]?.seniority).toBeUndefined();
    expect(page.items).toHaveLength(1);
    expect(page.filterNotes?.[0]?.startsWith(SALES_NAVIGATOR_REFUSED_NOTE)).toBe(true);
    // The note names what regular search actually dropped, and nothing else.
    expect(page.droppedFilters).toEqual(["seniority", "company size", "excluded titles"]);
    expect(page.filterNotes?.[0]).toContain("Seniority, company size and excluded titles were not applied");
    expect(isSalesNavigatorFallbackNote(page.filterNotes![0]!)).toBe(true);
  });

  it("names, after a refusal, only the filters the profile set and the narrower search dropped", async () => {
    let refuse = 1;
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/search/parameters")) {
        const asked = new URL(String(url)).searchParams.get("keywords") ?? "";
        return json({ items: asked === "United Kingdom" ? [{ id: "101165590", title: "United Kingdom" }] : asked === "Software" ? [{ id: "4", title: "Software" }] : [] });
      }
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (refuse-- > 0) return new Response(JSON.stringify({ title: "Invalid parameters" }), { status: 400 });
      return json({ items: [{ provider_id: "p1", public_identifier: "jane" }], cursor: "sn-next" });
    }) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "sales_navigator" });

    expect(bodies[1]).toEqual({
      api: "sales_navigator",
      category: "people",
      keywords: '"Head of Operations"',
      location: { include: ["101165590"] },
    });
    // The industry and keywords were left out too, and the titles became free
    // text rather than a title filter: all of it is said.
    expect(page.droppedFilters).toEqual([
      "job title (searched as keywords)",
      "keywords",
      "seniority",
      "industry",
      "company size",
      "excluded titles",
    ]);
    const note = page.filterNotes?.find(isSalesNavigatorFallbackNote) ?? "";
    expect(note.startsWith(SALES_NAVIGATOR_PARTIAL_NOTE)).toBe(true);
    expect(note).toMatch(/typed in as plain keywords/);
    expect(note).not.toMatch(/searched by title/i);
    expect(note).toMatch(/Keywords, seniority, industry, company size and excluded titles were not applied/);
    expect(note).not.toMatch(/[–—;]|unipile/i);
  });

  it("does not name filters a profile never set when the narrower search answers", async () => {
    let refuse = 1;
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/search/parameters")) return json({ items: [] });
      if (refuse-- > 0) return new Response(JSON.stringify({ title: "Invalid parameters" }), { status: 400 });
      return json({ items: [{ provider_id: "p1", public_identifier: "jane" }], cursor: null });
    }) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { keywords: ["revops"] },
      tier: "sales_navigator",
    });

    expect(page.droppedFilters).toEqual([]);
    expect(page.filterNotes?.find(isSalesNavigatorFallbackNote)).toMatch(/searched by keyword\.$/);
  });

  it("keeps the narrower Sales Navigator list when only the full search is refused", async () => {
    let refuse = 1;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/search/parameters")) return json({ items: [] });
      void init;
      if (refuse-- > 0) return new Response(JSON.stringify({ title: "Invalid parameters" }), { status: 400 });
      return json({ items: [{ provider_id: "p1", public_identifier: "jane" }], cursor: "sn-next" });
    }) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "sales_navigator" });

    // Marked with the search that produced it, so the next run continues that one.
    expect(page.cursor).toBe("sn-partial:sn-next");
    expect(page.filterNotes?.some((n) => n.startsWith(SALES_NAVIGATOR_PARTIAL_NOTE))).toBe(true);
  });

  describe("a Sales Navigator position belongs to the search that produced it", () => {
    function scripted(refuseFull: boolean) {
      const asked: Array<{ body: Record<string, unknown>; cursor: string | null }> = [];
      const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes("/search/parameters")) return json({ items: [] });
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        asked.push({ body, cursor: new URL(String(url)).searchParams.get("cursor") });
        if (refuseFull && body.seniority) {
          return new Response(JSON.stringify({ title: "Invalid parameters" }), { status: 400 });
        }
        return json({ items: [{ provider_id: "p1", public_identifier: "jane" }], cursor: "next" });
      }) as typeof fetch;
      return { provider: new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl }), asked };
    }

    it("resumes the narrower search where it stopped, and never hands its cursor to the full one", async () => {
      const { provider, asked } = scripted(false);
      const page = await provider.searchProspects({
        accountId: "a1",
        query: QUERY,
        tier: "sales_navigator",
        cursor: "sn-partial:page-3",
      });
      expect(asked).toHaveLength(1);
      expect(asked[0]?.body.seniority).toBeUndefined();
      expect(asked[0]?.cursor).toBe("page-3");
      expect(page.cursor).toBe("sn-partial:next");
    });

    it("resumes the full search with its own cursor, and starts the narrower one fresh if refused", async () => {
      const { provider, asked } = scripted(true);
      const page = await provider.searchProspects({
        accountId: "a1",
        query: QUERY,
        tier: "sales_navigator",
        cursor: "sn-full:page-3",
      });
      expect(asked.map((a) => a.cursor)).toEqual(["page-3", null]);
      expect(page.cursor).toBe("sn-partial:next");
    });

    it("reads a cursor stored before positions were marked as the full search's", async () => {
      const { provider, asked } = scripted(false);
      const page = await provider.searchProspects({
        accountId: "a1",
        query: QUERY,
        tier: "sales_navigator",
        cursor: "legacy-cursor",
      });
      expect(asked[0]?.body.seniority).toEqual({ include: ["director"] });
      expect(asked[0]?.cursor).toBe("legacy-cursor");
      expect(page.cursor).toBe("sn-full:next");
    });

    it("tells the attempts apart and leaves a classic position alone", () => {
      expect(readSalesNavigatorCursor("sn-full:abc")).toEqual({ attempt: "full", cursor: "abc" });
      expect(readSalesNavigatorCursor("sn-partial:abc")).toEqual({ attempt: "partial", cursor: "abc" });
      expect(readSalesNavigatorCursor("abc")).toEqual({ attempt: "full", cursor: "abc" });
      expect(readSalesNavigatorCursor("classic:xyz")).toBeNull();
      expect(readSalesNavigatorCursor(null)).toBeNull();
    });
  });

  it("probes only Sales Navigator's fields when asked about Sales Navigator", async () => {
    const { provider, bodies } = providerWithCapturedBody();
    const rows = await provider.probeSearch("a1", { salesNavigator: true });
    // Every probe is a request off a paid seat; the classic ones answer a
    // question nobody asked here.
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every((b) => b.api === "sales_navigator")).toBe(true);
    expect(rows.every((r) => r.label.startsWith("SN "))).toBe(true);
    expect(bodies.some((b) => JSON.stringify(b.seniority) === JSON.stringify({ include: ["owner/partner"] }))).toBe(true);

    const classic = providerWithCapturedBody();
    await classic.provider.probeSearch("a1");
    expect(classic.bodies.every((b) => b.api === "classic")).toBe(true);
  });

  it("does not paper over a provider that failed to answer", async () => {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/search/parameters")) return json({ items: [] });
      return new Response(JSON.stringify({ title: "Service unavailable" }), { status: 503 });
    }) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });
    await expect(
      provider.searchProspects({ accountId: "a1", query: QUERY, tier: "sales_navigator" }),
    ).rejects.toThrow(/503/);
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
    // The screens explaining Sales Navigator read SEARCH_FILTERS. It must
    // name exactly what the search drops, or the website promises otherwise.
    expect(SEARCH_FILTERS.flatMap((f) => (f.classic ? [] : [f.dropped]))).toEqual(page.droppedFilters);
    // Asserted against a body that exists: `bodies[0]?.seniority` is undefined
    // when no request was made at all, which would pass while proving nothing.
    expect(bodies.length).toBeGreaterThan(0);
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
    expect(page.filterNotes).toContain(
      'The industry "Software" was searched as LinkedIn\'s "Software Development".',
    );
  });

  it("leaves out a term LinkedIn does not have, and says so", async () => {
    const { provider, bodies } = providerWithCapturedBody({});

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { geographies: ["Wakanda"], titles: ["Founder"] },
      tier: "classic",
    });

    expect(bodies[0]?.location).toBeUndefined();
    expect(page.filterNotes).toContain(
      'LinkedIn has no location called "Wakanda", so it was left out of the search.',
    );
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
      return json({ items: [{ provider_id: "p1", public_identifier: "jane" }], cursor: null });
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

    // One term per request: the title first, because that is what a customer
    // profile is really about.
    expect(bodies[0]?.keywords).toBe("Head of Operations");
    expect(bodies[0]?.advanced_keywords).toBeUndefined();
    // Second degree only. First-degree connections have already accepted, so
    // inviting one spends the day's allowance on nothing; third-degree
    // profiles come back as "LinkedIn Member" with no name and no address, so
    // nobody can check who they are before a request goes out.
    expect(bodies[0]?.network_distance).toEqual([2]);
  });

  it("never builds a boolean string for the one keyword box", async () => {
    // This used to join terms with OR to avoid space-joining them into an AND.
    // Both are wrong: classic search takes one box of plain text, so a boolean
    // string goes into it literally and matches nobody. The terms are separate
    // requests now.
    const { provider, bodies } = providerWithCapturedBody();

    await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["Chapter President", "Group Leader"], keywords: ["BNI", "Chamber"] },
      tier: "classic",
    });

    expect(bodies.map((b) => b.keywords)).toEqual(["Chapter President", "Group Leader", "BNI", "Chamber"]);
    for (const body of bodies) {
      expect(String(body.keywords)).not.toMatch(/ OR |"/);
    }
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

/**
 * A profile that matches nobody because it was asked as one conjunction.
 *
 * Titles AND keywords AND industries AND countries is a query almost nobody on
 * LinkedIn satisfies. The first live campaign asked for eight titles, five
 * keywords, three industries and two countries and matched zero people — which
 * read on screen as "your customer profile is wrong" when the profile was fine
 * and the query was unsatisfiable.
 */
function providerWithResults(pages: Array<Array<Record<string, unknown>>>) {
  const bodies: Record<string, unknown>[] = [];
  let call = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/search/parameters")) {
      const asked = new URL(String(url)).searchParams.get("keywords") ?? "";
      return json({ items: [{ id: `id_${asked}`, title: asked }] });
    }
    bodies.push(JSON.parse(String(init?.body)));
    return json({ items: pages[call++] ?? [], cursor: null });
  }) as typeof fetch;
  const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });
  return { provider, bodies };
}

const person = { provider_id: "p1", public_identifier: "jane", first_name: "Jane", last_name: "Doe" };

describe("a classic search that finds nobody", () => {
  it("asks one keyword at a time, because that is what the box takes", async () => {
    // The bug this replaces: eight titles joined with OR went into LinkedIn's
    // single keyword box literally and matched nobody, at every width the
    // widening ladder could reach.
    const { provider, bodies } = providerWithResults([[person]]);

    await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["Chapter President", "Group Leader"], geographies: ["United Kingdom"] },
      tier: "classic",
    });

    expect(bodies.map((b) => b.keywords)).toEqual(["Chapter President", "Group Leader"]);
    for (const body of bodies) expect(String(body.keywords)).not.toMatch(/ OR /);
  });

  it("merges the answers and drops anyone who appears twice", async () => {
    const { provider } = providerWithResults([[person], [person, { ...person, provider_id: "p2" }]]);

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["A", "B"], geographies: ["United Kingdom"] },
      tier: "classic",
    });

    expect(page.items.map((p) => p.providerId)).toEqual(["p1", "p2"]);
  });

  it("drops the industry filter and asks again when every term found nobody", async () => {
    const { provider, bodies } = providerWithResults([[], [], [person]]);

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["A", "B"], industries: ["Software"], geographies: ["United Kingdom"] },
      tier: "classic",
    });

    expect(page.items).toHaveLength(1);
    expect(bodies.slice(0, 2).every((b) => b.industry)).toBe(true);
    expect(bodies[2]?.industry).toBeUndefined();
    expect(page.filterNotes?.some((n) => /industry filter was dropped/i.test(n))).toBe(true);
  });

  it("never gives up the location, at any stage", async () => {
    // A campaign that quietly starts messaging another continent is worse than
    // one that finds nobody.
    const { provider, bodies } = providerWithResults([[], [], [], []]);

    await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["A", "B"], industries: ["Software"], geographies: ["United Kingdom"] },
      tier: "classic",
    });

    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.location).toBeTruthy();
  });

  it("says the list was built from several searches", async () => {
    // Rule 12: a list broader than the profile asked for is fine, a reviewer
    // being told it is the one they approved is not.
    const { provider } = providerWithResults([[person]]);

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["A", "B"], geographies: ["United Kingdom"] },
      tier: "classic",
    });

    expect(page.filterNotes?.some((n) => /separate queries/i.test(n))).toBe(true);
  });

  it("does not split a Sales Navigator search", async () => {
    // That tier takes the whole profile as one structured query, which is what
    // the seat is for.
    const { provider, bodies } = providerWithResults([[person]]);

    await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["A", "B"], geographies: ["United Kingdom"] },
      tier: "sales_navigator",
    });

    expect(bodies).toHaveLength(1);
  });

  it("says titles and keywords were an either-or, not an and", async () => {
    // Each term is its own request and the answers are merged, so a profile
    // asking for a title AND a keyword got people matching either. The
    // mechanics are right for classic; leaving the reviewer to believe the
    // narrower query is not.
    const { provider } = providerWithResults([[person]]);

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["Founder"], keywords: ["revops"], geographies: ["United Kingdom"] },
      tier: "classic",
    });

    expect(page.items).toHaveLength(1);
    expect(page.filterNotes).toContain(CLASSIC_TITLES_OR_KEYWORDS_NOTE);
    expect(CLASSIC_TITLES_OR_KEYWORDS_NOTE).not.toMatch(/[–—]/);
  });

  it("does not say so when only titles were searched", async () => {
    const { provider } = providerWithResults([[person]]);

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["Founder", "CEO"], geographies: ["United Kingdom"] },
      tier: "classic",
    });

    expect(page.filterNotes).not.toContain(CLASSIC_TITLES_OR_KEYWORDS_NOTE);
  });

  it("never sends seniority on classic, and reports it dropped", async () => {
    const { provider, bodies } = providerWithResults([[person]]);

    const page = await provider.searchProspects({
      accountId: "a1",
      query: { titles: ["Founder"], seniorities: ["Director"], geographies: ["United Kingdom"] },
      tier: "classic",
    });

    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(String(body.keywords)).not.toMatch(/Director/);
      expect(body.seniority).toBeUndefined();
    }
    expect(page.droppedFilters).toContain("seniority");
  });
});

/**
 * What a real prospect looks like by the time it reaches a screen.
 *
 * Fourteen genuine people — a membership director at a chamber of commerce, a
 * chapter president — were reported as fake by the person reviewing them,
 * because every name rendered blank and half the profile links returned 404.
 * Both were this parser.
 */
describe("reading a prospect out of a search result", () => {
  async function candidateFrom(raw: Record<string, unknown>) {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/search/parameters")) return json({ items: [] });
      return json({ items: [raw], cursor: null });
    }) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });
    const page = await provider.searchProspects({ accountId: "a1", query: { titles: ["x"] }, tier: "classic" });
    return page.items[0]!;
  }

  it("takes the name from the one field a search result carries", async () => {
    // Search returns `name`; only the profile endpoint splits it. Reading only
    // the split pair left every card blank.
    const c = await candidateFrom({ provider_id: "ACoAAB1", name: "Jane Doe", headline: "Membership Director" });

    expect(c.firstName).toBe("Jane");
    expect(c.lastName).toBe("Doe");
  });

  it("prefers the split pair when the provider gives one", async () => {
    const c = await candidateFrom({ provider_id: "ACoAAB1", first_name: "Jane", last_name: "Doe", name: "WRONG" });

    expect(c.firstName).toBe("Jane");
  });

  it("keeps a compound surname whole", async () => {
    // Everything after the first space. "Hi Maria" is right where "Hi Maria
    // Del" is not, and the note only ever uses the first name.
    const c = await candidateFrom({ provider_id: "ACoAAB1", name: "Maria Del Carmen Ruiz" });

    expect(c.firstName).toBe("Maria");
    expect(c.lastName).toBe("Del Carmen Ruiz");
  });

  it("uses the real profile address when there is one", async () => {
    const c = await candidateFrom({ provider_id: "ACoAAB1", public_identifier: "jane-doe-123" });

    expect(c.linkedinUrl).toBe("https://www.linkedin.com/in/jane-doe-123");
  });

  it("never pastes a provider id into a profile URL", async () => {
    // `linkedin.com/in/ACoAAB...` is a 404 every time. A rep clicks one during
    // a review and concludes the whole list is invented -- which is exactly
    // what happened.
    const c = await candidateFrom({ provider_id: "ACoAAAin3Y8BodiFKCSaVFp0HRMOtSRZUhbGhoc" });

    expect(c.linkedinUrl).not.toMatch(/\/in\/ACoAAA/i);
    expect(isPublicProfileUrl(c.linkedinUrl)).toBe(false);
  });

  it("still gives an unlisted profile a stable key of its own", async () => {
    // They are real and messageable by provider id; they just have no public
    // address. The key has to be unique or they collide in the prospect table.
    const a = await candidateFrom({ provider_id: "ACoAAB1" });
    const b = await candidateFrom({ provider_id: "ACoAAB2" });

    expect(a.linkedinUrl).not.toBe(b.linkedinUrl);
    expect(a.linkedinUrl).toContain("ACoAAB1");
  });
});

/**
 * What LinkedIn returns for somebody outside your network.
 *
 * `name: "LinkedIn Member"`, and `public_identifier` set to the internal id
 * rather than a vanity slug. Stored as written, that becomes a prospect called
 * LinkedIn Member with a profile link that 404s — and thirty of them in a row
 * is indistinguishable from fabricated data, which is how a list of real people
 * was reported as fake twice.
 */
describe("a profile LinkedIn will not show", () => {
  async function candidateFor(raw: Record<string, unknown>) {
    const fetchImpl = (async (url: string | URL | Request) => {
      if (String(url).includes("/search/parameters")) return json({ items: [] });
      return json({ items: [raw], cursor: null });
    }) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });
    const page = await provider.searchProspects({ accountId: "a1", query: { titles: ["x"] }, tier: "classic" });
    return page.items[0]!;
  }

  it("does not store the placeholder as somebody's name", async () => {
    // A note beginning "Hi LinkedIn" is the failure this prevents.
    const c = await candidateFor({ provider_id: "ACoAAB1", name: "LinkedIn Member" });

    expect(c.firstName).toBe("");
    expect(c.lastName).toBe("");
  });

  it("does not build an address from an internal id dressed as a slug", async () => {
    // `public_identifier` is present and is the provider id, so checking only
    // that it exists produced `/in/ACoAAA...` — a 404 every time.
    const c = await candidateFor({
      provider_id: "ACoAAA33NwIBamI-WW-xVY2wbSYap1MYm99n_cA",
      public_identifier: "ACoAAA33NwIBamI-WW-xVY2wbSYap1MYm99n_cA",
      name: "LinkedIn Member",
    });

    expect(c.linkedinUrl).not.toMatch(/\/in\/ACoAAA/i);
    expect(isPublicProfileUrl(c.linkedinUrl, c.providerId)).toBe(false);
  });

  it("still keeps a real name and slug when LinkedIn gives them", async () => {
    const c = await candidateFor({
      provider_id: "ACoAAB2",
      public_identifier: "terrileib",
      name: "Terri Leib",
    });

    expect(c.firstName).toBe("Terri");
    expect(c.linkedinUrl).toBe("https://www.linkedin.com/in/terrileib");
    expect(isPublicProfileUrl(c.linkedinUrl, c.providerId)).toBe(true);
  });
});
