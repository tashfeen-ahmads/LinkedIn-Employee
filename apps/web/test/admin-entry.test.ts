import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "../src");
const read = (p: string) => readFileSync(join(src, p), "utf8");

/**
 * The split between what a customer sees and what an operator sees.
 *
 * Two halves of one decision, and they failed in opposite directions. The
 * member overview reported model spend — our margin, on the dashboard of the
 * person paying a flat seat price, who cannot act on it and will reasonably
 * read a token count as something they are being charged for. And there was no
 * link to `/admin` anywhere in the product, so the people who *should* see that
 * number had to know the URL and type it.
 */
describe("the member app and the operator console", () => {
  it("never reports model spend on the member overview", () => {
    const overview = read("app/app/page.tsx");
    expect(overview, "the overview still mounts SpendSection").not.toContain("SpendSection");
    // The anchor went with it; a link to a section that no longer exists
    // scrolls nowhere and reads as a page that failed to load. Asserted
    // against the redirect itself rather than the file, which discusses the
    // anchor in a comment — a grep that cannot tell code from prose reports
    // the explanation as the bug.
    const target = /redirect\("([^"]+)"\)/.exec(read("app/app/usage/page.tsx"))?.[1];
    expect(target, "the old usage route no longer redirects anywhere").toBeTruthy();
    expect(target, "still pointing at the removed section").not.toContain("#spend");
  });

  it("offers the console only behind the platform-admin check", () => {
    const layout = read("app/app/layout.tsx");
    expect(layout, "no link to /admin from the member app").toContain('href="/admin"');
    expect(layout, "the link is not gated").toMatch(/\{admin \?[\s\S]{0,400}href="\/admin"/);
    expect(layout, "the gate is not the platform-admin check").toContain("isPlatformAdmin()");
  });

  it("keeps every console page checking for itself", () => {
    /*
     * A hidden link is not a permission. If `/admin` trusted the nav to keep
     * people out, typing the URL would be the whole exploit — so every page
     * there calls `requirePlatformAdmin` regardless of how it was reached.
     */
    for (const page of [
      "app/admin/page.tsx",
      "app/admin/activity/page.tsx",
      "app/admin/support/page.tsx",
      "app/admin/workspaces/[id]/page.tsx",
    ]) {
      expect(read(page), `${page} does not re-check`).toContain("requirePlatformAdmin");
    }
  });
});
