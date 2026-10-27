import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Members read the worker's own health rows and nothing else in
 * `worker_heartbeats` (migration 0056). `accounts:observed` holds every
 * connected account's LinkedIn name, so a policy of `using (true)` hands it to
 * every signed-in person. Nothing in CI runs Postgres, so this reads the SQL as
 * text: the last migration to define the member policy decides.
 */

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

function lastPolicy(name: string): string {
  let found = "";
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    const re = new RegExp(`create policy ${name} on worker_heartbeats[\\s\\S]*?;`, "gi");
    for (const m of sql.matchAll(re)) found = m[0];
  }
  expect(found, `no ${name} policy`).not.toBe("");
  return found;
}

describe("worker heartbeat read scope", () => {
  it("never lets every member read every row", () => {
    const policy = lastPolicy("worker_heartbeats_read");
    expect(policy).not.toMatch(/using\s*\(\s*true\s*\)/i);
    expect(policy).toMatch(/name in \(/i);
    expect(policy).not.toMatch(/accounts:observed/);
  });

  it("names exactly the rows member screens read", () => {
    const policy = lastPolicy("worker_heartbeats_read");
    for (const name of ["campaign-tick", "worker-boot", "webhook:messages"]) expect(policy).toContain(`'${name}'`);
  });

  it("keeps the console's full read for platform admins", () => {
    expect(lastPolicy("worker_heartbeats_admin_read")).toMatch(/is_platform_admin\(\)/);
  });
});

describe("a member's own queued count", () => {
  it("is handed back only to somebody in that account's workspace", () => {
    const sql = readFileSync(join(dir, "0059_pacing_scope_and_step_versions.sql"), "utf8");
    const fn = /create or replace function pacing_in_flight[\s\S]*?\$\$;/i.exec(sql)?.[0] ?? "";
    expect(fn).toMatch(/security definer/i);
    expect(fn).toMatch(/m\.user_id = auth\.uid\(\)/);
    expect(fn).toMatch(/where a\.id = p_account_id/);
    expect(sql).toMatch(/revoke execute on function pacing_in_flight\(uuid\) from public, anon/i);
  });
});
