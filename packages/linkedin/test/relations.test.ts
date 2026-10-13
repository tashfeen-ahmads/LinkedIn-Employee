import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";

/**
 * The connections the acceptance poll reads.
 *
 * One page of a hundred was the whole answer, so an account that gained more
 * than a hundred connections since the oldest outstanding invitation never saw
 * the older acceptances, and those prospects' follow-ups never sent.
 */
function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function relation(n: number, createdAt: string) {
  return { member_id: `m${n}`, created_at: createdAt };
}

function pagedProvider(pages: Record<string, { items: unknown[]; cursor: string | null }>) {
  const asked: Array<string | null> = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const cursor = new URL(String(url)).searchParams.get("cursor");
    asked.push(cursor);
    return json(pages[cursor ?? ""] ?? { items: [], cursor: null });
  }) as typeof fetch;
  return { provider: new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl }), asked };
}

const page = (from: number, count: number, createdAt: string) =>
  Array.from({ length: count }, (_, i) => relation(from + i, createdAt));

describe("listRelations", () => {
  it("follows the cursor past the first hundred", async () => {
    const { provider, asked } = pagedProvider({
      "": { items: page(0, 100, "2026-10-10T00:00:00Z"), cursor: "p2" },
      p2: { items: page(100, 40, "2026-10-09T00:00:00Z"), cursor: null },
    });

    const relations = await provider.listRelations({ accountId: "acct", since: "2026-10-01T00:00:00Z" });

    expect(asked).toEqual([null, "p2"]);
    expect(relations).toHaveLength(140);
    expect(relations.some((r) => r.providerId === "m139")).toBe(true);
  });

  it("stops at the first page that reaches past `since`", async () => {
    const { provider, asked } = pagedProvider({
      "": { items: [...page(0, 50, "2026-10-10T00:00:00Z"), ...page(50, 50, "2026-09-01T00:00:00Z")], cursor: "p2" },
      p2: { items: page(100, 100, "2026-08-01T00:00:00Z"), cursor: "p3" },
    });

    const relations = await provider.listRelations({ accountId: "acct", since: "2026-10-01T00:00:00Z" });

    expect(asked).toEqual([null]);
    expect(relations).toHaveLength(50);
  });

  it("is bounded however long the cursor chain", async () => {
    const pages: Record<string, { items: unknown[]; cursor: string | null }> = {};
    for (let i = 0; i < 50; i++) {
      pages[i === 0 ? "" : `p${i}`] = { items: page(i * 100, 100, "2026-10-10T00:00:00Z"), cursor: `p${i + 1}` };
    }
    const { provider, asked } = pagedProvider(pages);

    await provider.listRelations({ accountId: "acct", since: "2026-10-01T00:00:00Z" });

    expect(asked.length).toBeLessThanOrEqual(5);
  });
});
