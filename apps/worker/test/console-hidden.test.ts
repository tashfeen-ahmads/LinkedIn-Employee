import { describe, expect, it } from "vitest";
import { adminCan, permissionForControl } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import { runAdminControl } from "../src/jobs/admin-control.js";
import { collectIssues } from "../src/jobs/issues.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

/*
 * A workspace an owner hid from the console (migration 0062): the platform's
 * own test and demo accounts, which otherwise sit beside paying customers in
 * every list. Hiding decides what the whole team sees, so it is an owner's.
 */

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

describe("hiding a workspace from the console", () => {
  it("is an owner's control, never an admin's or support's", () => {
    const needs = permissionForControl("workspace-console-hidden");
    expect(adminCan("owner", needs)).toBe(true);
    expect(adminCan("admin", needs)).toBe(false);
    expect(adminCan("support", needs)).toBe(false);
  });

  it("hides and shows the workspace and records who did it", async () => {
    const db = new FakeDb();
    db.seed("workspaces", [{ id: WS, name: "Freelancer", console_hidden: false }]);
    db.seed("events", []);
    const ctx = { db: db.asDb() } as unknown as WorkerContext;

    const hid = await runAdminControl(ctx, {} as Queues, OWNER, { op: "workspace-console-hidden", workspaceId: WS, on: true });
    expect(hid).toMatchObject({ ok: true });
    expect(db.find("workspaces", { id: WS })?.console_hidden).toBe(true);
    expect(db.rows("events").map((e) => e.name)).toEqual(["workspace.console_hidden"]);

    const back = await runAdminControl(ctx, {} as Queues, OWNER, { op: "workspace-console-hidden", workspaceId: WS, on: false });
    expect(back).toMatchObject({ ok: true });
    expect(db.find("workspaces", { id: WS })?.console_hidden).toBe(false);
  });

  it("leaves a hidden workspace's faults out of Issues and keeps everyone else's", async () => {
    const db = new FakeDb();
    for (const table of ["memberships", "profiles", "campaigns", "campaign_prospects", "worker_heartbeats", "events", "llm_calls", "email_sends"]) {
      db.seed(table, []);
    }
    db.seed("workspaces", [
      { id: WS, name: "Freelancer", created_at: "2026-09-01T00:00:00Z", console_hidden: true },
      { id: OTHER, name: "A customer", created_at: "2026-09-01T00:00:00Z", console_hidden: false },
    ]);
    db.seed("linkedin_accounts", [
      { id: "a1", workspace_id: WS, user_id: "u1", status: "reauth_required", provider_account_id: "acct_1", created_at: "2026-10-01T00:00:00Z" },
      { id: "a2", workspace_id: OTHER, user_id: "u2", status: "reauth_required", provider_account_id: "acct_2", created_at: "2026-10-01T00:00:00Z" },
    ]);
    const ctx = {
      db: db.asDb(),
      env: { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x", EMAIL_FROM: "Nora <n@x.com>", INTERNAL_API_SECRET: "s" },
    } as unknown as WorkerContext;
    const issues = await collectIssues(ctx, new Date("2026-10-05T18:00:00Z"));
    const workspaces = issues.map((i) => i.workspaceId).filter(Boolean);
    expect(workspaces).toContain(OTHER);
    expect(workspaces).not.toContain(WS);
  });
});
