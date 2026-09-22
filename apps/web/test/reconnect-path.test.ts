import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The banner that says an account cannot send must point at the page that can
 * fix it.
 *
 * It said "Reconnect" and linked to `/app/team`. `connectLinkedIn` is on
 * `/app/profile` and nowhere else, and `/app/team` has no connect control on
 * it — its own lede reads "each rep connects their own LinkedIn account on
 * their own profile". So the single banner a rep sees when sending has stopped
 * took them to a page with nothing to press. Reported thirteen times before
 * anyone read the href.
 *
 * Nothing about either file looks wrong on its own, which is why this is a
 * test and not a convention: the action moved pages and the link did not.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../src");

function tsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...tsxFiles(path));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** `src/app/app/profile/page.tsx` → `/app/profile` */
function routeOf(file: string): string {
  return "/" + relative(join(root, "app"), dirname(file)).split("\\").join("/");
}

describe("reconnecting LinkedIn", () => {
  it("sends the rep to the page that actually holds the connect button", () => {
    const owners = tsxFiles(root).filter((f) =>
      /action=\{connectLinkedIn\}/.test(readFileSync(f, "utf8")),
    );
    expect(owners, "no page renders connectLinkedIn — this test would pass vacuously").toHaveLength(
      1,
    );
    const route = routeOf(owners[0]!);

    const layout = readFileSync(join(root, "app/app/layout.tsx"), "utf8");
    // The banner is the block that renders when the account is not active.
    const banner = layout.slice(layout.indexOf('account.status !== "active" ?'));
    const href = banner.match(/<Link href="([^"]+)"/)?.[1];

    expect(href, "the account banner has no link out of it").toBeTruthy();
    expect(href, `the banner points at ${href}, but the connect button is on ${route}`).toBe(route);
  });
});
