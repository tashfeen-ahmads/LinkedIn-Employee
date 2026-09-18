import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  TOUR_STAGES,
  currentStage,
  stageStatus,
  type OnboardingState,
} from "../src/index.js";

/**
 * One explanation of this product, read by the marketing site and the tutorial
 * inside the app.
 *
 * They were written separately and had already drifted: the site promised
 * meetings arriving in your calendar, which had been removed from the product
 * because Google will not grant the scopes. Somebody who reads a promise on the
 * way in and finds it missing on the way round does not conclude they misread.
 */

const NOTHING: OnboardingState = {
  hasBusinessProfile: false,
  hasApprovedProfile: false,
  hasLinkedInAccount: false,
  hasCampaign: false,
  hasLaunchedCampaign: false,
  hasKnowledge: false,
};

const EVERYTHING: OnboardingState = {
  hasBusinessProfile: true,
  hasApprovedProfile: true,
  hasLinkedInAccount: true,
  hasCampaign: true,
  hasLaunchedCampaign: true,
  hasKnowledge: true,
};

describe("TOUR_STAGES", () => {
  it("never names a setup step that does not exist", () => {
    // The guard against the drift that produced the calendar promise: a stage
    // pointing at a removed step must fail here rather than render a paragraph
    // about a feature nobody can use.
    const keys = new Set(ONBOARDING_STEPS.map((s) => s.key));
    for (const stage of TOUR_STAGES) {
      if (stage.step !== null) expect(keys.has(stage.step)).toBe(true);
    }
  });

  it("gives every stage a caveat", () => {
    // Not optional, and not a formality. Every failure this product has had was
    // a screen that was quiet about a limit, and a tour listing only what works
    // teaches somebody to read the product wrongly.
    for (const stage of TOUR_STAGES) {
      expect(stage.caveat.trim().length).toBeGreaterThan(20);
    }
  });

  it("gives every stage something the product does", () => {
    for (const stage of TOUR_STAGES) expect(stage.weDo.trim()).not.toBe("");
  });

  it("keeps setup stages in the order setup actually happens", () => {
    // A tour that explains approving a strategy before connecting an account
    // describes a product nobody can follow.
    const tourOrder = TOUR_STAGES.filter((s) => s.step !== null).map((s) => s.step);
    const stepOrder = ONBOARDING_STEPS.map((s) => s.key).filter((k) => tourOrder.includes(k));
    expect(tourOrder).toEqual(stepOrder);
  });

  it("has unique ids, so React keys and anchors cannot collide", () => {
    expect(new Set(TOUR_STAGES.map((s) => s.id)).size).toBe(TOUR_STAGES.length);
  });
});

describe("currentStage", () => {
  it("is the first stage whose setup step is outstanding", () => {
    expect(currentStage(NOTHING)?.step).toBe("hasBusinessProfile");
  });

  it("is null once nothing is outstanding", () => {
    expect(currentStage(EVERYTHING)).toBeNull();
  });

  it("moves on as steps are finished", () => {
    const state = { ...NOTHING, hasBusinessProfile: true, hasApprovedProfile: true };
    expect(currentStage(state)?.step).toBe("hasLinkedInAccount");
  });
});

describe("stageStatus", () => {
  it("marks the unattended stages done once the workspace is past them", () => {
    // "It builds the campaign" has no step of its own. Reading that as never
    // having happened would tell a workspace that is sending right now that the
    // half of the product doing the sending has not started.
    const sending = { ...EVERYTHING, hasKnowledge: false };
    const builds = TOUR_STAGES.find((s) => s.id === "build")!;
    const sends = TOUR_STAGES.find((s) => s.id === "send")!;
    expect(stageStatus(builds, sending)).toBe("done");
    expect(stageStatus(sends, sending)).toBe("done");
  });

  it("marks everything done when nothing is outstanding", () => {
    for (const stage of TOUR_STAGES) expect(stageStatus(stage, EVERYTHING)).toBe("done");
  });

  it("marks exactly one stage as current", () => {
    const current = TOUR_STAGES.filter((s) => stageStatus(s, NOTHING) === "current");
    expect(current).toHaveLength(1);
    expect(current[0].step).toBe("hasBusinessProfile");
  });

  it("marks later stages ahead rather than done", () => {
    // The opposite failure: a brand new workspace told the sending stage is
    // finished has been told the product already ran.
    const sends = TOUR_STAGES.find((s) => s.id === "send")!;
    expect(stageStatus(sends, NOTHING)).toBe("ahead");
  });
});
