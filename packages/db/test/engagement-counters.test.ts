import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The newest definition of `record_linkedin_action`, read as text: nothing in
 * CI runs Postgres. Likes and comments are counted in the same one statement
 * as every other action (rule 2), and neither starts the invitation ramp,
 * because engaging with a post is not a send (rule 3).
 */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");

function newestDefinition(): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  let found = "";
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const at = sql.indexOf("create or replace function record_linkedin_action(");
    if (at >= 0) found = sql.slice(at, sql.indexOf("$$;", at));
  }
  return found;
}

describe("record_linkedin_action", () => {
  const sql = newestDefinition();

  it("counts likes and comments in the same statement as everything else", () => {
    expect(sql).toContain("reactions_today = reactions_today + case when p_kind = 'post_reaction'");
    expect(sql).toContain("comments_today = comments_today + case when p_kind = 'post_comment'");
  });

  it("starts the invitation ramp only on a send, never on a view, a like or a comment", () => {
    expect(sql).toMatch(/when p_kind in \('profile_view', 'post_reaction', 'post_comment'\) then first_action_at/);
  });
});
