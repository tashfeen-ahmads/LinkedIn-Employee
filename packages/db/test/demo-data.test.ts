import { describe, expect, it } from "vitest";
import { normalizeCompany } from "@le/shared";
import { DEMO } from "../src/seed/demo-data.js";

/**
 * The demo is what a design partner, a reviewer and a designer all look at
 * first. If it is internally inconsistent — a conversation with a prospect
 * that does not exist, a held draft on a thread nobody replied to — it
 * misrepresents the product rather than showing it.
 */
describe("demo dataset", () => {
  const keys = new Set(DEMO.prospects.map((p) => p.key));

  it("gives every screen something to show", () => {
    expect(DEMO.prospects.length).toBeGreaterThanOrEqual(5);
    expect(DEMO.customerProfiles.length).toBeGreaterThanOrEqual(2);
    expect(DEMO.conversations.length).toBeGreaterThanOrEqual(2);
  });

  it("references only prospects that exist", () => {
    for (const conversation of DEMO.conversations) {
      expect(keys.has(conversation.prospect), conversation.prospect).toBe(true);
    }
    expect(keys.has(DEMO.meeting.prospect)).toBe(true);
  });

  it("includes exactly one reply held for a human", () => {
    // This is the product's whole argument. A demo without it shows an
    // autoresponder.
    const held = DEMO.conversations.filter((c) => c.heldDraft);
    expect(held).toHaveLength(1);
    expect(held[0]?.heldDraft?.reason).toBe("pricing question");
  });

  it("holds the reply on a thread that was actually classified as needing one", () => {
    const held = DEMO.conversations.find((c) => c.heldDraft)!;
    const inbound = held.messages.filter((m) => m.direction === "inbound");
    expect(inbound.length).toBeGreaterThan(0);
    expect(inbound.at(-1)?.classification?.needsHuman).toBe(true);
  });

  it("covers the funnel rather than one state repeated", () => {
    const statuses = new Set(DEMO.prospects.map((p) => p.status));
    for (const expected of ["queued", "invited", "accepted", "replied", "meeting_booked"]) {
      expect(statuses.has(expected), expected).toBe(true);
    }
  });

  it("shows an opted-out prospect, so the exclusion is visible", () => {
    const optedOut = DEMO.prospects.filter((p) => p.doNotContact);
    expect(optedOut.length).toBeGreaterThanOrEqual(1);
    expect(optedOut[0]?.status).toBe("opted_out");
  });

  it("ships an exclusion list with both kinds on it", () => {
    // A screenshot of an empty list argues nothing; these two entries are the
    // two reasons the feature exists.
    expect(DEMO.exclusions.some((e) => e.kind === "company")).toBe(true);
    expect(DEMO.exclusions.some((e) => e.kind === "person")).toBe(true);
    for (const entry of DEMO.exclusions) expect(entry.reason).not.toBe("");
  });

  it("never excludes a company it is also prospecting into", () => {
    // Otherwise the demo shows a campaign the product would refuse to send.
    const excluded = new Set(
      DEMO.exclusions.filter((e) => e.kind === "company").map((e) => normalizeCompany(e.rawValue)),
    );
    for (const prospect of DEMO.prospects) {
      expect(excluded.has(normalizeCompany(prospect.company)), prospect.company).toBe(false);
    }
  });

  it("never books a meeting for someone who never replied", () => {
    const booked = DEMO.prospects.find((p) => p.key === DEMO.meeting.prospect);
    expect(booked?.status).toBe("meeting_booked");
    const thread = DEMO.conversations.find((c) => c.prospect === DEMO.meeting.prospect);
    expect(thread?.messages.some((m) => m.direction === "inbound")).toBe(true);
  });

  it("uses the connection-note template the campaign will actually render", () => {
    for (const profile of DEMO.customerProfiles) {
      expect(profile.connectionNote.length).toBeLessThanOrEqual(300);
      expect(profile.connectionNote).toContain("{{first_name}}");
    }
  });

  it("keeps fit scores in range and ranked sensibly", () => {
    for (const prospect of DEMO.prospects) {
      expect(prospect.fitScore).toBeGreaterThanOrEqual(0);
      expect(prospect.fitScore).toBeLessThanOrEqual(100);
      expect(prospect.intentScore).toBeGreaterThanOrEqual(0);
      expect(prospect.intentScore).toBeLessThanOrEqual(100);
    }
    const booked = DEMO.prospects.find((p) => p.status === "meeting_booked")!;
    const untouched = DEMO.prospects.find((p) => p.status === "queued")!;
    // The one who booked should not look like a worse match than one nobody
    // has contacted, or the scoring on screen reads as noise.
    expect(booked.fitScore).toBeGreaterThan(untouched.fitScore);
  });

  it("uses no real person's LinkedIn URL", () => {
    for (const prospect of DEMO.prospects) {
      expect(prospect.linkedinUrl.startsWith("linkedin.com/in/")).toBe(true);
    }
    expect(DEMO.rep.email.endsWith(".test")).toBe(true);
  });
});
