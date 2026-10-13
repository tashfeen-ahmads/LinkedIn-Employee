import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(__dirname, "../src/app/app/campaigns/[id]/page.tsx"), "utf8");

describe("campaign page", () => {
  it("does not promise holds that autonomy turned off (rule 41)", () => {
    // "Pricing, legal and anything negative always waits for a person" was
    // printed under every campaign, including the ones whose workspace had
    // chosen to let the agent answer exactly those.
    expect(page).toMatch(/const autonomous = \(campaign\.rules as \{ autonomy\?: string \} \| null\)\?\.autonomy === "autonomous"/);
    expect(page).toMatch(/\{autonomous\s*\?/);
  });

  it("keeps the space in an angle's range", () => {
    // JSX drops whitespace at the end of a line, so "(40 to" followed by a
    // line break rendered as "(40 to60%)".
    expect(page).not.toMatch(/ to \n\s*\{Math\.round\(standing\.high/);
    expect(page).toContain('{" to "}');
  });

  it("shows the deployment's half of a stoppage to operators only (rule 54)", () => {
    expect(page).toMatch(/operator && pacing\.operator \?/);
  });
});
