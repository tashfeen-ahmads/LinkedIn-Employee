import { describe, expect, it } from "vitest";
import { ctaLinkMissing } from "../src/cta.js";
import { needsYou, type NeedsYouFacts } from "../src/needs-you.js";
import { nextRequiredStep, nextStep, type OnboardingState } from "../src/onboarding.js";
import { inviteRoom, queuedFromLoop, readDecision } from "../src/invite-room.js";
import { usableTimezone } from "../src/timezones.js";

/**
 * Readings a live audit found wrong, each against its own definition.
 */

describe("ctaLinkMissing", () => {
  it("a meeting campaign is never missing a destination: it sends a scheduling link or a booking page", () => {
    expect(ctaLinkMissing({ kind: "meeting", url: null })).toBe(false);
  });

  it("a link or reply campaign with nothing to put in {{cta_link}} is", () => {
    expect(ctaLinkMissing({ kind: "link", url: null })).toBe(true);
    expect(ctaLinkMissing({ kind: "link", url: "  " })).toBe(true);
    expect(ctaLinkMissing({ kind: "reply", url: null })).toBe(true);
    expect(ctaLinkMissing({ kind: "link", url: "https://acme.test/signup" })).toBe(false);
  });
});

describe("nextRequiredStep", () => {
  const done: OnboardingState = {
    hasBusinessProfile: true,
    hasApprovedProfile: true,
    hasLinkedInAccount: true,
    hasCampaign: true,
    hasLaunchedCampaign: true,
    hasKnowledge: false,
  };

  it("is null once every required step is done, however long the knowledge base stays empty", () => {
    expect(nextRequiredStep(done)).toBeNull();
    // The nav's one mark still points at the optional step.
    expect(nextStep(done)?.key).toBe("hasKnowledge");
  });

  it("is the first required step still outstanding", () => {
    expect(nextRequiredStep({ ...done, hasLaunchedCampaign: false })?.key).toBe("hasLaunchedCampaign");
  });
});

const CALM: NeedsYouFacts = {
  loopStalled: false,
  linkedInConnected: true,
  webhookRefused: null,
  heldReplies: 0,
  heldBookings: 0,
  heldForCopy: 0,
  pitchesUnapproved: 0,
  hooksUnapproved: 0,
  strategiesUnapproved: 0,
  strategiesApproved: 0,
  campaignsUnlaunched: 0,
  campaignsWithThinNotes: 0,
  campaignsMissingCta: 0,
};

describe("needsYou wording", () => {
  it("never says the first prospect who asks gets no answer: replies are drafted without a pitch", () => {
    const row = needsYou({ ...CALM, pitchesUnapproved: 2 }).find((i) => i.kind === "pitch_unapproved");
    expect(row?.why).not.toMatch(/gets no answer/);
    expect(row?.why).toMatch(/business profile/);
  });

  it("does not call a draft sending", () => {
    const drafts = needsYou({ ...CALM, campaignsWithThinNotes: 2, campaignsWithThinNotesDraft: 2 });
    expect(drafts.find((i) => i.kind === "thin_notes")?.title).toBe("2 campaigns have notes ready that are not personalised.");
    const one = needsYou({ ...CALM, campaignsWithThinNotes: 1, campaignsWithThinNotesDraft: 1 });
    expect(one.find((i) => i.kind === "thin_notes")?.title).toBe("1 campaign has notes ready that are not personalised.");
    const live = needsYou({ ...CALM, campaignsWithThinNotes: 1 });
    expect(live.find((i) => i.kind === "thin_notes")?.title).toBe("1 campaign is sending notes that are not personalised.");
  });
});

