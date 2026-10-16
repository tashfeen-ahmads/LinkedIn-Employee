import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WALKTHROUGH, walkthroughHref, walkthroughStop } from "../src/lib/walkthrough";

const here = dirname(fileURLToPath(import.meta.url));
const src = (...p: string[]) => join(here, "..", "src", ...p);
const read = (...p: string[]) => readFileSync(src(...p), "utf8");

describe("the tour of the app (rule 65)", () => {
  it("is ten stops, each a page that exists", () => {
    expect(WALKTHROUGH).toHaveLength(10);
    for (const stop of WALKTHROUGH) {
      const page = src("app", ...stop.href.slice(1).split("/"), "page.tsx");
      expect(existsSync(page), `${stop.href} has no page`).toBe(true);
      expect(stop.body.length, `${stop.title} says nothing`).toBeGreaterThan(40);
    }
    expect(new Set(WALKTHROUGH.map((s) => s.href)).size).toBe(WALKTHROUGH.length);
  });

  it("is said in plain words: no dashes, no suppliers (rule 54)", () => {
    const words = WALKTHROUGH.map((s) => `${s.title} ${s.body}`).join(" ");
    expect(words).not.toMatch(/[–—]/);
    expect(words).not.toMatch(/unipile|openai|anthropic|supabase|redis|resend|render|netlify|webhook/i);
  });

  it("reads its stop from the address, and only a real one", () => {
    expect(walkthroughStop("1")?.stop.href).toBe("/app");
    expect(walkthroughStop("10")?.stop.href).toBe("/app/profile");
    for (const bad of ["0", "11", "abc", "", null, "2.5"]) expect(walkthroughStop(bad)).toBeNull();
    expect(walkthroughHref(1)).toBe("/app/campaigns?tour=2");
  });

  it("starts when onboarding ends, and can be started again", () => {
    expect(read("app", "onboarding", "save", "route.ts")).toMatch(/"\/app\?tour=1&launched=1"/);
    expect(read("app", "app", "layout.tsx")).toMatch(/<Walkthrough \/>/);
    expect(read("app", "app", "tutorial", "page.tsx")).toMatch(/href=\{walkthroughHref\(0\)\}/);
  });
});
