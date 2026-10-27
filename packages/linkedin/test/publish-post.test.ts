import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";

/**
 * A post goes out as a form, the picture as a file under `attachments`, the
 * way the provider's own SDK sends it. A JSON content-type written over a form
 * makes the body unreadable, so it is set for JSON bodies only.
 */
function capture() {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ post_id: "p1" }), { status: 200 });
  }) as typeof fetch;
  return { provider: new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl }), seen };
}

describe("publishing a post", () => {
  it("attaches the approved picture as a file", async () => {
    const { provider, seen } = capture();
    const result = await provider.publishPost({
      accountId: "acct",
      text: "Hello",
      image: { data: new Uint8Array([137, 80, 78, 71]), filename: "post.png", contentType: "image/png" },
    });
    expect(result).toEqual({ ok: true, providerId: "p1" });
    const body = seen[0]!.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("account_id")).toBe("acct");
    expect(body.get("text")).toBe("Hello");
    const file = body.get("attachments") as File;
    expect(file.name).toBe("post.png");
    expect(file.size).toBe(4);
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
  });

  it("sends no attachment for a post without a picture", async () => {
    const { provider, seen } = capture();
    await provider.publishPost({ accountId: "acct", text: "Hello" });
    expect((seen[0]!.init.body as FormData).has("attachments")).toBe(false);
  });
});
