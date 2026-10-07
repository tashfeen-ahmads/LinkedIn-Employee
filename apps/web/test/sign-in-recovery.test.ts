import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signInCandidates } from "../src/lib/sign-in";

const SRC = join(__dirname, "..", "src", "app");

describe("signInCandidates", () => {
  it("tries exactly what was typed first, then the other Proton spellings", () => {
    expect(signInCandidates("Patti@Proton.me")[0]).toBe("patti@proton.me");
    expect(signInCandidates("patti@proton.me")).toContain("patti@pm.me");
    expect(signInCandidates("sam@acme.com")).toEqual(["sam@acme.com"]);
  });
});

describe("the way back in is on the page", () => {
  it("offers forgot password and forgot email on sign-in, and forgot password on sign-up", () => {
    const login = readFileSync(join(SRC, "login", "page.tsx"), "utf8");
    expect(login).toContain('href="/forgot"');
    expect(login).toContain('href="/forgot?kind=signin"');
    expect(readFileSync(join(SRC, "signup", "page.tsx"), "utf8")).toContain('href="/forgot"');
  });

  it("follows a recovery link only to a page inside the app", () => {
    const confirm = readFileSync(join(SRC, "auth", "confirm", "route.ts"), "utf8");
    expect(confirm).toMatch(/ALLOWED_NEXT\.has\(next\) \? next : "\/reset-password"/);
  });

  it("tells somebody on an empty account that their workspace may be under another email", () => {
    const onboarding = readFileSync(join(SRC, "onboarding", "page.tsx"), "utf8");
    expect(onboarding).toMatch(/redirect\("\/forgot\?kind=signin"\)/);
  });
});
