import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";

/**
 * The worker registers its own webhooks with the secret as a header, because
 * one set up by hand without it refused every prospect reply for days. The
 * order is the safety: create, then remove only older ones at our address.
 */
type Call = { method: string; path: string; body?: Record<string, unknown> };

function provider(calls: Call[], failCreate = false) {
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, path: new URL(url).pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
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
      return failCreate ? new Response("nope", { status: 400 }) : new Response(JSON.stringify({ webhook_id: "new" }));
    }
    return new Response("{}");
  }) as typeof fetch;
  return new UnipileProvider({ dsn: "https://dsn.test", accessToken: "t", fetchImpl });
}

const endpoints = [
  { source: "messaging" as const, url: "https://api.test/webhooks/unipile/messages", name: "nora-messages" },
];

describe("UnipileProvider.ensureWebhooks", () => {
  it("carries the secret as the header the worker checks", async () => {
    const calls: Call[] = [];
    await provider(calls).ensureWebhooks({ secret: "s3cret", endpoints });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body?.headers).toEqual([{ key: "Unipile-Auth", value: "s3cret" }]);
    expect(post.body?.source).toBe("messaging");
  });

  it("removes only the older webhooks at our own address", async () => {
    const calls: Call[] = [];
    const result = await provider(calls).ensureWebhooks({ secret: "s3cret", endpoints });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/api/v1/webhooks/old-msg"]);
    expect(result).toEqual({ created: 1, removed: 1 });
  });

  it("removes nothing when the new one could not be created", async () => {
    const calls: Call[] = [];
    await expect(provider(calls, true).ensureWebhooks({ secret: "s3cret", endpoints })).rejects.toThrow();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
