import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const charts = readFileSync(join(here, "../src/components/charts.tsx"), "utf8");
const css = readFileSync(join(here, "../src/app/globals.css"), "utf8");

/**
 * An axis that never prints the same number twice.
 *
 * `StackedDays` draws a top, a midpoint and a baseline. With a top of 1 the
 * midpoint is `Math.round(1 * 0.5)` = 1, so the chart printed "1 / 1 / 0" —
 * the same value on two lines at different heights, one of them claiming a
 * number it is not at. That is the state the chart is in on the day somebody
 * first looks at it, because a campaign that has sent one invitation peaks at
 * exactly 1.
 */
describe("the bar chart's scale", () => {
  it("never labels two gridlines with the same number", () => {
    // The real function, lifted rather than re-implemented: a copy here could
    // agree with itself while the component drew something else.
    const source = /function niceCeiling\(peak: number\): number \{[\s\S]*?\n\}/.exec(charts);
    expect(source, "niceCeiling moved or was renamed").toBeTruthy();
    // The annotations are the only TypeScript in it; stripping them is what
    // lets the real body run here rather than a paraphrase of it.
    const js = source![0].replace("(peak: number): number", "(peak)");
    const niceCeiling = new Function(`${js}; return niceCeiling;`)() as (n: number) => number;

    // The floor the component applies before asking for a ceiling.
    const floor = /niceCeiling\(Math\.max\((\d+), \.\.\.totals\)\)/.exec(charts);
    expect(floor, "the chart no longer floors its peak").toBeTruthy();
    const minimum = Number(floor![1]);

    for (let peak = 0; peak <= 500; peak += 1) {
      const top = niceCeiling(Math.max(minimum, peak));
      const labels = [1, 0.5, 0].map((f) => Math.round(top * f));
      expect(
        new Set(labels).size,
        `peak ${peak} → top ${top} draws ${labels.join(" / ")}`,
      ).toBe(labels.length);
    }
  });
});

/**
 * An axis somebody can read on the phone they are holding.
 *
 * Eight dates is the right number across a laptop and about twice what fits
 * across 390 pixels, where "Sep 15Sep 19Sep 23" ran together into one grey
 * smear on the baseline — which reads as a rendering fault rather than as a
 * scale, and an axis nobody can read is an axis that is not there.
 *
 * Two halves, and both have to hold. The component marks every other labelled
 * column `bars-label-major`; the stylesheet hides the rest below 30em. Either
 * one alone is silent: the class with no rule labels nothing differently, and
 * the rule with no class hides every label on a phone.
 */
describe("the bar chart's axis labels", () => {
  it("thins to a subset of the same columns, never a second set of positions", () => {
    const step = /const step = Math\.max\(1, Math\.ceil\(days\.length \/ (\d+)\)\);/.exec(charts);
    expect(step, "the label step moved or was renamed").toBeTruthy();
    const major = /const major = step \* (\d+);/.exec(charts);
    expect(major, "the phone-width label step moved or was renamed").toBeTruthy();

    // A multiple of the fine step, so every surviving label sits on a column
    // that carries one. Any other factor and the labels that survive on a
    // phone are blank slots.
    const multiple = Number(major![1]);
    expect(Number.isInteger(multiple)).toBe(true);
    expect(multiple).toBeGreaterThan(1);

    // And the class only ever lands on a column the fine step already labels.
    for (let n = 1; n <= 120; n += 1) {
      const fine = Math.max(1, Math.ceil(n / Number(step![1])));
      for (let i = 0; i < n; i += 1) {
        if (i % (fine * multiple) === 0) expect(i % fine, `column ${i} of ${n}`).toBe(0);
      }
    }
  });

  it("marks the surviving labels and hides the rest below 30em", () => {
    expect(charts).toContain('" bars-label-major"');
    const query = /@media \(max-width: 30em\) \{\s*\.bars-label:not\(\.bars-label-major\) \{ visibility: hidden; \}/;
    expect(query.test(css), "the phone-width rule that hides minor labels is gone").toBe(true);
  });

  it("keeps the hidden labels' slots, or the columns shift off their grid", () => {
    // `display: none` would collapse the slot and move every bar. The label
    // row has a fixed height for the same reason.
    expect(css).toMatch(/\.bars-label:not\(\.bars-label-major\) \{ visibility: hidden; \}/);
    expect(css).not.toMatch(/\.bars-label:not\(\.bars-label-major\) \{ display: none/);
  });
});

/**
 * A tooltip that never widens the page.
 *
 * It is laid out whether or not anybody is hovering, so a centred tip on the
 * last column hung thirteen pixels past the document's edge and every screen
 * carrying this chart scrolled sideways on a phone — a whole page shifting
 * under the thumb for a box nobody had asked to see. Clipping it would cut it
 * in half on the one interaction it exists for, so it is anchored inward at
 * the ends instead.
 */
describe("the bar chart's tooltip", () => {
  it("opens inward at both ends of the chart", () => {
    expect(css).toMatch(/\.bars-col:nth-child\(-n \+ 2\) \.bars-tip \{[^}]*left: 0/);
    expect(css).toMatch(/\.bars-col:nth-last-child\(-n \+ 2\) \.bars-tip \{[^}]*right: 0/);
    // Both have to drop the centring transform, or the anchor is undone by it.
    const first = /\.bars-col:nth-child\(-n \+ 2\) \.bars-tip \{([^}]*)\}/.exec(css);
    const last = /\.bars-col:nth-last-child\(-n \+ 2\) \.bars-tip \{([^}]*)\}/.exec(css);
    expect(first![1]).toContain("transform: none");
    expect(last![1]).toContain("transform: none");
  });
});
