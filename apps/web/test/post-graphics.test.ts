import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * The graphic published with a post. Source-level, because the approval is a
 * server action inside a page: what matters is that the picture stored is the
 * one drawn from the settings being approved, and that the approval is
 * conditional on those settings still being the ones on the row.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, "../src", ...parts), "utf8");

describe("approving a post with a graphic", () => {
  const page = read("app", "app", "profile", "activity", "posts", "page.tsx");
  const approve = page.slice(page.indexOf("async function approve("), page.indexOf("async function unapprove("));

  it("draws and stores the picture before the approval, and refuses without a title", () => {
    const drawn = approve.indexOf("drawPostGraphic(");
    const stored = approve.indexOf('.from("linkedin_post_graphics")');
    const approved = approve.indexOf('status: "approved"');
    expect(drawn).toBeGreaterThan(-1);
    expect(stored).toBeGreaterThan(drawn);
    expect(approved).toBeGreaterThan(stored);
    expect(approve).toMatch(/Give the picture a title/);
  });

  it("checks the picture against the post's own words before drawing it", () => {
    expect(approve).toMatch(/visualProblems\(visual, current\.body\)/);
    expect(approve.indexOf("visualProblems(")).toBeLessThan(approve.indexOf("drawPostGraphic("));
  });

  it("approves only the row the picture was drawn from", () => {
    expect(approve).toMatch(/\.eq\("updated_at", current\.updated_at\)/);
    expect(approve).toMatch(/\.select\("body, updated_at, format, graphic_enabled, graphic_headline, graphic_spec, graphic_style"\)/);
  });

  it("shows the stored picture once approved, so the preview is what goes out", () => {
    const route = read("app", "app", "profile", "activity", "posts", "[id]", "graphic", "route.ts");
    expect(route).toMatch(/if \(post\.approved_at \|\| post\.status === "published"\)/);
    expect(route).toMatch(/\.eq\("user_id", session\.userId\)/);
  });

  it("draws in the workspace's own colours", () => {
    const lib = read("lib", "post-graphic.tsx");
    expect(lib).toMatch(/select\("name, brand_primary, brand_accent"\)/);
    expect(lib).toMatch(/paint\(input\.colors, input\.style\)/);
    expect(lib).toMatch(/graphicPalette\(colors, style\)/);
  });
});
