import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { angleSequence, isUuid, meetingBookingUrl, mostHeldAngle, stepPath } from "../src/lib/wizard-launch";

const here = dirname(fileURLToPath(import.meta.url));
const CAMPAIGN = "4f1c2a9e-8b7d-4c3e-9a1b-2c3d4e5f6a7b";

describe("a refused launch reloads onto the campaign it was launching", () => {
  it("carries the campaign id on the launch step", () => {
    expect(stepPath("launch", { error: "launch-blocked", campaign: CAMPAIGN })).toBe(
      `/onboarding?step=launch&error=launch-blocked&campaign=${CAMPAIGN}`,
    );
  });

  it("carries only a uuid, never whatever a hand-made form posted", () => {
    expect(stepPath("launch", { error: "launch-missing", campaign: "../app?x=1" })).toBe(
      "/onboarding?step=launch&error=launch-missing",
    );
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(CAMPAIGN)).toBe(true);
  });

  it("other steps are unchanged", () => {
    expect(stepPath("hours", { error: "timezone", campaign: CAMPAIGN })).toBe("/onboarding?step=hours&error=timezone");
  });
});

describe("the launch screen shows the sequence most of the list receives", () => {
  it("picks the angle most queued people hold, and counts the angles", () => {
    expect(mostHeldAngle(["a", "b", "b", null, "c", "b", "a"])).toEqual({ variantId: "b", holders: 3, angles: 3 });
  });

  it("a tie goes to the angle met first, so two loads agree", () => {
    expect(mostHeldAngle(["a", "b", "b", "a"]).variantId).toBe("a");
  });

  it("nobody on an angle means the campaign-wide sequence", () => {
    expect(mostHeldAngle([null, undefined])).toEqual({ variantId: null, holders: 0, angles: 0 });
  });

  const steps = [
    { step_number: 1, variant_id: null, message: "campaign-wide 1" },
    { step_number: 2, variant_id: null, message: "campaign-wide 2" },
    { step_number: 1, variant_id: "a", message: "angle a 1" },
    { step_number: 1, variant_id: "b", message: "angle b 1" },
    { step_number: 2, variant_id: "b", message: "angle b 2" },
  ];

  it("an angle with its own steps owns them, never the campaign-wide ones", () => {
    expect(angleSequence(steps, "b").map((s) => s.message)).toEqual(["angle b 1", "angle b 2"]);
  });

  it("an angle with no steps of its own, or no angle, falls back to the campaign's", () => {
    expect(angleSequence(steps, "z").map((s) => s.message)).toEqual(["campaign-wide 1", "campaign-wide 2"]);
    expect(angleSequence(steps, null).map((s) => s.message)).toEqual(["campaign-wide 1", "campaign-wide 2"]);
  });
});

describe("a scheduling link typed in the general link box is kept", () => {
  it("uses the general link when the scheduling box is empty", () => {
    expect(meetingBookingUrl("", "cal.com/sam")).toEqual({ ok: true, url: "https://cal.com/sam" });
  });

  it("the scheduling box wins when both are filled", () => {
    expect(meetingBookingUrl("calendly.com/sam/intro", "cal.com/other")).toEqual({
      ok: true,
      url: "https://calendly.com/sam/intro",
    });
  });

  it("a bad scheduling link is refused; a bad general link is ignored", () => {
    expect(meetingBookingUrl("not a link", "")).toEqual({ ok: false });
    expect(meetingBookingUrl("", "not a link")).toEqual({ ok: true, url: null });
    expect(meetingBookingUrl("", "")).toEqual({ ok: true, url: null });
  });

  it("never takes a homepage or a leftover page from the link box as the booking link", () => {
    expect(meetingBookingUrl("", "acme.com/free-audit")).toEqual({ ok: true, url: null });
    expect(meetingBookingUrl("", "https://www.acme.com")).toEqual({ ok: true, url: null });
    expect(meetingBookingUrl("", "https://meetings.hubspot.com/sam")).toEqual({
      ok: true,
      url: "https://meetings.hubspot.com/sam",
    });
  });
});

describe("the launch screen reads what the send path decides from", () => {
  // Source-level, because the page is a server component: the helpers above
  // only matter if the page is the one calling them.
  const page = readFileSync(join(here, "../src/app/onboarding/page.tsx"), "utf8");
  const review = page.slice(page.indexOf("async function launchReview"));

  it("shows the most-held angle's sequence, not the campaign-wide one", () => {
    expect(review).toMatch(/const angle = mostHeldAngle\(/);
    expect(review).toMatch(/angleSequence\(steps \?\? \[\], angle\.variantId\)/);
  });

  it("counts a free account's notes with the campaign page's own helper", () => {
    expect(review).toMatch(/await notesLeftThisMonth\(supabase, account,/);
  });
});
