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

  it("never lets the page frame outrank a component", () => {
    /*
     * The bug this catches, and it had every card and two grids in the app.
     *
     * `.app-body > section` is (0,1,1) — one class, one element — and `.card`
     * is (0,1,0). So the frame's `padding-block: 0` beat the card's own
     * `padding` on every card written as a `<section>`: sides intact, top and
     * bottom gone, heading a pixel under the border and button a pixel above
     * it. The same rule's `display: flex` beat `.grid`, so
     * `<section class="grid grid-2">` on Billing and `grid tight grid-4` on
     * Agent spend were flex columns with a column template applying to
     * nothing. Neither rule looks wrong alone; they only collide, which is why
     * reading the stylesheet found nothing and measuring found it at once.
     *
     * Patching each victim with `:not(.card)`, `:not(.grid)` is a list the
     * next component gets left off. So the rule is: when the frame styles a
     * bare element, it wraps its own ancestor in `:where()` and contributes no
     * specificity, and any component that says what it is wins automatically.
     */
    const frame = ["app", "app-body", "app-main", "app-aside"];
    const offenders: string[] = [];

    for (const selector of topLevelSelectors(CSS).flatMap((s) => s.split(","))) {
      const sel = selector.trim();
      if (!sel) continue;
      const compounds = sel.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
      if (compounds.length < 2) continue;

      // Only the rightmost compound decides what the rule lands on. A rule
      // ending in a class is a component styling itself, not the frame
      // reaching in, so it is none of this test's business.
      const key = compounds[compounds.length - 1]!;
      if (!/^[a-zA-Z][\w-]*$/.test(key)) continue;

      const ancestors = compounds.slice(0, -1);
      const isFrame = ancestors.every((c) => {
        const inner = c.replace(/^:where\(([^)]*)\)$/, "$1");
        const classes = (inner.match(/\.[\w-]+/g) ?? []).map((x) => x.slice(1));
        return classes.length > 0 && classes.every((x) => frame.includes(x));
      });
      if (!isFrame) continue;

      // Anything outside `:where()` still counts towards specificity.
      const counted = sel.replace(/:where\([^)]*\)/g, "");
      if ((counted.match(/\.[\w-]+/g) ?? []).length > 0) offenders.push(sel);
    }

    expect(
      offenders,
      "the frame styles a bare element and outranks every class on it — wrap the ancestor in :where()",
    ).toEqual([]);
  });

  it("never writes a stack utility that does nothing", () => {
    /*
     * `.stack-2` and `.card` are both one class, so source order decides and
     * `.card` is written later. `<li className="card stack-2">` therefore asks
     * for an 8px gap and renders the card's 16px, with the class sitting in
     * the markup reading as though it applied. Seventeen elements were written
     * that way across the app and the marketing site.
     *
     * A utility that silently loses is worse than no utility: it tells the
     * next person the spacing on that element is settled and explains a
     * measurement that is not what they see. So either it applies or it is not
     * written, and that is what this checks. Where the two agree — `.card
     * stack-4`, both `--space-4` — nothing is wrong and nothing is reported.
     *
     * Component against component (`.forecast` over `.card`) is deliberate
     * composition and is not this test's business; scripts/css-collisions.mjs
     * reports those for a human to read.
     */
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

    // Every rule that is only class names and sets a gap, in source order.
    const gapRules: { classes: string[]; value: string; order: number }[] = [];
    for (const m of body.matchAll(/(^|\n)((?:\.[\w-]+)+)\s*\{([^{}]*)\}/g)) {
      const gap = m[3]!.match(/(?:^|;)\s*(?:row-)?gap:\s*([^;]+)/);
      if (!gap) continue;
      gapRules.push({
        classes: m[2]!.split(".").filter(Boolean),
        value: gap[1]!.trim(),
        order: gapRules.length,
      });
    }
    expect(gapRules.length, "no gap rules found — this test would pass vacuously").toBeGreaterThan(
      3,
    );

    const offenders: string[] = [];
    for (const file of pages(join(dirname(fileURLToPath(import.meta.url)), "../src"))) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/className="([^"]+)"/g)) {
        const classes = m[1]!.split(/\s+/).filter(Boolean);
        const stack = classes.find((c) => /^stack-\d$/.test(c));
        if (!stack) continue;

        const applies = gapRules.filter((r) => r.classes.every((c) => classes.includes(c)));
        // More classes is more specific; a tie goes to whichever is written last.
        const winner = applies.reduce<(typeof applies)[number] | null>(
          (a, b) =>
            !a || b.classes.length > a.classes.length ||
            (b.classes.length === a.classes.length && b.order > a.order)
              ? b
              : a,
          null,
        );
        const mine = applies.find((r) => r.classes.length === 1 && r.classes[0] === stack);
        if (!winner || !mine || winner === mine) continue;
        if (winner.value === mine.value) continue; // they agree; nothing is lost
        offenders.push(`${file.split("/src/")[1]}: "${m[1]}" — ${stack} loses to .${winner.classes.join(".")}`);
      }
    }

    expect(offenders, "a stack utility that loses is a measurement the markup does not have").toEqual(
      [],
    );
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
