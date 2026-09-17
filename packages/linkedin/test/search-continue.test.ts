import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";
import { decodeClassicCursor, encodeClassicCursor, isClassicCursor } from "../src/cursor.js";
import type { SearchQuery } from "../src/provider.js";

/**
 * Reading past the first page.
 *
 * Classic search has one keyword box, so a customer profile naming several
 * titles becomes several separate searches — and the merged answer used to come
 * back with `cursor: null`, which is the provider saying "there is no more"
 * about a result set it had barely started. Every run then began at the first
 * page, found the same fifty people, and the deduplication reported all fifty
 * as already known. A campaign was permanently capped at one page, and the
 * product's answer to "we need a thousand prospects" was that there wasn't one.
 */

const QUERY: SearchQuery = {
  titles: ["Head of Operations", "COO"],
  geographies: ["United Kingdom"],
};

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A provider whose searches answer from a script, keyed by the keyword asked
 * with and the cursor it was asked at.
 *
 * `asked` records the request line as well as the body, because the cursor
 * travels in the query string — a test that only inspects bodies cannot tell a
 * continuation from a restart, which is the entire thing under test here.
 */
function scriptedProvider(script: Record<string, { items: unknown[]; cursor: string | null }>) {
  const asked: Array<{ keywords: string; cursor: string | null; limit: string | null }> = [];

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/search/parameters")) {
      const term = new URL(href).searchParams.get("keywords") ?? "";
      return json({
        items: term.trim().toLowerCase() === "united kingdom" ? [{ id: "101165590", title: "United Kingdom" }] : [],
      });
    }
    const params = new URL(href).searchParams;
    const body = JSON.parse(String(init?.body)) as { keywords: string };
    const cursor = params.get("cursor");
    asked.push({ keywords: body.keywords, cursor, limit: params.get("limit") });
    return json(script[`${body.keywords}@${cursor ?? ""}`] ?? { items: [], cursor: null });
  }) as typeof fetch;

  return {
    provider: new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl }),
    asked,
  };
}

const person = (id: string) => ({ provider_id: id, public_identifier: id, first_name: "A", last_name: id });

