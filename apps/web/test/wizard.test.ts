import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WIZARD_STEPS,
  currentStep,
  openDuringSetup,
  setupRedirect,
  stepIndex,
  stepToShow,
  type WizardFacts,
} from "../src/lib/wizard";
import { readOnboardingStash, withConfirmation } from "../src/lib/onboarding-stash";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, "..", "src", ...p), "utf8");

/** A brand-new account: nothing done. */
const NOTHING: WizardFacts = {
  hasWorkspace: false,
  linkedInActive: false,
  confirmed: { hours: false, voice: false, cta: false },
  hasApprovedStrategy: false,
  hasCampaign: false,
  hasLaunchedCampaign: false,
};
const ALL_BUT_LAUNCH: WizardFacts = {
  hasWorkspace: true,
  linkedInActive: true,
  confirmed: { hours: true, voice: true, cta: true },
  hasApprovedStrategy: true,
  hasCampaign: true,
  hasLaunchedCampaign: false,
};

describe("onboarding is a sequence (rule 65)", () => {
  it("runs from the business to a live campaign, with LinkedIn before anything is searched", () => {
    const keys = WIZARD_STEPS.map((s) => s.key);
    expect(keys[0]).toBe("business");
    expect(keys.at(-1)).toBe("launch");
    for (const later of ["hours", "cta", "strategy", "prospects", "launch"] as const) {
      expect(stepIndex("linkedin")).toBeLessThan(stepIndex(later));
    }
    // The ask is chosen before a strategy is approved, so the search writes
    // its copy toward it (rule 29).
    expect(stepIndex("cta")).toBeLessThan(stepIndex("strategy"));
    expect(stepIndex("strategy")).toBeLessThan(stepIndex("prospects"));
  });

  it("is on the first step not done, in order", () => {
    expect(currentStep(NOTHING)).toBe("business");
    expect(currentStep({ ...NOTHING, hasWorkspace: true })).toBe("linkedin");
    expect(currentStep({ ...ALL_BUT_LAUNCH })).toBe("launch");
    // A dropped account puts somebody back on the LinkedIn step, even with a
    // strategy approved and a list built: nothing after it can work.
    expect(currentStep({ ...ALL_BUT_LAUNCH, linkedInActive: false })).toBe("linkedin");
    expect(currentStep({ ...ALL_BUT_LAUNCH, confirmed: { hours: true, voice: true, cta: false } })).toBe("cta");
  });

  it("is finished once a campaign is live, however it got there", () => {
    expect(currentStep({ ...NOTHING, hasWorkspace: true, hasLaunchedCampaign: true })).toBeNull();
    expect(stepToShow("hours", { ...ALL_BUT_LAUNCH, hasLaunchedCampaign: true })).toBeNull();
  });

  it("goes back freely and never forward past the current step", () => {
    const onHours: WizardFacts = { ...NOTHING, hasWorkspace: true, linkedInActive: true };
    expect(stepToShow("business", onHours)).toBe("business");
    expect(stepToShow("linkedin", onHours)).toBe("linkedin");
    expect(stepToShow("launch", onHours)).toBe("hours");
    expect(stepToShow("strategy", onHours)).toBe("hours");
    expect(stepToShow("nonsense", onHours)).toBe("hours");
    expect(stepToShow(undefined, onHours)).toBe("hours");
  });
});

describe("the app waits for setup (rule 65)", () => {
  it("opens only support and a campaign's own review page before the first launch", () => {
    expect(openDuringSetup("/app/support")).toBe(true);
    expect(openDuringSetup("/app/campaigns/7d3c?notice=x")).toBe(true);
    for (const closed of ["/app", "/app/strategy", "/app/agents", "/app/campaigns", "/app/campaigns/new/x", "/app/profile"]) {
      expect(openDuringSetup(closed), closed).toBe(false);
    }
  });

  it("carries LinkedIn's answer to the LinkedIn step, and nothing else", () => {
    expect(setupRedirect("/app/profile?connected=1#team")).toBe("/onboarding?connected=1&step=linkedin");
    expect(setupRedirect("/app/profile?error=Sign+in+failed")).toBe("/onboarding?error=Sign+in+failed&step=linkedin");
    expect(setupRedirect("/app/agents?foo=bar")).toBe("/onboarding");
    expect(setupRedirect("")).toBe("/onboarding");
  });

  it("is enforced in the app layout, from the launched-campaign count", () => {
    const layout = read("app", "app", "layout.tsx");
    expect(layout).toMatch(/if \(!setup\.hasLaunchedCampaign\) \{[\s\S]{0,200}?if \(!openDuringSetup\(path\)\) redirect\(setupRedirect\(path\)\)/);
  });
});

describe("each step is saved and checked on the server", () => {
  const route = read("app", "onboarding", "save", "route.ts");
  const page = read("app", "onboarding", "page.tsx");

  it("refuses a step past the one somebody is on", () => {
    // A form can be posted by anyone who can reach the route, and "launch" is
    // the one that reaches strangers.
    expect(route).toMatch(/if \(stepIndex\(step\) > stepIndex\(current\)\) return seeOther\("\/onboarding"\)/);
  });

  it("launches through the same helper as the campaign page", () => {
    expect(route).toMatch(/await launch\(campaignId,/);
    expect(read("app", "app", "campaigns", "[id]", "page.tsx")).toMatch(/await launch\(campaignId, session\)/);
  });

  it("searches through the same helper as the strategy page", () => {
    expect(route).toMatch(/await queueSearch\(/);
  });

  it("asks about competitors on its approval screen (rule 49)", () => {
    expect(page).toMatch(/describeCompetitorTargeting\(competitorTargeting\(/);
  });

  it("shows the person a code's own words, never the text in the address bar", () => {
    expect(page).toMatch(/Object\.prototype\.hasOwnProperty\.call\(ERRORS, params\.error\)/);
  });
});

describe("confirmations are per person", () => {
  it("stamps one step for one person and keeps everything else", () => {
    const first = withConfirmation({}, "u1", "hours", "2026-10-16T10:00:00Z");
    const second = withConfirmation(first, "u1", "voice", "2026-10-16T10:01:00Z");
    const other = withConfirmation(second, "u2", "hours", "2026-10-16T10:02:00Z");
    expect(other).toEqual({
      u1: { hours: "2026-10-16T10:00:00Z", voice: "2026-10-16T10:01:00Z" },
      u2: { hours: "2026-10-16T10:02:00Z" },
    });
  });

  it("reads what onboarding stored, and nothing it did not", () => {
    const stash = readOnboardingStash({
      cta: { kind: "link", url: "https://x.example/offer", label: "" },
      confirmed: { u1: { hours: "t", cta: 4 }, u2: "nonsense" },
    });
    expect(stash.cta).toEqual({ kind: "link", url: "https://x.example/offer", label: null });
    expect(stash.confirmed).toEqual({ u1: { hours: "t" } });
    expect(readOnboardingStash({ cta: { kind: "fax" } }).cta).toBeNull();
  });
});
