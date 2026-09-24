import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Two faults that cost the whole landing page, each guarded by the cheapest
 * check that would have caught it.
 *
 * Both were invisible to every test we had and to anybody reading the diff
 * that introduced them, and both were found only by opening the rendered page
 * and measuring it. A convention nothing checks drifts back within a month.
 */

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, "../src/components");
const cssPath = join(here, "../src/app/globals.css");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("an SVG title is one string", () => {
  /*
   * A `<title>` whose children are an array is the one piece of JSX React
   * cannot serialise the same way twice: the browser treats everything inside
   * the tag as a single text node, the server's markup and the client's
   * differ, and React throws away the entire page tree and rebuilds it. It
   * surfaced as one hydration error on the busiest page we have, and it came
   * from a single tag in a chart's accessible title.
   */
  const files = tsxFiles(componentsDir);

  it("finds the components", () => {
    // Otherwise the assertion below iterates a list it built itself and passes
    // over nothing, which is how a test comes to check nothing at all.
    expect(files.length).toBeGreaterThan(5);
  });

  it("never interpolates into a title alongside other text", () => {
    for (const file of files) {
      // Comments first. A comment that explains this rule necessarily quotes
      // the tag it is about, and scanning it found the explanation rather than
      // the code — which is a test failing on its own prose.
      const source = readFileSync(file, "utf8")
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const [, body] of source.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)) {
        const interpolations = body.match(/\{/g)?.length ?? 0;
        if (interpolations === 0) continue;
        // One interpolation and nothing else is a single child and is fine:
        // `<title>{`…${x}…`}</title>`. Anything beside it is an array.
        const withoutFirst = body.replace(/\{[\s\S]*\}/, "").trim();
        expect(
          { file: file.slice(componentsDir.length + 1), body: body.trim(), stray: withoutFirst },
        ).toEqual({ file: file.slice(componentsDir.length + 1), body: body.trim(), stray: "" });
      }
    }
  });
});

describe("nothing decorative hangs off the side of the page", () => {
  /*
   * `.hero-wash::before` was inset `-10%` left and right — a gradient hanging
   * 128px past the right edge of a 1280px window, which is horizontal page
   * scroll on every page that opens with a hero, and 39px of sideways drift on
   * a phone. Vertical bleed is fine and intended; horizontal bleed is a bug,
   * because only one axis of the viewport is fixed.
   */
  const css = readFileSync(cssPath, "utf8");

  it("has the rule this is about", () => {
    expect(css).toContain(".hero-wash::before");
  });

  it("gives no absolutely positioned decoration a negative side inset", () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders: string[] = [];

    for (const [, selector, block] of withoutComments.matchAll(
      /([^{}]*::(?:before|after))\s*\{([^}]*)\}/g,
    )) {
      const inset = block.match(/(?:^|[;\s])inset:\s*([^;]+);/)?.[1]?.trim();
      if (!inset) continue;
      const parts = inset.split(/\s+/);
      // `inset: a b c d` → b is right and d is left; `inset: a b` → b is both.
      const sides = parts.length >= 4 ? [parts[1], parts[3]] : parts.length >= 2 ? [parts[1]] : [];
      if (sides.some((side) => side?.startsWith("-"))) {
        offenders.push(`${selector.trim()} { inset: ${inset} }`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
