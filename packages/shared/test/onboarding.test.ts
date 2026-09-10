import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  isReadyToSend,
  nextStep,
  onboardingProgress,
  remainingSteps,
  type OnboardingState,
} from "../src/onboarding.js";

const NOTHING: OnboardingState = {
  hasBusinessProfile: false,
  hasApprovedProfile: false,
  hasLinkedInAccount: false,
  hasCampaign: false,
  hasLaunchedCampaign: false,
  hasCalendar: false,
  hasKnowledge: false,
};

const EVERYTHING_REQUIRED: OnboardingState = {
  hasBusinessProfile: true,
  hasApprovedProfile: true,
  hasLinkedInAccount: true,
  hasCampaign: true,
  hasLaunchedCampaign: true,
  hasCalendar: false,
  hasKnowledge: false,
};

describe("nextStep", () => {
  it("asks for the first thing, not the easiest thing", () => {
    expect(nextStep(NOTHING)?.key).toBe("hasBusinessProfile");
  });

  it("never asks for an optional step while a required one is outstanding", () => {
    // Asking someone to connect a calendar before they have a campaign is noise.
    const state = { ...NOTHING, hasCalendar: false, hasBusinessProfile: true };
    expect(nextStep(state)?.required).toBe(true);
  });

  it("moves on to the optional ones once sending is possible", () => {
    expect(nextStep(EVERYTHING_REQUIRED)?.key).toBe("hasCalendar");
  });

  it("has nothing left to ask when everything is done", () => {
    const all = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s.key, true])) as OnboardingState;
    expect(nextStep(all)).toBeNull();
  });

  it("follows the order the steps have to happen in", () => {
    // A profile cannot be approved before it is written.
    const written = { ...NOTHING, hasBusinessProfile: true };
    expect(nextStep(written)?.key).toBe("hasApprovedProfile");
  });
});

describe("isReadyToSend", () => {
  it("is true once every required step is done, optional or not", () => {
    expect(isReadyToSend(EVERYTHING_REQUIRED)).toBe(true);
  });

  it("is false while any required step is outstanding", () => {
    expect(isReadyToSend({ ...EVERYTHING_REQUIRED, hasLinkedInAccount: false })).toBe(false);
  });

  it("does not let an optional step block sending", () => {
    // A workspace with no calendar can still run a campaign; the agent just
    // offers to send times instead of proposing them.
    expect(isReadyToSend({ ...EVERYTHING_REQUIRED, hasCalendar: false, hasKnowledge: false })).toBe(true);
  });
});

describe("remainingSteps and progress", () => {
  it("counts optional work as real work", () => {
    const progress = onboardingProgress(EVERYTHING_REQUIRED);
    expect(progress.done).toBe(5);
    expect(progress.total).toBe(ONBOARDING_STEPS.length);
  });

  it("lists nothing outstanding when everything is done", () => {
    const all = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s.key, true])) as OnboardingState;
    expect(remainingSteps(all)).toEqual([]);
  });

  it("gives every step a nudge line and a place to go", () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.nudge.length, step.key).toBeGreaterThan(40);
      expect(step.href.startsWith("/"), step.key).toBe(true);
    }
  });
});
