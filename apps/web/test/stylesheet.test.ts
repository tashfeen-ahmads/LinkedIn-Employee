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
      expect(CSS, `${rule} must be scoped under .app`).toContain(`.app ${rule} `);
    }
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
