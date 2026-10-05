import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { createServer } from "../src/server.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

/**
 * The invitation link, opened by the person it was sent to.
 *
 * Read as a signed-out visitor, row-level security hid the invitation and the
 * page said "Invitation not found" to every new teammate. The token is the
 * authorisation, as on the booking page, and the answer names nothing beyond it.
 */
const TOKEN = "a".repeat(43);

function app() {
  const db = new FakeDb();
  db.seed("workspaces", [{ id: "ws-1", name: "Acme" }]);
  db.seed("invitations", [
    { id: "inv-1", workspace_id: "ws-1", email: "sam@example.com", role: "member", token: TOKEN, expires_at: "2099-01-01T00:00:00Z", accepted_at: null, revoked_at: null },
  ]);
  const ctx = {
    db: db.asDb(),
    linkedin: new MockLinkedInProvider(),
    email: null,
    env: { APP_URL: "http://app.test", WORKER_URL: "http://worker.test", INTERNAL_API_SECRET: "x".repeat(40) } as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;
  return createServer(ctx, {} as Queues);
}

function preview(token: string) {
  return app().request("/invites/preview", {
    method: "POST",
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json" },
  });
}

describe("/invites/preview", () => {
  it("tells the holder of a real link which workspace invited them, with no session", async () => {
    const body = await (await preview(TOKEN)).json();
    expect(body).toMatchObject({ found: true, workspaceName: "Acme", email: "sam@example.com", role: "member" });
    // Nothing that could reach another row.
    expect(body).not.toHaveProperty("workspace_id");
    expect(body).not.toHaveProperty("token");
  });

  it("says nothing about a token that does not exist", async () => {
    expect(await (await preview("b".repeat(43))).json()).toEqual({ found: false });
    expect(await (await preview("short")).json()).toEqual({ found: false });
  });
});
