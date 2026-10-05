import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { originForHost } from "../src/lib/request-origin";
import { seeOther } from "../src/lib/see-other";

/**
 * Saving must not sign anybody out.
 *
 * On Netlify the page after every Save was rendered by a server-side fetch from
 * whichever host the instance first served. From norasdr.com it was bounced to
 * app.norasdr.com, the cookie was dropped on the way, and a signed-in person
 * landed on /login. Separately, a token refreshed during a page render was never
 * written back, so an hour in, the session ended two clicks later.
 */
const KNOWN = ["https://app.norasdr.com", "https://norasdr.com"];
const SRC = join(__dirname, "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("originForHost", () => {
  it("pins the host the browser asked, not the one the instance first served", () => {
    expect(originForHost("app.norasdr.com", "https", KNOWN)).toBe("https://app.norasdr.com");
    expect(originForHost("norasdr.com", null, KNOWN)).toBe("https://norasdr.com");
  });

  it("never trusts a host this deployment does not serve", () => {
    // The pinned origin is fetched with the visitor's cookie attached.
    expect(originForHost("evil.example", "https", KNOWN)).toBeNull();
    expect(originForHost("app.norasdr.com.evil.example", "https", KNOWN)).toBeNull();
    expect(originForHost(null, "https", KNOWN)).toBeNull();
  });

  it("keeps a developer's localhost working", () => {
    expect(originForHost("localhost:3000", null, KNOWN)).toBe("http://localhost:3000");
    expect(originForHost("127.0.0.1:3100", "https", KNOWN)).toBe("https://127.0.0.1:3100");
  });
});

describe("seeOther", () => {
  it("answers 303 with a Location that cannot change host", () => {
    const res = seeOther("/app?x=1");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/app?x=1");
  });

  it("refuses an absolute or protocol-relative address", () => {
    expect(() => seeOther("https://norasdr.com/app")).toThrow();
    expect(() => seeOther("//evil.example/app")).toThrow();
  });
});

describe("every session-holding path", () => {
  it("pins the origin wherever the session is read", () => {
    const client = readFileSync(join(SRC, "lib", "supabase-server.ts"), "utf8");
    expect(client).toMatch(/await pinRequestOrigin\(\)/);
  });

  it("never builds a redirect from request.url", () => {
    const offenders = files(join(SRC, "app")).filter((path) =>
      /redirect\([^)]*request\.url/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("refreshes the session in middleware on every dashboard path", () => {
    const middleware = readFileSync(join(SRC, "middleware.ts"), "utf8");
    expect(middleware).toMatch(/auth\.getSession\(\)/);
    expect(middleware).toMatch(/response\.cookies\.set/);
    for (const path of ["/app/:path*", "/admin/:path*", "/onboarding/:path*"]) expect(middleware).toContain(path);
  });
});
