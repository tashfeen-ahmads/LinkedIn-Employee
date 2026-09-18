import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The `security definer` functions, read as text.
 *
 * Nothing in CI runs Postgres, so no test here can prove what these functions
 * do — that was checked against the live database, in a rolled-back
 * transaction, using a second workspace the admin is not a member of. What a
 * test *can* prove is that the two lines each one depends on are still written
 * down, and those are exactly the lines that are cheap to delete during an
 * unrelated edit and silent when gone:
 *
 *  - `set search_path`. A definer function that resolves its tables through
 *    the caller's path is the classic privilege-escalation hole, and this
 *    deployment shares a Supabase project with an unrelated product that has
 *    its own `memberships` and `messages` tables.
 *  - the access check. `platform_workspace_stats` and `platform_workspace_spend`
 *    hand over every workspace on the platform, and `answer_support_ticket`
 *    writes to any ticket; `is_platform_admin()` is the whole authorisation in
 *    all three, and it is one line away from not being there.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");

interface DefinerFunction {
  file: string;
  name: string;
  body: string;
}

function definerFunctions(): DefinerFunction[] {
  const found: DefinerFunction[] = [];

  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    // Each `create function` up to the `$$;` that closes its body.
    const re = /create\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\$\$;/gi;
    let m;
    while ((m = re.exec(sql))) {
      const body = m[0];
      if (/security\s+definer/i.test(body)) found.push({ file, name: m[1], body });
    }
  }
  return found;
}

const FUNCTIONS = definerFunctions();

/** The ones that read or write across every tenant on the platform. */
const PLATFORM_WIDE = ["platform_workspace_stats", "platform_workspace_spend", "answer_support_ticket"];

describe("security definer functions", () => {
  it("finds them all", () => {
    // If this drops to nothing the whole file passes vacuously, which is the
    // failure mode of every test that iterates over a list it built itself.
    expect(FUNCTIONS.length).toBeGreaterThanOrEqual(8);
    for (const name of PLATFORM_WIDE) {
      expect(FUNCTIONS.map((f) => f.name)).toContain(name);
    }
  });

  it("pins search_path on every one of them", () => {
    for (const fn of FUNCTIONS) {
      expect(fn.body, `${fn.file}: ${fn.name}() does not pin search_path`).toMatch(
        /set\s+search_path\s*=/i,
      );
    }
  });

  it("keeps the access check inside every platform-wide function", () => {
    for (const name of PLATFORM_WIDE) {
      const fn = FUNCTIONS.find((f) => f.name === name)!;
      expect(fn.body, `${name}() has lost its is_platform_admin() check`).toMatch(
        /is_platform_admin\s*\(\s*\)/,
      );
    }
  });

  it("does not grant a platform-wide function to anon", () => {
    // `authenticated` is correct — the check inside is what decides. `anon` is
    // never correct: it would hand the whole platform's figures to anybody who
    // can reach the API with the publishable key.
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      for (const name of PLATFORM_WIDE) {
        const grants = sql.match(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${name}[^;]*;`, "gi")) ?? [];
        for (const grant of grants) expect(grant, `${file}: ${name}`).not.toMatch(/\banon\b/);
      }
    }
  });
});
