import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { BRAND, appOrigin, siteOrigin } from "../src/brand.js";

/**
 * A rename is only finished when the old name cannot come back.
 *
 * The product's name lived as a literal in eight shipped files, and the eight
 * were not near one another: the wordmark, the page metadata, three email
 * templates, a calendar file's PRODID, the lead source written into somebody
 * else's CRM, and the line stamped on a booked meeting. Six of eight renamed is
 * a product that introduces itself one way on the screen a customer signed up
 * on and another way on the calendar invitation their prospect opens — and
 * nothing anywhere would say so, because each of those surfaces is only ever
 * looked at by a different person.
 *
 * So the check is a grep over the shipped source, in the same spirit as the
 * one that greps every enqueue for a hand-written job id: the bug was never in
 * a function, it was in the call sites, and a unit test of the constant would
 * pass throughout.
 */
const SHIPPED = ["apps/web/src", "apps/worker/src", "packages"];

function grepShipped(pattern: string): string[] {
  try {
    const out = execFileSync(
      "git",
      ["grep", "-n", "--fixed-strings", pattern, "--", ...SHIPPED],
      { cwd: new URL("../../..", import.meta.url).pathname, encoding: "utf8" },
    );
    return out
      .split("\n")
      .filter(Boolean)
      // dist/ is build output: it carries whatever src said at the last build,
      // so failing on it would report a stale artefact as a source problem.
      .filter((line) => !line.includes("/dist/"))
      // This file names the old brand on purpose, to ban it.
      .filter((line) => !line.startsWith("packages/shared/test/brand.test.ts"))
      // A migration that has already run is a record of what happened, not a
      // surface anybody reads. Editing one to tidy a comment is how a
      // checksum stops matching and a deploy refuses to run.
      .filter((line) => !line.startsWith("packages/db/supabase/migrations/"));
  } catch {
    // git grep exits 1 when it matches nothing, which is the passing case.
    return [];
  }
}

describe("the brand has one definition", () => {
  it("has no trace of the old product name in anything that ships", () => {
    expect(grepShipped("LinkedIn Employee")).toEqual([]);
  });

  it("has no trace of the old preview host, which is now nobody's canonical", () => {
    // It was the fallback for every canonical URL, OG image and sitemap entry.
    // Left behind, a production page tells search engines it lives somewhere
    // else — which is the one SEO mistake that is hard to see and slow to undo.
    expect(grepShipped("lnkdn-agentic-employees")).toEqual([]);
  });

  it("keeps the two hosts apart", () => {
    // One host for both would mean every app page also answering on the
    // marketing domain: the same screen on two URLs, and a session cookie on
    // whichever one the person happened to arrive at.
    expect(BRAND.app).not.toBe(BRAND.site);
    expect(new URL(BRAND.app).hostname.endsWith(new URL(BRAND.site).hostname)).toBe(true);
  });

  it("lets a preview deploy be canonical to itself", () => {
    expect(siteOrigin("https://preview--nora.netlify.app/")).toBe("https://preview--nora.netlify.app");
    expect(appOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("falls back to production rather than to nothing", () => {
    expect(siteOrigin(undefined)).toBe(BRAND.site);
    expect(appOrigin(undefined)).toBe(BRAND.app);
  });

  it("is the name the wordmark renders", () => {
    // The wordmark is the one place the name is split for typesetting, so it is
    // the one place a rename can leave half the old name behind.
    const logo = readFileSync(new URL("../../../apps/web/src/components/logo.tsx", import.meta.url), "utf8");
    expect(logo).toContain("BRAND.name");
  });
});