describe("continuing a classic search", () => {
  it("hands back a position covering every term it asked", async () => {
    const { provider } = scriptedProvider({
      "Head of Operations@": { items: [person("a")], cursor: "ops-2" },
      "COO@": { items: [person("b")], cursor: "coo-2" },
    });

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, limit: 10 });

    expect(page.items.map((p) => p.providerId)).toEqual(["a", "b"]);
    // Not null. Null here is what capped every campaign at one page.
    expect(page.cursor).not.toBeNull();
    expect(decodeClassicCursor(page.cursor)).toEqual({
      round: 0,
      terms: { "Head of Operations": "ops-2", COO: "coo-2" },
    });
  });

  it("resumes each term where it stopped rather than at the first page", async () => {
    const { provider, asked } = scriptedProvider({
      "Head of Operations@ops-2": { items: [person("c")], cursor: "ops-3" },
      "COO@coo-2": { items: [person("d")], cursor: null },
    });
    const cursor = encodeClassicCursor({
      round: 0,
      terms: { "Head of Operations": "ops-2", COO: "coo-2" },
    });

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, limit: 10, cursor: cursor! });

    // The people on the second page, and nobody from the first.
    expect(page.items.map((p) => p.providerId)).toEqual(["c", "d"]);
    expect(asked.map((a) => a.cursor)).toEqual(["ops-2", "coo-2"]);
    // A term the provider gave no cursor for is finished, and leaves the
    // position. Asked again from the start it would return its first page for
    // as long as the campaign runs.
    expect(decodeClassicCursor(page.cursor)).toEqual({ round: 0, terms: { "Head of Operations": "ops-3" } });
  });

  it("moves to the pass without the industry filter when every term runs out", async () => {
    const withIndustry: SearchQuery = { ...QUERY, industries: ["United Kingdom"] };
    const { provider } = scriptedProvider({
      "Head of Operations@": { items: [person("a")], cursor: null },
      "COO@": { items: [person("b")], cursor: null },
    });

    const page = await provider.searchProspects({ accountId: "a1", query: withIndustry, limit: 10 });

    // Not the end of the search: dropping the industry filter is a different
    // query over people the filtered pass could never have returned.
    expect(decodeClassicCursor(page.cursor)).toEqual({
      round: 1,
      terms: { "Head of Operations": "", COO: "" },
    });
  });

  it("says the search is over only when the unfiltered pass runs out", async () => {
    const { provider } = scriptedProvider({
      "Head of Operations@": { items: [person("a")], cursor: null },
      "COO@": { items: [person("b")], cursor: null },
    });

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, limit: 10 });

    // No industries to drop, so there is no further pass and null means null.
    expect(page.cursor).toBeNull();
  });

  it("keeps the place of a term it had no room left to ask", async () => {
    const { provider, asked } = scriptedProvider({
      "Head of Operations@": { items: [person("a"), person("b")], cursor: "ops-2" },
    });

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, limit: 2 });

    expect(asked.map((a) => a.keywords)).toEqual(["Head of Operations"]);
    // COO was never asked, so it still starts at the beginning. Dropping it
    // because this run had no room would step over it for good.
    expect(decodeClassicCursor(page.cursor)).toEqual({
      round: 0,
      terms: { "Head of Operations": "ops-2", COO: "" },
    });
  });

  it("asks each term only for what the page still has room for", async () => {
    const { provider, asked } = scriptedProvider({
      "Head of Operations@": { items: [person("a"), person("b")], cursor: "ops-2" },
      "COO@": { items: [person("c"), person("d"), person("e")], cursor: "coo-2" },
    });

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, limit: 5 });

    expect(asked.map((a) => a.limit)).toEqual(["5", "3"]);
    // Nobody is trimmed off the end. A trimmed person is one whose page has
    // been read and paid for and who the cursor has already moved past.
    expect(page.items).toHaveLength(5);
  });

  it("does not retire a search over a page that came back empty with more to give", async () => {
    const { provider } = scriptedProvider({
      "Head of Operations@ops-2": { items: [], cursor: "ops-3" },
      "COO@coo-2": { items: [], cursor: "coo-3" },
    });
    const cursor = encodeClassicCursor({ round: 0, terms: { "Head of Operations": "ops-2", COO: "coo-2" } })!;

    const page = await provider.searchProspects({ accountId: "a1", query: QUERY, limit: 10, cursor });

    expect(page.items).toHaveLength(0);
    // An empty page is usually the end. A cursor with it is the provider
    // saying otherwise, and calling that the end retires a search that still
    // had people in it — with the campaign screen then hiding the button.
    expect(decodeClassicCursor(page.cursor)).toEqual({
      round: 0,
      terms: { "Head of Operations": "ops-3", COO: "coo-3" },
    });
  });

  it("never sends a classic position to Sales Navigator", async () => {
    const { provider, asked } = scriptedProvider({});
    const cursor = encodeClassicCursor({ round: 0, terms: { COO: "coo-2" } })!;

    await provider.searchProspects({ accountId: "a1", query: QUERY, tier: "sales_navigator", cursor });

    // An account that gains a seat between two runs carries a position
    // describing six separate searches into an API that takes one.
    expect(asked[0]?.cursor).toBeNull();
  });
});

describe("the position itself", () => {
  it("survives a round trip", () => {
    const position = { round: 1, terms: { "Head of Ops": "abc", "COO": "" } };
    expect(decodeClassicCursor(encodeClassicCursor(position))).toEqual(position);
  });

  it("refuses anything it did not write", () => {
    // A Sales Navigator cursor, a column written by an older build, junk.
    expect(decodeClassicCursor("eyJhIjoxfQ")).toBeNull();
    expect(decodeClassicCursor("classic:not-base64-json!!")).toBeNull();
    expect(decodeClassicCursor(null)).toBeNull();
    expect(isClassicCursor("some-provider-cursor")).toBe(false);
  });

  it("refuses a position whose terms are not positions", () => {
    const forged = "classic:" + Buffer.from(JSON.stringify({ round: 0, terms: { a: 7 } })).toString("base64url");
    // Reading it would resume a search at a page number that is not one.
    expect(decodeClassicCursor(forged)).toBeNull();
  });
});
