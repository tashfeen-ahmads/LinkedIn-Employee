import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A button that saves and says nothing is a button that did nothing.
 *
 * Four screens wrote to the database, revalidated, and returned — with no
 * banner, no redirect, and nothing on screen that changed. From the other side
 * of the glass that is indistinguishable from a broken form, and it was
 * reported as exactly that.
 *
 * So every screen carrying a server action has to be able to say something:
 * it must render `PageNotice`, and at least one of its actions must redirect
 * with a message. A convention nothing checks drifts back within a month.
 */
const APP = join(process.cwd(), "src/app/app");

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

describe("screens that save", () => {
  const withActions = pages(APP)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes('"use server"'));

  it("finds the screens that write, so this test cannot quietly cover nothing", () => {
    // The guard on the guard: a broken glob would make every assertion below
    // pass over an empty list.
    expect(withActions.length).toBeGreaterThan(8);
  });

  it("can tell the person something happened", () => {
    const silent = withActions
      .filter(({ source }) => !source.includes("PageNotice"))
      .map(({ file }) => file.replace(`${process.cwd()}/`, ""));
    expect(
      silent,
      "these screens run a server action and render no banner, so a save looks identical to a broken button",
    ).toEqual([]);
  });

  /*
   * One screen legitimately has nothing to confirm: billing's only action ends
   * at Stripe, so its success path leaves this site entirely and a banner would
   * render on a page nobody returns to. Named here rather than left to a
   * pattern, so adding a second exemption is a decision somebody makes on
   * purpose.
   */
  const LEAVES_THE_SITE = ["src/app/app/billing/page.tsx"];

  it("actually says it, on at least one action per screen", () => {
    const wordless = withActions
      .filter(({ source }) => !source.includes("noticeQuery"))
      .filter(({ file }) => !LEAVES_THE_SITE.includes(file.replace(`${process.cwd()}/`, "")))
      .map(({ file }) => file.replace(`${process.cwd()}/`, ""));
    expect(
      wordless,
      "these screens render a banner but never send anything to it",
    ).toEqual([]);
  });
});
