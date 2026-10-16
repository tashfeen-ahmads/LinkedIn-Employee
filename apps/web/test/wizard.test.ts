import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WIZARD_STEPS,
  currentStep,
  gatesSetup,
  openDuringSetup,
  retryBackToOnboarding,
  setupRedirect,
  stepIndex,
  stepToShow,
  type WizardFacts,
} from "../src/lib/wizard";
import { readConfirmations, readOnboardingStash, stampConfirmation } from "../src/lib/onboarding-stash";

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
    // Another page's own error is not a failed LinkedIn sign-in.
    expect(setupRedirect("/app/campaigns?error=That+campaign+could+not+be+found.")).toBe("/onboarding");
    expect(setupRedirect("/app/agents?foo=bar")).toBe("/onboarding");
    expect(setupRedirect("")).toBe("/onboarding");
  });

  it("applies to app pages being loaded, never to a form being posted", () => {
    expect(gatesSetup("GET", "/app")).toBe(true);
    expect(gatesSetup("GET", "/app/agents")).toBe(true);
    // The Sage retry posts under /app; refusing it would strand a stuck step.
    expect(gatesSetup("POST", "/app/strategy/retry")).toBe(false);
    expect(gatesSetup("GET", "/app/support")).toBe(false);
    expect(gatesSetup("GET", "/application")).toBe(false);
    expect(gatesSetup("GET", "/onboarding")).toBe(false);
  });

  it("is enforced in the middleware, which every navigation passes through", () => {
    // Not the layout: a layout is not rendered again when somebody clicks
    // between the pages under it, so a check there could be walked past.
    const middleware = read("middleware.ts");
    expect(middleware).toMatch(/gatesSetup\(request\.method, request\.nextUrl\.pathname\)/);
    expect(middleware).toMatch(/const redirect = NextResponse\.redirect\(target\)/);
    // A lookup that fails lets the page through (rule 17).
    expect(middleware).toMatch(/if \(!error && data\) \{/);
    expect(read("app", "app", "layout.tsx")).not.toMatch(/setupRedirect/);
  });

  it("lets the campaign page launch the first campaign only from the last step", () => {
    const page = read("app", "app", "campaigns", "[id]", "page.tsx");
    expect(page).toMatch(/currentStep\(wizard\.facts\) !== "launch"\)\) \{\s*redirect\("\/onboarding"\)/);
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

describe("confirmations are per person, on their own profile row", () => {
  it("stamps one step for one workspace and keeps everything else", () => {
    const first = stampConfirmation({}, "w1", "hours", "2026-10-16T10:00:00Z");
    const second = stampConfirmation(first, "w1", "voice", "2026-10-16T10:01:00Z");
    const other = stampConfirmation(second, "w2", "hours", "2026-10-16T10:02:00Z");
    expect(other).toEqual({
      w1: { hours: "2026-10-16T10:00:00Z", voice: "2026-10-16T10:01:00Z" },
      w2: { hours: "2026-10-16T10:02:00Z" },
    });
    expect(readConfirmations(other, "w1")).toEqual({ hours: "2026-10-16T10:00:00Z", voice: "2026-10-16T10:01:00Z" });
    expect(readConfirmations(other, "w3")).toEqual({});
    expect(readConfirmations("nonsense", "w1")).toEqual({});
    expect(readConfirmations({ w1: { hours: 4, cta: "t" } }, "w1")).toEqual({ cta: "t" });
  });

  it("is written where the person may write, and checked", () => {
    // The workspace row is an owner's or admin's: a stamp written there for a
    // teammate matched nothing and showed them the same step for ever.
    const route = read("app", "onboarding", "save", "route.ts");
    expect(route).toMatch(/\.from\("profiles"\)\s*\.update\(\{ setup_confirmed:/);
    expect(route).toMatch(/return Boolean\(saved\?\.length\);\s*\};\s*\n\s*switch/);
  });

  it("reads the call to action onboarding stored, and nothing it did not", () => {
    const stash = readOnboardingStash({ cta: { kind: "link", url: "https://x.example/offer", label: "" } });
    expect(stash.cta).toEqual({ kind: "link", url: "https://x.example/offer", label: null });
    expect(readOnboardingStash({ cta: { kind: "fax" } }).cta).toBeNull();
  });
});

describe("the review's second pass", () => {
  it("brings a Sage retry pressed in onboarding back to onboarding, with its answer", () => {
    expect(retryBackToOnboarding("/app/strategy?notice=Sage+is+reading")).toBe("/onboarding");
    expect(retryBackToOnboarding("/app/strategy?error=Only+an+owner+or+admin+can+change")).toBe(
      "/onboarding?step=strategy&error=sage-admin-only",
    );
    expect(retryBackToOnboarding("/app/strategy?error=Tell+Sage+what+you+sell+first#details")).toBe(
      "/onboarding?step=strategy&error=sage-needs-source",
    );
    expect(retryBackToOnboarding("/app/strategy?error=Sage+could+not+be+started%3A+boom")).toBe(
      "/onboarding?step=strategy&error=sage-not-started",
    );
    // And every code it can produce has words on the page.
    const page = read("app", "onboarding", "page.tsx");
    for (const code of ["sage-admin-only", "sage-needs-source", "sage-not-started"]) {
      expect(page).toContain(`"${code}":`);
    }
  });

  it("asks about this person's own workspace, never any campaign they can see", () => {
    // A platform admin can read every workspace's campaigns (rule 15).
    expect(read("middleware.ts")).toMatch(/\.eq\("workspace_id", membership\.workspace_id\)\s*\.not\("launched_at", "is", null\)/);
  });

  it("keeps each person's own call to action, and applies it at approval", () => {
    const stamped = stampConfirmation({}, "w1", "cta", "t", { ctaChoice: { kind: "link", label: null, url: "https://a.example/x" } });
    expect(readConfirmations(stamped, "w1").ctaChoice).toEqual({ kind: "link", label: null, url: "https://a.example/x" });
    expect(read("app", "onboarding", "save", "route.ts")).toMatch(/wizard\.confirmations\.ctaChoice \?\? wizard\.stash\.cta/);
  });

  it("puts a teammate's own plan on their own account row after connecting", () => {
    expect(read("app", "onboarding", "save", "route.ts")).toMatch(
      /\.from\("linkedin_accounts"\)\s*\.update\(flags\)\s*\.eq\("workspace_id", workspaceId\)\s*\.eq\("user_id", user\.id\)/,
    );
  });
});
