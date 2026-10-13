import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BRAND } from "@le/shared";
import { MARK } from "../src/components/logo";

/**
 * Two surfaces draw the logo without being able to read the stylesheet.
 *
 * The favicon and the link-preview card render through Satori, which lays out
 * a subset of CSS and has never heard of a custom property or a class name. So
 * they take the geometry from `MARK` and the colours from `BRAND.color`, and
 * the stylesheet keeps its own `--accent` and `--accent-2`. That is two
 * representations of one colour, which is exactly the drift rule 38 is about —
 * and the drift is invisible, because nobody compares a browser tab against a
 * header, and a link preview is seen by everyone except the person who shipped
 * it.
 *
 * So the two are compared here. Keeping one definition was not available: the
 * renderer genuinely cannot read the other one.
 */
const CSS = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** The first declaration of a token, which is the light-mode `:root` one. */
function token(name: string): string | null {
  const match = CSS.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{3,8})\\s*;`));
  return match ? match[1].toUpperCase() : null;
}

describe("the brand colours the stylesheet cannot hand over", () => {
  it("reads the tokens it is comparing against", () => {
    // A regex that stopped matching would make every assertion below pass
    // against null, which is the classic test that guards nothing.
    expect(token("accent")).toMatch(/^#[0-9A-F]{6}$/);
    expect(token("accent-2")).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("uses the same accent as --accent", () => {
    expect(BRAND.color.accent.toUpperCase()).toBe(token("accent"));
  });

  it("uses the same arrival hue as --accent-2", () => {
    expect(BRAND.color.goal.toUpperCase()).toBe(token("accent-2"));
  });
});

describe("the mark", () => {
  /** Where a path's stroke runs, as points: the M and every V and L after it. */
  function points(d: string): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let x = 0;
    let y = 0;
    for (const [, cmd, args] of d.matchAll(/([MLV])([^MLV]+)/g)) {
      const n = args.trim().split(/[ ,]+/).map(Number);
      if (cmd === "V") y = n[0]!;
      else [x, y] = [n[0]!, n[1]!];
      out.push([x, y]);
    }
    return out;
  }

  it("keeps everything inside the box it is drawn in", () => {
    // The viewBox is 32 square. A dot or ring that runs past it is clipped on
    // one side only, which reads as a drawing mistake rather than a design.
    const { goal, start } = MARK;
    for (const [cx, cy, r] of [
      [goal.cx, goal.cy, goal.r],
      [start.cx, start.cy, start.r + start.stroke / 2],
    ]) {
      expect(cx! - r!).toBeGreaterThanOrEqual(2);
      expect(cx! + r!).toBeLessThanOrEqual(30);
      expect(cy! - r!).toBeGreaterThanOrEqual(2);
      expect(cy! + r!).toBeLessThanOrEqual(30);
    }
  });

  it("is one path from the ring to the dot", () => {
    // The meaning is the route: it starts at the rep and arrives at the
    // meeting. The stroke must begin directly above the ring and end directly
    // below the dot, or the letter is an N with two ornaments beside it.
    const path = points(MARK.letter);
    const [first, last] = [path[0]!, path[path.length - 1]!];
    expect(first[0]).toBe(MARK.start.cx);
    expect(first[1]).toBeLessThan(MARK.start.cy);
    expect(last[0]).toBe(MARK.goal.cx);
    expect(last[1]).toBeGreaterThan(MARK.goal.cy);
  });

  it("leaves the ring open: the stem stops at its edge", () => {
    // A stem whose round cap reaches into the ring's hole fills it, and a
    // filled ring is a second dot that says nothing.
    const [, top] = points(MARK.letter)[0]!;
    const capReaches = top + MARK.stroke / 2;
    const holeStarts = MARK.start.cy - MARK.start.r + MARK.start.stroke / 2;
    expect(capReaches).toBeLessThanOrEqual(holeStarts);
  });
});
