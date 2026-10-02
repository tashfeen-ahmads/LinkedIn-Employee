import { describe, expect, it } from "vitest";
import { UnipileProvider, MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { ensureWebhooks, WEBHOOKS_BEAT } from "../src/webhooks.js";

/**
 * Every prospect reply was refused for days: the webhook had been set up by
 * hand without the header that proves a delivery is ours. The worker now
 * registers its own, with the header, and the order of operations is the
 * safety: create first, remove the old ones only after.
 */
function unipile(calls: Array<{ method: string; path: string; body?: unknown }>, failCreate = false) {
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? "GET";
    calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "GET") {
      return new Response(
        JSON.stringify({
          items: [
            { id: "old-msg", request_url: "https://api.test/webhooks/unipile/messages" },
            { id: "someone-elses", request_url: "https://elsewhere.test/hook" },
          ],
        }),
      );
    }
    if (method === "POST") {
      if (failCreate) return new Response("nope", { status: 400 });
      return new Response(JSON.stringify({ webhook_id: `new-${calls.length}` }));
    }
    return new Response("{}");
  }) as typeof fetch;
  return new UnipileProvider({ dsn: "https://dsn.test", accessToken: "t", fetchImpl });
}

describe("ensureWebhooks", () => {
  it("registers both webhooks carrying the secret as a header", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const db = new FakeDb();

    const outcome = await ensureWebhooks(db.asDb(), unipile(calls), { workerUrl: "https://api.test", secret: "s3cret" });

    expect(outcome).toBe("registered");
    const posts = calls.filter((c) => c.method === "POST").map((c) => c.body as Record<string, unknown>);
    expect(posts.map((p) => p.source)).toEqual(["messaging", "account_status"]);
    for (const post of posts) expect(post.headers).toEqual([{ key: "Unipile-Auth", value: "s3cret" }]);
    // The old header-less one at our address goes; somebody else's never does.
    const deleted = calls.filter((c) => c.method === "DELETE").map((c) => c.path);
    expect(deleted).toEqual(["/api/v1/webhooks/old-msg"]);
    // The secret is never written down.
    expect(JSON.stringify(db.rows("worker_heartbeats"))).not.toContain("s3cret");
  });

  it("removes nothing when it could not create", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const db = new FakeDb();

    await expect(
      ensureWebhooks(db.asDb(), unipile(calls, true), { workerUrl: "https://api.test", secret: "s3cret" }),
    ).rejects.toThrow();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(db.find("worker_heartbeats", { name: WEBHOOKS_BEAT })?.detail).toMatchObject({ ok: false });
  });

  it("does it once per secret, not on every boot", async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    const db = new FakeDb();
    const provider = unipile(calls);

    await ensureWebhooks(db.asDb(), provider, { workerUrl: "https://api.test", secret: "s3cret" });
    const after = calls.length;
    expect(await ensureWebhooks(db.asDb(), provider, { workerUrl: "https://api.test", secret: "s3cret" })).toBe("unchanged");
    expect(calls.length).toBe(after);
    // A rotated secret registers again.
    expect(await ensureWebhooks(db.asDb(), provider, { workerUrl: "https://api.test", secret: "rotated" })).toBe("registered");
  });

  it("does nothing without a secret or for a provider that pushes nothing", async () => {
    const db = new FakeDb();
    expect(await ensureWebhooks(db.asDb(), new MockLinkedInProvider(), { workerUrl: "https://api.test", secret: "s" })).toBe("unsupported");
    expect(await ensureWebhooks(db.asDb(), unipile([]), { workerUrl: "https://api.test", secret: undefined })).toBe("no-secret");
  });
});
