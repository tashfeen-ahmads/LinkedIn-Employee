import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What a customer can read of their own support ticket, read off the
 * migrations as text.
 *
 * `support_tickets_member_select` hands a member every column of their own
 * workspace's tickets, and RLS cannot hide a column. So anything that must stay
 * the operator's (the assistant's unsent draft, its confidence, and why it was
 * held) cannot be a column on that table at all. Nothing in CI runs Postgres,
 * so this replays the `add column` / `drop column` history instead, and checks
 * that the table the draft moved to is readable by a platform admin and nobody
 * else.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
const all = files.map((f) => readFileSync(join(migrationsDir, f), "utf8")).join("\n");

const OPERATOR_ONLY = ["draft_answer", "draft_confidence", "draft_reason"];

/** The columns `table` has once every migration has run, in file order. */
function finalColumns(table: string): Set<string> {
  const columns = new Set<string>();
  const create = new RegExp(`create table ${table} \\(([\\s\\S]*?)\\n\\);`, "i").exec(all);
  if (create) {
    for (const line of create[1]!.split("\n")) {
      const m = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
      if (m && !/^(primary|unique|constraint|check|foreign)$/i.test(m[1]!)) columns.add(m[1]!);
    }
  }
  const alter = new RegExp(`alter table ${table}\\b([\\s\\S]*?);`, "gi");
  let m;
  while ((m = alter.exec(all))) {
    for (const add of m[1]!.matchAll(/add column (?:if not exists )?([a-z_][a-z0-9_]*)/gi)) columns.add(add[1]!);
    for (const drop of m[1]!.matchAll(/drop column (?:if exists )?([a-z_][a-z0-9_]*)/gi)) columns.delete(drop[1]!);
  }
  return columns;
}

function policiesOn(table: string): string[] {
  return [...all.matchAll(new RegExp(`create policy [a-z0-9_]+ on ${table}\\b[\\s\\S]*?;`, "gi"))].map((m) => m[0]);
}

describe("a customer's support ticket", () => {
  it("is still readable by its own workspace", () => {
    // The customer's ticket page reads through this policy; moving the draft
    // must not have taken their own ticket away from them.
    expect(policiesOn("support_tickets").some((p) => /current_workspace_ids\(\)/.test(p))).toBe(true);
    expect(finalColumns("support_tickets")).toContain("answer");
  });

  it("carries no column holding the assistant's unsent draft or why it was held", () => {
    const columns = finalColumns("support_tickets");
    // The replay found the table; an empty set would pass vacuously.
    expect(columns).toContain("subject");
    for (const column of OPERATOR_ONLY) {
      expect(columns.has(column), `support_tickets.${column} is readable by the customer`).toBe(false);
    }
  });

  it("keeps the draft where only a platform admin can read it", () => {
    const columns = finalColumns("support_ticket_drafts");
    for (const column of OPERATOR_ONLY) expect(columns).toContain(column);

    expect(all).toMatch(/alter table support_ticket_drafts enable row level security;/i);
    const policies = policiesOn("support_ticket_drafts");
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy, "a draft policy reaches past the operator").toMatch(/using \(is_platform_admin\(\)\)/i);
      expect(policy).not.toMatch(/current_workspace_ids/i);
      expect(policy).toMatch(/for select/i);
    }
  });

  it("reopens without referring to a column that no longer exists", () => {
    const definitions = [...all.matchAll(/create (?:or replace )?function reopen_support_ticket\([\s\S]*?\$\$;/gi)];
    const latest = definitions.at(-1)![0];
    // The ticket itself no longer carries the draft: the update of
    // support_tickets must not set any of the columns that moved.
    const ticketUpdate = latest.match(/update support_tickets[\s\S]*?where/i)?.[0] ?? "";
    expect(ticketUpdate).toMatch(/update support_tickets/i);
    for (const column of OPERATOR_ONLY) expect(ticketUpdate).not.toMatch(new RegExp(`\\b${column}\\s*=`));
    // ...and the held draft is cleared where it now lives, emptied or removed.
    expect(latest).toMatch(/(delete from|update) support_ticket_drafts/);
  });
});
