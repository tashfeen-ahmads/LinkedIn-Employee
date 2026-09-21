import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * One definition per class, checked.
 *
 * A class declared twice in one stylesheet is not a duplicate, it is a silent
 * override: the later rule wins on source order and the earlier one stops
 * mattering, on a page nobody edited, invisibly to a diff of that page. This
 * file exists because that happened four times at once —
 *
 *  - `.section` meant "a band of the landing page with 4.5rem of padding" and
 *    was redeclared as the app's flex column, which took that padding off
 *    every section of the marketing site;
 *  - `.chart` meant "a bordered, padded card" and was redeclared as a figure's
 *    layout, so a chart inside a card rendered a box inside a box;
 *  - `.site-footer`, `.wordmark`, `.footer-grid` and `.hero-panel` each had
 *    two definitions, one of which had never applied to anything.
 *
 * That is exactly what somebody sees as "some have a lot of padding, some have
 * none". It is not a series of small mistakes; it is the absence of this
 * check.
 *
 * Grouped selectors are exempt: `h1, h2, h3 { line-height }` followed by
 * `h1 { font-size }` is a scale being built, not a collision.
 */

const cssPath = join(dirname(fileURLToPath(import.meta.url)), "../src/app/globals.css");

/** Top-level rule selectors, ignoring comments and anything inside @media. */
function topLevelSelectors(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  let depth = 0;
  let buffer = "";

  for (const ch of withoutComments) {
    if (ch === "{") {
      if (depth === 0) selectors.push(buffer.trim());
      depth += 1;
      buffer = "";
    } else if (ch === "}") {
      depth -= 1;
      buffer = "";
    } else if (depth === 0) {
      buffer += ch;
    }
  }
  return selectors.filter((s) => s && !s.startsWith("@"));
}

/** Every .tsx under a directory, so the check cannot miss a screen. */
function pages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...pages(path));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

const CSS = readFileSync(cssPath, "utf8");

describe("globals.css", () => {
  it("declares each selector once outside a grouped rule", () => {
    const seen = new Map<string, number>();
    for (const selector of topLevelSelectors(CSS)) {
      // A grouped rule sets what its members share; the individual rules that
      // follow set what differs. Only single-selector rules can collide in the
      // way this test is about.
      if (selector.includes(",")) continue;
      const normalized = selector.split(/\s+/).join(" ");
      seen.set(normalized, (seen.get(normalized) ?? 0) + 1);
    }

    const collisions = [...seen.entries()].filter(([, count]) => count > 1);
    expect(
      collisions.map(([selector, count]) => `${selector} (${count}×)`),
      "a class declared twice is a silent override, not a duplicate",
    ).toEqual([]);
  });

  it("keeps the app's frame scoped to the app", () => {
    // The marketing pages and the application share one stylesheet and two of
    // these names. Unscoped, the app's meaning wins everywhere.
    for (const rule of [".section", ".page-header", ".empty"]) {
      // `.app .section` may be part of a grouped selector — it shares its body
      // with `.app-body > section`, so a bare `<section>` gets the same rhythm
      // as one from the component. The scope is what matters, not the comma.
      expect(CSS, `${rule} must be scoped under .app`).toMatch(
        new RegExp(`\\.app ${rule.replace(".", "\\.")}[\\s,{]`),
      );
    }
  });

  it("makes every class used on a form declare its flex direction", () => {
    /*
     * The bug this catches, precisely.
     *
     * `form { flex-direction: column }` is set globally in this sheet, and a
     * class that only says `display: flex` does not override a direction it
     * never declares. So `<form className="row">` stayed a column, and
     * `align-items: center` then meant horizontally centred — which is how the
     * invitation form became a narrow stack floating in the middle of a very
     * wide card, with no rule anywhere looking wrong.
     *
     * Everywhere else an undeclared direction is fine: `row` is the default.
     * It is only a trap on a `<form>`, so that is what this checks. It has
     * caught two classes now — `.form-row`, then `.row`.
     */
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

    // Every class actually put on a <form> anywhere in the app.
    const used = new Set<string>();
    for (const file of pages(join(dirname(fileURLToPath(import.meta.url)), "../src"))) {
      const source = readFileSync(file, "utf8");
      for (const form of source.matchAll(/<form[^>]*className="([^"]+)"/g)) {
        for (const cls of form[1]!.split(/\s+/)) if (cls) used.add(cls);
      }
    }
    expect(used.size, "no forms found — this test would pass vacuously").toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const cls of used) {
      // A rule declaring this class on its own, at the top level.
      const rule = new RegExp(`(^|\\n)\\.${cls}(\\s*,[^{]*)?\\s*\\{([^{}]*)\\}`);
      const match = body.match(rule);
      if (!match) continue;
      const rules = match[3]!;
      if (!/display:\s*flex/.test(rules)) continue;
      if (!/flex-direction/.test(rules)) offenders.push(`.${cls}`);
    }

    expect(
      offenders,
      "used on a <form>, sets display:flex, never says which direction — so it inherits column",
    ).toEqual([]);
  });

  it("gives a scrolling table a width to scroll to", () => {
    /*
     * `.table-scroll` sets `overflow-x: auto` and `table` sets `width: 100%`,
     * and those two together are a scroll container that never scrolls. The
     * table fits itself to the phone instead: the first column wraps to three
     * lines while `white-space: nowrap` on the headings pushes the last column
     * off the edge anyway. Crushed and clipped at once, which is worse than
     * either. Only a width floor makes the container do its job.
     */
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body, "table { width: 100% } is assumed by this check").toMatch(
      /(^|\n)table\s*\{[^}]*width:\s*100%/,
    );
    expect(
      body,
      "a table inside .table-scroll needs a min-width, or the container only clips",
    ).toMatch(/\.table-scroll table\s*\{[^}]*min-width:/);
  });

  it("hides every group heading in the mobile nav, or none", () => {
    /*
     * The sidebar's groups are headed two ways: the always-open group by a
     * plain `<p class="nav-group-label">`, the collapsible ones by a button
     * that wraps the same class. The mobile bar hid the button — and so hid
     * four headings out of five, opening the scrolling row with the word
     * "Work" and then listing twelve links under nothing at all. A heading on
     * one group out of five is not a heading, it is a stray word.
     */
    const mobile = CSS.slice(CSS.indexOf("@media (max-width: 820px)"));
    const block = mobile.slice(0, mobile.indexOf("\n}\n"));
    const hidesToggle = /\.nav-group-toggle\s*\{[^}]*display:\s*none/.test(block);
    const hidesLabel = /\.nav-group-label\s*\{[^}]*display:\s*none/.test(block);
    expect(hidesToggle, "the 820px block is expected to flatten the groups").toBe(true);
    expect(hidesLabel, "hiding the toggle leaves the always-open group's heading behind").toBe(
      true,
    );
  });

  it("never sets a colour outside a token", () => {
    // Every colour has to be swappable for dark mode in one place. A literal
    // in a component rule is a colour that only works on one ground.
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const afterTokens = body.slice(body.indexOf("--------- buttons"));
    const literals = afterTokens.match(/:\s*#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(literals, "colours belong in the token block at the top").toEqual([]);
  });
});
