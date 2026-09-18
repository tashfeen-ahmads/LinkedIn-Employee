import { describe, expect, it } from "vitest";
import { MAX_PAGES, PAGE_SIZE, fetchAllRows } from "../src/paging.js";

/**
 * The cap that used to be silent.
 *
 * These live beside the code rather than in the web app that first needed it:
 * `@le/web` resolves `@le/db` through its built `dist/`, so a test there proves
 * nothing about the source a mutation would break — it would pass against the
 * last build whatever the source said.
 *
 * PostgREST returns at most 1000 rows and reports the fact nowhere. Every
 * funnel in this product counts rows in the application tier, so a workspace
 * past that number was reading a dashboard that had quietly stopped counting —
 * and `Find more` plus rule 24's permanent prospect history make crossing it a
 * matter of weeks.
 */

function pagedSource(total: number) {
  const seen: [number, number][] = [];
  const query = async (from: number, to: number) => {
    seen.push([from, to]);
    const rows = [];
    for (let i = from; i <= Math.min(to, total - 1); i += 1) rows.push({ id: i });
    return { data: rows, error: null };
  };
  return { query, seen };
}

describe("fetchAllRows", () => {
  it("returns everything past the first page", async () => {
    const { query } = pagedSource(PAGE_SIZE + 37);
    const { rows, truncated } = await fetchAllRows(query);
    expect(rows).toHaveLength(PAGE_SIZE + 37);
    expect(truncated).toBe(false);
  });

  it("asks for one more page when the last was exactly full", async () => {
    // A full page might be the end and might not, and being wrong about that is
    // a total that is short by everything after it.
    const { query, seen } = pagedSource(PAGE_SIZE);
    const { rows } = await fetchAllRows(query);
    expect(rows).toHaveLength(PAGE_SIZE);
    expect(seen).toHaveLength(2);
  });

  it("stops after one request when there is less than a page", async () => {
    const { query, seen } = pagedSource(12);
    const { rows } = await fetchAllRows(query);
    expect(rows).toHaveLength(12);
    expect(seen).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it("handles an empty table without a second request", async () => {
    const { query, seen } = pagedSource(0);
    const { rows, truncated } = await fetchAllRows(query);
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it("says so when it gave up rather than presenting a partial count", async () => {
    // The whole point: a number that stopped counting has to admit it. This is
    // the behaviour the raw 1000-row cap did not have.
    const { query } = pagedSource(PAGE_SIZE * (MAX_PAGES + 2));
    const { rows, truncated } = await fetchAllRows(query);
    expect(truncated).toBe(true);
    expect(rows).toHaveLength(PAGE_SIZE * MAX_PAGES);
  });

  it("raises rather than silently returning a short list on an error", async () => {
    // Swallowing this would report a database failure as "you have no
    // prospects", which is the same sentence as a working empty workspace.
    await expect(
      fetchAllRows(async () => ({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });

  it("asks for non-overlapping ranges", async () => {
    const { query, seen } = pagedSource(PAGE_SIZE * 2 + 1);
    await fetchAllRows(query);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i][0]).toBe(seen[i - 1][1] + 1);
    }
  });
});
