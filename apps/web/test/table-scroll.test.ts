import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every table sits in something that scrolls.
 *
 * A `<table>` has an intrinsic minimum width — the sum of what its columns
 * need — and it does not wrap. Left as a direct child of the page it simply
 * grows past the edge on a narrow screen, and because the page is the thing
 * overflowing, the whole document scrolls sideways: the heading, the nav, the
 * lot. `.table-scroll` and `.scroll-box` confine that to the table's own box.
 *
 * The convention was applied twenty-one times and missed five, all on the
 * screens written last. A probe at 390px caught `/app/agents` overflowing by
 * 192px with the page sliding 176px sideways — which is the whole of what
 * somebody means by "the dashboard is broken on my phone", and it was found by
 * measuring rather than by reading, because reading is what missed it five
 * times. So the convention is checked here, where it costs nothing and runs on
 * every push, rather than in a browser nothing in CI has.
 *
 * `<table>` inside `<figure>` is exempt: a diagram sets its own width.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), "../src");

function tsx(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...tsx(path));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** The wrappers that confine a wide table's overflow to its own box. */
const SCROLLERS = ["table-scroll", "scroll-box"];

const FILES = tsx(src).filter((f) => readFileSync(f, "utf8").includes("<table"));

describe("every table scrolls inside its own box", () => {
  it("finds the tables", () => {
    // Otherwise the assertion below iterates a list it built itself and empty.
    expect(FILES.length).toBeGreaterThanOrEqual(15);
  });

  for (const file of FILES) {
    const name = relative(src, file);
    it(`wraps every table in ${name}`, () => {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (!line.includes("<table")) continue;
        /*
         * The wrapper is the nearest opening tag above this one, so it is on one
         * of the few lines above rather than anywhere in the file: a file with a
         * wrapped table and a bare one passes a whole-file grep.
         */
        const above = lines.slice(Math.max(0, index - 3), index).join("\n");
        const wrapped = SCROLLERS.some((s) => above.includes(s)) || above.includes("<figure");
        expect(
          wrapped,
          `${name}:${index + 1} has a <table> with no ${SCROLLERS.join(" or ")} above it, so it ` +
            `overflows the page rather than its own box`,
        ).toBe(true);
      }
    });
  }
});
