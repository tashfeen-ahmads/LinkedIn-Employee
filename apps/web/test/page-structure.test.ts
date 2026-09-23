import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One heading hierarchy, checked rather than agreed.
 *
 * Seven screens had two or three `<h1>`s and nine of sixteen wrapped their
 * title in `page-head` while the rest did something else — which is what a
 * person sees as "a title, a mini title and a title under the title". It is
 * not a styling problem: a page with three h1s has no heading, because nothing
 * is above anything else.
 *
 * `PageHeader` and `Section` (components/page.tsx) are the only places those
 * levels may appear, so the rhythm is set once. A convention nothing enforces
 * drifts back within a month — this is the enforcement.
 */

const appDir = join(dirname(fileURLToPath(import.meta.url)), "../src/app/app");

function pages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...pages(path));
    else if (entry.name === "page.tsx") found.push(path);
  }
  return found;
}

const PAGES = pages(appDir);
const relative = (p: string) => p.slice(appDir.length + 1);

describe("application page structure", () => {
  it("finds the pages", () => {
    // Otherwise every assertion below passes over an empty list, which is the
    // failure mode of every test that iterates something it built itself.
    expect(PAGES.length).toBeGreaterThanOrEqual(15);
  });

  it("never hand-rolls an h1", () => {
    for (const page of PAGES) {
      const source = readFileSync(page, "utf8");
      expect(source, `${relative(page)} writes its own <h1>`).not.toMatch(/<h1[\s>]/);
    }
  });

  it("gives every page exactly one PageHeader", () => {
    for (const page of PAGES) {
      const source = readFileSync(page, "utf8");
      /*
       * A page that only redirects has no header because it has no content.
       * Team and billing are sections of the profile screen now, and these
       * routes exist so that every link, bookmark and email that pointed at
       * them still lands somewhere sensible.
       */
      if (/^\s*redirect\(/m.test(source) && !source.includes("return (")) continue;
      const used = source.match(/<PageHeader\b/g) ?? [];
      // More than one is allowed only where a page returns early — a loading
      // or empty branch and the real one — because only one ever renders. Zero
      // is not: a page with no header has no name on it.
      expect(used.length, `${relative(page)} has no PageHeader`).toBeGreaterThan(0);
    }
  });

  it("leaves no page still using the old ad-hoc header", () => {
    for (const page of PAGES) {
      const source = readFileSync(page, "utf8");
      expect(source, `${relative(page)} still uses page-head`).not.toContain('className="page-head"');
    }
  });

  it("keeps the heading levels the components own", () => {
    // h2 belongs to Section and h3 to a card inside one. An h4 in an app page
    // is a fourth level on a three-level scale, which is where "titles under
    // titles" starts.
    for (const page of PAGES) {
      const source = readFileSync(page, "utf8");
      expect(source, `${relative(page)} uses an h4`).not.toMatch(/<h4[\s>]/);
    }
  });
});
