import { describe, expect, it } from "vitest";
import { adminCan, permissionForControl } from "@le/shared";
import { FakeDb } from "./fake-db.js";
import { adminRoleOf, runAdminTeam } from "../src/jobs/admins.js";
import { createServer } from "../src/server.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

/**
 * Who runs the platform, changed from the console. The API still cannot write
 * `platform_admins`; the worker does it for an owner who asked, and the
 * platform can never be left without an owner.
 */
const OWNER = "00000000-0000-4000-8000-000000000001";
const SECOND = "00000000-0000-4000-8000-000000000002";
const STRANGER = "00000000-0000-4000-8000-000000000003";
const SUPPORT = "00000000-0000-4000-8000-000000000004";

function harness() {
  const db = new FakeDb();
  db.seed("profiles", [
    { id: OWNER, email: "owner@example.com", full_name: "Owner" },
    { id: SECOND, email: "Sam_Lee@example.com", full_name: "Sam" },
    { id: STRANGER, email: "stranger@example.com", full_name: "Stranger" },
    { id: SUPPORT, email: "help@example.com", full_name: "Help" },
  ]);
  db.seed("platform_admins", [
    { user_id: OWNER, role: "owner", created_at: "2026-01-01T00:00:00Z", added_by: null },
    { user_id: SUPPORT, role: "support", created_at: "2026-02-01T00:00:00Z", added_by: OWNER },
  ]);
  db.seed("platform_admin_invites", []);
  return { db, run: (caller: string, op: Parameters<typeof runAdminTeam>[2]) => runAdminTeam(db.asDb(), caller, op) };
}

describe("adding admins", () => {
  it("lets an owner add somebody with an account, at the role chosen", async () => {
    const { db, run } = harness();
    const result = await run(OWNER, { op: "add", email: "sam_lee@example.com", role: "admin" });
    expect(result.ok).toBe(true);
    expect(await adminRoleOf(db.asDb(), SECOND)).toBe("admin");
  });

  it("matches the address exactly, so an underscore is not a wildcard", async () => {
    const { db, run } = harness();
    db.seed("profiles", [{ id: "00000000-0000-4000-8000-000000000009", email: "samxlee@example.com" }]);
    await run(OWNER, { op: "add", email: "sam_lee@example.com", role: "viewer" });
    expect(await adminRoleOf(db.asDb(), "00000000-0000-4000-8000-000000000009")).toBeNull();
  });

  it("invites somebody without an account, and only that address can claim it", async () => {
    const { db, run } = harness();
    expect((await run(OWNER, { op: "add", email: "new@example.com", role: "support" })).ok).toBe(true);
    // Somebody else asking to claim gets nothing.
    expect((await run(STRANGER, { op: "claim" })).ok).toBe(false);
    expect(await adminRoleOf(db.asDb(), STRANGER)).toBeNull();
    // The invited person signs up with that address and opens the console.
    const NEW = "00000000-0000-4000-8000-000000000005";
    db.seed("profiles", [{ id: NEW, email: "new@example.com" }]);
    expect((await run(NEW, { op: "claim" })).ok).toBe(true);
    expect(await adminRoleOf(db.asDb(), NEW)).toBe("support");
    expect(db.rows("platform_admin_invites")).toHaveLength(0);
  });

  it("refuses anybody but an owner", async () => {
    const { db, run } = harness();
    const result = await run(SUPPORT, { op: "add", email: "stranger@example.com", role: "owner" });
    expect(result.ok).toBe(false);
    expect(await adminRoleOf(db.asDb(), STRANGER)).toBeNull();
    expect((await run(STRANGER, { op: "list" })).ok).toBe(false);
  });
});

describe("the platform keeps an owner", () => {
  it("will not demote or remove the last owner", async () => {
    const { db, run } = harness();
    expect((await run(OWNER, { op: "set-role", targetUserId: OWNER, role: "admin" })).ok).toBe(false);
    expect((await run(OWNER, { op: "remove", targetUserId: OWNER })).ok).toBe(false);
    expect(await adminRoleOf(db.asDb(), OWNER)).toBe("owner");
  });

  it("allows it once there is another owner", async () => {
    const { db, run } = harness();
    await run(OWNER, { op: "add", email: "sam_lee@example.com", role: "owner" });
    expect((await run(OWNER, { op: "set-role", targetUserId: OWNER, role: "viewer" })).ok).toBe(true);
    expect(await adminRoleOf(db.asDb(), OWNER)).toBe("viewer");
  });

  it("lets an owner remove somebody else", async () => {
    const { db, run } = harness();
    expect((await run(OWNER, { op: "remove", targetUserId: SUPPORT })).ok).toBe(true);
    expect(await adminRoleOf(db.asDb(), SUPPORT)).toBeNull();
  });
});

describe("what each role may press", () => {
  it("keeps viewers to reading and support to tickets", () => {
    expect(adminCan("viewer", permissionForControl("outreach-pause"))).toBe(false);
    expect(adminCan("support", permissionForControl("outreach-pause"))).toBe(false);
    expect(adminCan("support", permissionForControl("support-redraft"))).toBe(true);
    expect(adminCan("admin", permissionForControl("outreach-pause"))).toBe(true);
    expect(adminCan("admin", "manage-admins")).toBe(false);
    expect(adminCan("owner", "manage-admins")).toBe(true);
    expect(adminCan(null, "support")).toBe(false);
  });
});

describe("the worker enforces the role, not just the screen", () => {
  const SECRET = "internal-secret-at-least-32-characters-long";
  function server() {
    const { db } = harness();
    db.seed("platform_admins", [{ user_id: STRANGER, role: "viewer", created_at: "2026-03-01T00:00:00Z", added_by: OWNER }]);
    db.seed("platform_settings", [{ id: true, outreach_paused_at: null }]);
    const ctx = {
      db: db.asDb(),
      email: null,
      env: { INTERNAL_API_SECRET: SECRET, APP_URL: "http://app.test" } as WorkerContext["env"],
      agentsFor: () => ({ client: {} as never }),
    } as unknown as WorkerContext;
    const app = createServer(ctx, {} as Queues);
    const call = (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      });
    return { db, call };
  }

  it("refuses a viewer and support the outreach pause, and lets an owner press it", async () => {
    const { db, call } = server();
    const pause = { op: "outreach-pause", reason: "testing the switch" };
    expect((await call("/admin/control", { userId: STRANGER, control: pause })).status).toBe(403);
    expect((await call("/admin/control", { userId: SUPPORT, control: pause })).status).toBe(403);
    expect(db.rows("platform_settings")[0]?.outreach_paused_at).toBeNull();
    expect((await call("/admin/control", { userId: OWNER, control: pause })).status).toBe(200);
  });

  it("refuses a support admin who tries to add an admin", async () => {
    const { db, call } = server();
    const res = await call("/admin/admins", { userId: SUPPORT, op: { op: "add", email: "stranger@example.com", role: "owner" } });
    expect(res.status).toBe(403);
    expect(await adminRoleOf(db.asDb(), STRANGER)).toBe("viewer");
  });
});
