import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

/**
 * The public pages that say what autopilot never finishes on its own.
 *
 * Each used to name its own two or three of the holds the code enforces, and
 * the terms of service named two. A page that lists fewer than the product
 * enforces reads as the complete list, so every one of them now renders the
 * shared list or sentence from `packages/shared/src/autopilot.ts`.
 */
describe("public pages describe autopilot's holds from the shared list", () => {
  it("the terms list every hold from AUTOPILOT_ALWAYS_HOLDS", () => {
    const terms = src("app/(marketing)/terms/page.tsx");
    expect(terms).toMatch(/AUTOPILOT_ALWAYS_HOLDS\.map\(/);
    expect(terms).not.toMatch(/a prospect who asks to speak to\s+a human and a message Nora did not understand/);
  });

  it.each([
    "app/(marketing)/free-linkedin-automation-tool/page.tsx",
    "app/(marketing)/for/agencies/page.tsx",
    "app/(marketing)/for/small-business/page.tsx",
    "app/(marketing)/for/consultants/page.tsx",
    "app/(marketing)/for/b2b-saas/page.tsx",
    "app/(marketing)/guides/linkedin-prospecting/page.tsx",
    "app/(marketing)/guides/linkedin-follow-up-after-connection/page.tsx",
    "app/(marketing)/guides/ai-sdr-vs-human-sdr/page.tsx",
    "app/(marketing)/guides/ai-personalized-linkedin-messages/page.tsx",
    "app/(marketing)/guides/book-meetings-from-linkedin/page.tsx",
  ])("%s renders the shared sentence", (path) => {
    const page = src(path);
    expect(page).toMatch(/\{alwaysHoldsSentence\(\)\}/);
    // The hand-written partial lists this replaced.
    expect(page).not.toMatch(/Two kinds always wait/);
    expect(page).not.toMatch(/two holds never lift/);
    expect(page).not.toMatch(/anyone who asks for a (human|person) gets/);
    expect(page).not.toMatch(/a prospect who asks for a person is always handed to one/);
  });
});
