import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIRMED_ELSEWHERE,
  LINK_DID_NOT_WORK,
  callbackFailurePath,
  isPkceFailure,
} from "../src/lib/auth-callback";

/**
 * A confirmation link opened on another device reads as a failed signup.
 *
 * The click confirms the address, and then the code cannot be exchanged
 * because the PKCE verifier lives in the browser that signed up. The person
 * landed on /login with the provider's own words in red and signed up again.
 */
const SRC = join(__dirname, "..", "src");

describe("callbackFailurePath", () => {
  it("tells somebody whose address is confirmed to sign in, as good news", () => {
    for (const error of [
      { message: "invalid request: both auth code and code verifier should be non-empty" },
      { message: "PKCE code verifier not found in storage" },
      { message: "invalid flow state, no valid flow state found", code: "flow_state_not_found" },
      { message: "", code: "bad_code_verifier" },
    ]) {
      expect(isPkceFailure(error)).toBe(true);
      expect(callbackFailurePath(error)).toBe(`/login?notice=${encodeURIComponent(CONFIRMED_ELSEWHERE)}`);
    }
  });

  it("says something plain otherwise, never the provider's message", () => {
    const path = callbackFailurePath({ message: "Email link is invalid or has expired", code: "otp_expired" });
    expect(path).toBe(`/login?error=${encodeURIComponent(LINK_DID_NOT_WORK)}`);
    expect(path).not.toMatch(/otp_expired|invalid\+or/);
  });

  it("keeps the invitation, so an invited person still lands on it", () => {
    expect(callbackFailurePath({ message: "code verifier" }, "tok 1")).toMatch(/&invite=tok%201$/);
  });

  it("is what the callback route uses, and /login renders the notice", () => {
    const route = readFileSync(join(SRC, "app", "auth", "callback", "route.ts"), "utf8");
    expect(route).toMatch(/if \(error\) return seeOther\(callbackFailurePath\(error, searchParams\.get\("invite"\)\)\)/);
    expect(route).not.toMatch(/error\.message/);
    const login = readFileSync(join(SRC, "app", "login", "page.tsx"), "utf8");
    expect(login).toMatch(/params\.notice \?/);
  });
});

/**
 * One app origin. `process.env.APP_URL ?? "http://localhost:3000"` put a
 * localhost link in production email when the variable was unset, and
 * `https://app…//invite/…` when it carried a trailing slash. `SITE.app` is
 * normalised through `appOrigin`.
 */
describe("links into the app", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it("never fall back to localhost from a raw APP_URL", () => {
    const offenders = files(SRC).filter((path) =>
      /process\.env\.APP_URL \?\? "http:\/\/localhost/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("signup, login and the invite link use SITE.app", () => {
    for (const parts of [
      ["app", "signup", "page.tsx"],
      ["app", "login", "page.tsx"],
    ]) {
      expect(readFileSync(join(SRC, ...parts), "utf8")).toMatch(/const base = SITE\.app;/);
    }
    expect(readFileSync(join(SRC, "app", "app", "profile", "team-section.tsx"), "utf8")).toMatch(
      /const appUrl = SITE\.app;/,
    );
  });
});
