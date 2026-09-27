import { describe, expect, it } from "vitest";
import { loadBusinessProfile, listBusinessProfiles } from "../src/business.js";
import type { Db } from "../src/client.js";

/**
 * A workspace running more than one business.
 *
 * The schema has allowed this since migration 0001 — `business_profiles` is
 * one-to-many on `workspace_id` and `customer_profiles` carries a
 * `business_profile_id`. The code did not. Five places resolved "the" business
 * with `order by created_at desc limit 1`, so the writers would have produced
 * copy for whichever business was newest, and a sixth used `maybeSingle()`,
 * which answers PGRST116 for more than one row — the agent test would have
 * stopped working outright on the second business.
 */

/** Enough of the client for these two queries, and honest about the rest. */
function fakeDb(rows: Array<Record<string, unknown>>): Db {
  const api = (filters: Record<string, unknown>, order?: { asc: boolean }, take?: number) => {
    const run = () => {
      let out = rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      if (order) out = [...out].sort((a, b) =>
        order.asc
          ? String(a.created_at).localeCompare(String(b.created_at))
          : String(b.created_at).localeCompare(String(a.created_at)));
      // `limit` is honoured, or `.limit(1).maybeSingle()` looks like an
      // error the real client never raises — a fake that cannot be
      // faithful must throw, not invent a failure (see fake-db.ts).
      return take === undefined ? out : out.slice(0, take);
    };
    const self: Record<string, unknown> = {
      eq: (k: string, v: unknown) => api({ ...filters, [k]: v }, order, take),
      order: (_c: string, o: { ascending: boolean }) => api(filters, { asc: o.ascending }, take),
      limit: (n: number) => api(filters, order, n),
      maybeSingle: async () => {
        const out = run();
        // The real client errors on more than one row; anything relying on
        // that behaviour must fail here too or the test proves nothing.
        if (out.length > 1) throw new Error("PGRST116: multiple rows returned");
        return { data: out[0] ?? null };
      },
      then: (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: run() }),
    };
    return self;
  };
  return { from: () => ({ select: () => api({}) }) } as unknown as Db;
}

const WS = "ws-1";
const rows = [
  { id: "b-old", workspace_id: WS, created_at: "2026-01-01T00:00:00Z", spec: { companyName: "Cleaning" } },
  { id: "b-new", workspace_id: WS, created_at: "2026-06-01T00:00:00Z", spec: { companyName: "Real estate" } },
  { id: "b-other", workspace_id: "ws-2", created_at: "2026-03-01T00:00:00Z", spec: { companyName: "Someone else" } },
];

describe("loadBusinessProfile", () => {
  it("returns the one asked for", async () => {
    const got = await loadBusinessProfile(fakeDb(rows), WS, "b-new");
    expect(got?.id).toBe("b-new");
  });

  it("never returns another workspace's business, even given its id", async () => {
    // The worker runs as the service role, so RLS will not catch this.
    const got = await loadBusinessProfile(fakeDb(rows), WS, "b-other");
    expect(got?.id).not.toBe("b-other");
  });

  it("falls back to the first business, not the newest", async () => {
    /*
     * The bug this replaced. `order by created_at desc limit 1` means adding a
     * second business silently re-points every workspace-wide writer at it, so
     * the pitches and openers a rep approved last month start being written
     * for a company they added last night.
     */
    const got = await loadBusinessProfile(fakeDb(rows), WS);
    expect(got?.id).toBe("b-old");
  });

  it("does not throw when a workspace has several", async () => {
    // `maybeSingle()` did. The fake raises PGRST116 exactly as PostgREST does,
    // so a regression back to it fails here rather than in production.
    await expect(loadBusinessProfile(fakeDb(rows), WS)).resolves.toBeTruthy();
  });

  it("returns null for a workspace with none", async () => {
    expect(await loadBusinessProfile(fakeDb(rows), "ws-empty")).toBeNull();
  });

  it("lists a workspace's businesses oldest first", async () => {
    const all = await listBusinessProfiles(fakeDb(rows), WS);
    expect(all.map((r) => r.id)).toEqual(["b-old", "b-new"]);
  });
});
