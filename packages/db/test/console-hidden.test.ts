import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Hiding a workspace from the console (migration 0062). Read as text, because
 * nothing in CI runs Postgres. A workspace's own owner may update its row, so
 * without the guard a customer could hide themselves from their own support.
 */
const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, "../supabase/migrations/0062_console_hidden.sql"), "utf8");

describe("console_hidden", () => {
  it("defaults to shown", () => {
    expect(sql).toMatch(/add column if not exists console_hidden boolean not null default false/);
  });

  it("can be changed only by the service role", () => {
    expect(sql).toMatch(/if v_role is null or v_role = 'service_role' then\s+return new;/);
    expect(sql).toMatch(/new\.console_hidden is distinct from old\.console_hidden then\s+raise exception/);
    expect(sql).toMatch(/create trigger workspaces_console_hidden_guard\s+before update on workspaces/);
  });
});
