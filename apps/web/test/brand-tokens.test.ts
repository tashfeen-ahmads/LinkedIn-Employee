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

  it("uses the same limit hue as --accent-2", () => {
    expect(BRAND.color.limit.toUpperCase()).toBe(token("accent-2"));
  });
});

describe("the mark", () => {
  it("keeps the line inside the box it is drawn in", () => {
    // The viewBox is 32 square. A limit rule that runs past it is clipped on
    // one side only, which reads as a drawing mistake rather than a rule.
    expect(MARK.limit.x + MARK.limit.width).toBeLessThanOrEqual(32);
    expect(MARK.limit.y + MARK.limit.height).toBeLessThanOrEqual(32);
  });

  it("stops the letter above the line rather than on it", () => {
    // The whole meaning of the mark is the gap. The right leg ends at 21.6 in
    // the path below; if the line ever moves up to meet it, the mark says the
    // opposite of what the product does.
    const rightLegEndsAt = 21.6;
    expect(MARK.limit.y).toBeGreaterThan(rightLegEndsAt);
    expect(MARK.letter).toContain("v4.3");
  });
});