describe("inviteRoom", () => {
  const base = {
    dayAllowance: 10,
    accountSentToday: 0,
    accountInFlightToday: 0,
    weekCeiling: 100,
    accountSentThisWeek: 0,
    accountInFlight: 0,
    campaignCap: 10,
    campaignSentToday: 0,
    campaignInFlightToday: 0,
  };

  it("nets what is queued on the account, as the loop's own budget does", () => {
    expect(inviteRoom({ ...base, accountInFlightToday: 10, accountInFlight: 10 })).toMatchObject({
      accountCap: 0,
      budget: 0,
      moreToday: 0,
    });
  });

  it("counts this campaign's own queued invitations as still going today", () => {
    const room = inviteRoom({ ...base, accountInFlightToday: 6, accountInFlight: 6, campaignInFlightToday: 2 });
    expect(room).toMatchObject({ accountCap: 4, campaignLeft: 8, budget: 4, moreToday: 6 });
  });

  it("honours the week and the campaign's cap", () => {
    expect(inviteRoom({ ...base, accountSentThisWeek: 97 }).budget).toBe(3);
    expect(inviteRoom({ ...base, campaignCap: 5, campaignSentToday: 4 }).budget).toBe(1);
    expect(inviteRoom({ ...base, campaignCap: Number.POSITIVE_INFINITY }).budget).toBe(10);
  });

  it("never promises more than the day has left when the queue count is stale", () => {
    // Seven sent; the loop's stamp still counts all ten as queued, so the
    // sent ones are counted twice. Three is all the day holds.
    const room = inviteRoom({
      ...base,
      accountSentToday: 7,
      campaignSentToday: 7,
      accountInFlightToday: 10,
      accountInFlight: 10,
      campaignInFlightToday: 10,
    });
    expect(room.moreToday).toBe(3);
    expect(inviteRoom({ ...base, campaignCap: 5, campaignSentToday: 4, campaignInFlightToday: 3 }).moreToday).toBe(1);
  });
});

describe("queuedFromLoop", () => {
  const detail = {
    decisions: [
      { campaign: "c1", reason: "queued 3 invitation(s), re-queued 1 stranded, 2 already waiting" },
      { campaign: "c2", reason: "queued 4 invitation(s)" },
      { campaign: "other-account", reason: "queued 9 invitation(s)" },
      { campaign: "c1", reason: "warmed 12 profile(s)" },
    ],
  };

  it("adds up what the loop placed and found waiting on this account's campaigns", () => {
    expect(queuedFromLoop(detail, "c1", "a1", ["c2"])).toEqual({ account: 10, campaign: 6 });
  });

  it("reads the account's stated count when the loop said there was no allowance left", () => {
    const stalled = {
      decisions: [
        {
          campaign: "c1",
          reason: "no allowance left today (account 0, week 80, campaign 10 of 10; 7 already queued on the account)",
        },
      ],
    };
    expect(queuedFromLoop(stalled, "c1", "a1", [])).toEqual({ account: 7, campaign: 0 });
  });

  it("prefers a structured count when the stamp carries one", () => {
    const structured = { inFlight: { a1: { account: 5, campaigns: { c1: 2 } } }, decisions: detail.decisions };
    expect(queuedFromLoop(structured, "c1", "a1", ["c2"])).toEqual({ account: 5, campaign: 2 });
  });

  it("says nothing when the stamp says nothing about this account", () => {
    expect(queuedFromLoop(null, "c1", "a1", [])).toBeNull();
    expect(queuedFromLoop({ decisions: [] }, "c1", "a1", [])).toBeNull();
    expect(queuedFromLoop({ paused: true }, "c1", "a1", [])).toBeNull();
  });

  it("does not read re-queued as queued", () => {
    expect(readDecision("re-queued 2 stranded")).toEqual({ inFlight: 2, accountQueued: null });
  });
});

describe("usableTimezone", () => {
  it("takes the first zone the runtime can read, so a stored \"Eastern\" falls back to the profile's", () => {
    expect(usableTimezone("Eastern", "America/New_York")).toBe("America/New_York");
    expect(usableTimezone("Europe/London", "America/New_York")).toBe("Europe/London");
    expect(usableTimezone(null, undefined, "")).toBeNull();
  });
});
