import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The marketing pages and the product are one Next.js app on two hosts, and
 * the split only holds if the links respect it.
 *
 * A relative `/login` on a marketing page resolves against the marketing host.
 * The redirects in `netlify.toml` do catch it, but a redirect is a hop
 * somebody waits through, and on anything carrying a query string or a hash —
 * an invite token, the fragment Supabase returns a session in — it is worse
 * than a hop. So the links are absolute in the source, and the redirects are
 * the backstop for bookmarks and old links rather than the mechanism.
 *
 * Checked over the files rather than over a rendered page, because the failure
 * is one link on one of eight surfaces: a rendering test would have to visit
 * every page to see it, and the one it skipped is the one that regresses.
 */
const MARKETING = [
  join(import.meta.dirname, "../src/components/marketing.tsx"),
  join(import.meta.dirname, "../src/components/site-nav.tsx"),
  ...walk(join(import.meta.dirname, "../src/app/(marketing)")),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/** Paths that only exist on the app host. */
const APP_ONLY = ["/login", "/signup", "/onboarding", "/app"];

describe("the marketing host never links into the product relatively", () => {
  for (const file of MARKETING) {
    it(`${file.split("/src/").pop()} links to the app absolutely`, () => {
      const source = readFileSync(file, "utf8");
      const offenders = APP_ONLY.filter((path) => source.includes(`href="${path}"`));
      expect(offenders).toEqual([]);
    });
  }

  it("is checking files that exist", () => {
    // A walk that silently found nothing would pass every assertion above.
    expect(MARKETING.length).toBeGreaterThan(4);
  });
});
