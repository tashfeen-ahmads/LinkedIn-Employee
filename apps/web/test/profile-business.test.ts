import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBusinessForm } from "../src/lib/profile-business";

/**
 * Everything asked during setup can be changed afterwards, on Profile.
 *
 * A customer signed up with the wrong company name and had nowhere to fix it:
 * the name, the website and the description were asked once at onboarding and
 * then shown on no screen that could edit them.
 */
const SRC = join(__dirname, "..", "src", "app");
// The onboarding page and its step screens, read together.
const onboarding = ["page.tsx", "steps.tsx"].map((f) => readFileSync(join(SRC, "onboarding", f), "utf8")).join("\n");
const profile = readFileSync(join(SRC, "app", "profile", "page.tsx"), "utf8");
const strategy = readFileSync(join(SRC, "app", "strategy", "page.tsx"), "utf8");

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe("the profile edits every onboarding answer", () => {
  const asked = [...onboarding.matchAll(/name="([A-Za-z]+)"/g)].map((m) => m[1]!);

  it("asks something at onboarding at all", () => {
    expect(asked).toEqual(expect.arrayContaining(["companyName", "websiteUrl", "fullName", "handling"]));
  });

  it("has a field on the profile for each of them", () => {
    // Day checkboxes are named `day-${n}` in both and the timezone comes from
    // the shared picker, so they are checked by their own names.
    // Hidden fields that route a step's form are plumbing, not questions.
    const plumbing = new Set(["action", "profileId", "campaignId"]);
    // What a campaign asks for is per strategy after onboarding, so it is
    // changed on the strategy page rather than the profile.
    const perStrategy = new Set(["ctaKind", "ctaLabel", "ctaUrl"]);
    // Who answers replies is asked on the launch step as a choice between two
    // ways of working; the profile changes the same setting as "autonomy".
    const renamed: Record<string, string> = { handling: "autonomy" };
    for (const asked_ of asked) {
      const name = renamed[asked_] ?? asked_;
      if (plumbing.has(name)) continue;
      if (perStrategy.has(name)) {
        expect(strategy, `onboarding asks "${name}" and the strategy page cannot change it`).toContain(`name="${name}"`);
        continue;
      }
      expect(profile, `onboarding asks "${name}" and the profile cannot change it`).toContain(`name="${name}"`);
    }
    expect(profile).toContain('name="linkedinPlan"');
    expect(profile).toContain("name={`day-${day.value}`}");
    expect(profile).toContain("<TimezoneSelect");
  });

  it("renames the workspace and the agents' company name together", () => {
    expect(profile).toMatch(/\.from\("workspaces"\)\s*\.update\(\{ name: business\.companyName \}\)/);
    expect(profile).toMatch(/spec: \{ \.\.\.spec, companyName: business\.companyName \}/);
  });

  it("never rewrites strategies a campaign was built from", () => {
    expect(profile).toMatch(/if \(campaigns\) \{\s*redirect\(/);
  });
});

describe("readBusinessForm", () => {
  it("accepts a corrected company and its addresses", () => {
    expect(
      readBusinessForm(
        form({ companyName: " Ron's Work Perks ", websiteUrl: "https://ronsworkperks.com", description: "Perks for teams." }),
      ),
    ).toEqual({
      ok: true,
      companyName: "Ron's Work Perks",
      websiteUrl: "https://ronsworkperks.com",
      linkedinCompanyUrl: null,
      description: "Perks for teams.",
    });
  });

  it("refuses a blank company name", () => {
    expect(readBusinessForm(form({ companyName: "  " })).ok).toBe(false);
  });

  it("refuses an address Sage could not fetch", () => {
    expect(readBusinessForm(form({ companyName: "Acme", websiteUrl: "not a url" })).ok).toBe(false);
  });
});
