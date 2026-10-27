import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The graphic published with a post (migration 0060). Nothing in CI runs
 * Postgres, so this reads the SQL as text.
 */
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "../supabase/migrations/0060_post_graphics.sql"), "utf8");

describe("post graphics", () => {
  it("clear the approval when the picture changes, exactly as the words do", () => {
    const fn = /create or replace function clear_post_approval[\s\S]*?\$\$;/i.exec(sql)?.[0] ?? "";
    for (const column of ["body", "graphic_enabled", "graphic_headline", "graphic_style"]) {
      expect(fn, column).toMatch(new RegExp(`new\\.${column} is distinct from old\\.${column}`));
    }
    expect(fn).toMatch(/new\.approved_at := null/);
  });

  it("keep the stored picture to the workspace that made it", () => {
    expect(sql).toMatch(/alter table linkedin_post_graphics enable row level security/);
    expect(sql).toMatch(/create policy linkedin_post_graphics_rw[\s\S]*current_workspace_ids\(\)/);
  });

  it("accept only hex codes as company colours", () => {
    expect(sql).toMatch(/brand_primary is null or brand_primary ~ '\^#\[0-9A-Fa-f\]\{6\}\$'/);
    expect(sql).toMatch(/brand_accent is null or brand_accent ~ '\^#\[0-9A-Fa-f\]\{6\}\$'/);
  });
});
