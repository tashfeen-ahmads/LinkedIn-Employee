import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The billing columns on `workspaces`, guarded by a trigger in migration 0052.
 *
 * `workspaces_update` lets an owner or admin update their own row and RLS
 * cannot restrict columns, so the trigger is the only thing between a browser
 * console and `plan = 'autopilot'`. Nothing in CI runs Postgres, so this reads
 * the SQL as text, as `definer-functions.test.ts` does: what it can prove is
 * that every billing column is still named in the guard, and that no screen in
 * the web app tries to write one (it would be refused, and say so).
 */

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, "../supabase/migrations/0052_pricing.sql"), "utf8");

const BILLING_COLUMNS = [
  "plan",
  "trial_ends_at",
  "subscription_status",
  "stripe_customer_id",
  "stripe_subscription_id",
  "seats",
  "current_period_end",
  "billing_interval",
  "cancel_at_period_end",
  "last_billing_event_at",
];

function guardBody(): string {
  const m = /create or replace function workspaces_billing_columns_guard\(\)[\s\S]*?\$\$;/i.exec(migration);
  expect(m, "the billing-columns guard function is missing from 0052").not.toBeNull();
  return m![0];
}

describe("billing columns guard", () => {
  it("names every billing column", () => {
    const body = guardBody();
    for (const column of BILLING_COLUMNS) {
      expect(body, `${column} is not guarded`).toMatch(new RegExp(`new\\.${column} is distinct from old\\.${column}`));
    }
  });

  it("lets only the service role and a JWT-less session through", () => {
    const body = guardBody();
    expect(body).toMatch(/v_role is null or v_role = 'service_role'/);
    expect(body).toMatch(/raise exception/);
  });

  it("is a BEFORE UPDATE trigger, so create_workspace's INSERT is untouched", () => {
    expect(migration).toMatch(
      /create trigger workspaces_billing_columns_guard\s+before update on workspaces\s+for each row execute function workspaces_billing_columns_guard\(\)/i,
    );
  });

  it("is never asked by the web app to write a billing column", () => {
    const webSrc = join(here, "../../../apps/web/src");
    const offenders: string[] = [];
    for (const file of walk(webSrc)) {
      const text = readFileSync(file, "utf8");
      const re = /\.from\("workspaces"\)\s*\.(?:update|upsert)\(([\s\S]*?)\)\s*\.(?:eq|select|match)\(/g;
      let m;
      while ((m = re.exec(text))) {
        for (const column of BILLING_COLUMNS) {
          if (new RegExp(`\\b${column}\\s*:`).test(m[1]!)) offenders.push(`${file}: ${column}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}
