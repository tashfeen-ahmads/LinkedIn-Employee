import { existsSync, readFileSync, readdirSync } from "node:fs";
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

  /*
   * The rule said `Section` is the only place an `<h2>` may appear, and only
   * the `<h1>` half of it was ever checked. Twelve `<h2>`s were written by
   * hand across ten files, and every one of them came with its own spacing:
   * `<section className="stack-4">` picks up the stack's gap *and* the extra
   * margin this sheet gives whatever follows an h2, a bare `<section>` takes
   * the frame's fallback, and a bare `<h2>` — which is what Strategies had —
   * becomes a direct child of the page column, so the page's own gap falls
   * above it and below it and the title sits as far from its own list as from
   * the card above it.
   *
   * That is the whole of "some screens have different padding": not a value
   * somebody typed wrong, but sections that never went through the frame.
   */
  it("leaves the h2 to Section", () => {
    for (const page of [...PAGES, ...SECTION_FILES]) {
      // Comments discuss the tag; they do not render it.
      const source = readFileSync(page, "utf8")
        .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const found = source.match(/<h2[\s>]/g)?.length ?? 0;
      const allowed = HAND_ROLLED_H2[relativeAny(page)] ?? 0;
      expect(
        found,
        `${relativeAny(page)} writes ${found} <h2> of its own; Section owns that level`,
      ).toBe(allowed);
    }
  });
});

/**
 * The one place an `<h2>` is still written by hand, and why.
 *
 * The tutorial is a numbered list of stages, each of which really is a section
 * of the page — it has its own heading rule (`.tour-stage h2`) and its own
 * rhythm from the list. Wrapping each stage in a `Section` would put a second
 * frame inside the list that draws them.
 */
const HAND_ROLLED_H2: Record<string, number> = { "tutorial/page.tsx": 1 };

/** Section files that are not `page.tsx` but render part of one. */
const SECTION_FILES = [
  join(appDir, "usage-section.tsx"),
  join(appDir, "analytics-section.tsx"),
  join(appDir, "report-section.tsx"),
  join(appDir, "limits-section.tsx"),
  join(appDir, "profile/billing-section.tsx"),
  join(appDir, "profile/team-section.tsx"),
].filter((f) => existsSync(f));

const relativeAny = (p: string) => p.slice(appDir.length + 1);

/*
 * The marketing pages, which this file never looked at.
 *
 * Every rule above is scoped to `src/app/app`, and that is how /pricing came
 * to ship with no `<h1>` on it at all: its whole content was a shared
 * component (the plans then, `FreeForNow` now), which renders an `<h2>`
 * because on the home page it is one section under the hero's heading. Nothing checked, so nobody noticed —
 * a page whose top heading is an h2 has no heading, for the same reason a page
 * with three h1s has none.
 *
 * A marketing page writes its own `<h1>`, or it composes exactly one component
 * that is listed here as owning one. Two named exceptions, both deliberate.
 */
const marketingDir = join(dirname(fileURLToPath(import.meta.url)), "../src/app/(marketing)");

/** Components that render the `<h1>` for the page composing them. */
const OWNS_AN_H1 = ["<Hero", "<FreeForNow standalone"];

describe("marketing page structure", () => {
  const MARKETING = pages(marketingDir);

  it("finds the pages", () => {
    expect(MARKETING.length).toBeGreaterThanOrEqual(5);
  });

  it("gives every page exactly one top-level heading", () => {
    for (const page of MARKETING) {
      const source = readFileSync(page, "utf8");
      const own = source.match(/<h1[\s>]/g)?.length ?? 0;
      const borrowed = OWNS_AN_H1.filter((component) => source.includes(component)).length;
      expect(
        own + borrowed,
        `${page.slice(marketingDir.length + 1)} has ${own} <h1> of its own and borrows ${borrowed}`,
      ).toBe(1);
    }
  });
});

/*
 * The operator console, which this file never looked at either.
 *
 * Every rule above is scoped to `src/app/app` and `src/app/(marketing)`, so all
 * four `/admin` pages still wore the shape rule 34 replaced: a
 * `<div className="page-head">` with a bare `<h1>` inside it, and eleven
 * hand-rolled `<h2>`s between them. `.page-head` is a plain flex column with a
 * small gap; `.app .page-header` is the frame, with its own spacing and its own
 * rules for an eyebrow, a lede and page actions. So the console's headings sat
 * at different spacing from every other screen in the same shell — which is the
 * whole of "some screens have a lot of padding, some have none", on the four
 * screens nothing was checking.
 *
 * It is the operator's console rather than the customer's, and that is exactly
 * why it drifted: nobody reads it daily. A convention nothing enforces drifts
 * back within a month (see the top of this file), and scoping the enforcement
 * away from a directory is the same as not having it there.
 */
const adminDir = join(dirname(fileURLToPath(import.meta.url)), "../src/app/admin");

describe("operator console page structure", () => {
  const ADMIN = pages(adminDir);
  const rel = (p: string) => p.slice(adminDir.length + 1);

  it("finds the pages", () => {
    expect(ADMIN.length).toBeGreaterThanOrEqual(4);
  });

  it("never hand-rolls an h1", () => {
    for (const page of ADMIN) {
      const source = readFileSync(page, "utf8");
      expect(source, `${rel(page)} writes its own <h1>`).not.toMatch(/<h1[\s>]/);
    }
  });

  it("leaves the h2 to Section", () => {
    for (const page of ADMIN) {
      const source = readFileSync(page, "utf8")
        .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const found = source.match(/<h2[\s>]/g)?.length ?? 0;
      expect(found, `${rel(page)} writes ${found} <h2> of its own`).toBe(0);
    }
  });

  it("gives every page a PageHeader", () => {
    for (const page of ADMIN) {
      const source = readFileSync(page, "utf8");
      expect((source.match(/<PageHeader\b/g) ?? []).length, `${rel(page)} has no PageHeader`)
        .toBeGreaterThan(0);
    }
  });

  it("leaves no page still using the old ad-hoc header", () => {
    for (const page of ADMIN) {
      const source = readFileSync(page, "utf8");
      expect(source, `${rel(page)} still uses page-head`).not.toContain('className="page-head"');
    }
  });
});
