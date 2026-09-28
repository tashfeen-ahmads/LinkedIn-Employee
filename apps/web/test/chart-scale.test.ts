import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const charts = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/components/charts.tsx"),
  "utf8",
);

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
