import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Counts that silently stopped at a thousand, and an approval nobody checked.
 *
 * PostgREST answers a plain select with at most a thousand rows and says
 * nothing about the rest. Prospects and Strategies each counted people per
 * strategy from one such select, so past a thousand prospects every tab and
 * every "found" figure stopped growing while the header beside it kept going.
 */
const read = (path: string) => readFileSync(join(__dirname, "../src/app/app", path), "utf8");

describe("per-strategy counts", () => {
  it("pages the prospects list's strategy tabs", () => {
    expect(read("prospects/page.tsx")).toMatch(/fetchAllRows<\{ customer_profile_id: string \| null \}>/);
  });

  it("pages the strategy page's yield", () => {
    expect(read("strategy/page.tsx")).toMatch(/fetchAllRows<\{ customer_profile_id: string \| null; last_contacted_at/);
  });
});

describe("approving a strategy", () => {
  it("checks the approval landed before it says so or starts a search", () => {
    const page = read("strategy/page.tsx");
    const action = page.slice(page.indexOf("async function approveProfile"), page.indexOf("async function dropProfile"));
    // The shared approval checks the rows it changed...
    const shared = readFileSync(join(__dirname, "..", "src", "lib", "approve.ts"), "utf8");
    expect(shared).toMatch(/approved_at: new Date\(\)\.toISOString\(\),\s*do_not_pursue: false,[\s\S]{0,120}?\}\)[\s\S]{0,120}?\.select\("id"\)/);
    expect(shared).toMatch(/if \(error \|\| !rows\?\.length\) \{/);
    // ...and the page stops on a refusal before it searches.
    const guard = action.indexOf("if (!approved.ok)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(action.indexOf("queueSearch("));
  });
});

describe("people found per strategy", () => {
  it("is counted on the overview from prospects, as the Strategy page counts it", () => {
    // It added up campaign rows, so the overview and the Strategy page gave
    // two different "prospects" figures for the same strategy.
    const overview = read("page.tsx");
    expect(overview).toMatch(/fetchAllRows<\{ customer_profile_id: string \| null \}>/);
    expect(overview).not.toMatch(/rowsByCampaign\.get\(campaign\.id\)\?\.length/);
  });
});
