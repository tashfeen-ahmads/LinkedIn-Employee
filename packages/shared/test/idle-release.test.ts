import { describe, expect, it } from "vitest";
import { IDLE_RELEASE_DETAIL, isIdleForRelease, isIdleReleased } from "../src/idle-release.js";

const NOW = new Date("2026-10-30T03:00:00Z");
const OLD = "2026-10-01T12:00:00Z";
const RECENT = "2026-10-25T12:00:00Z";
const base = {
  runningCampaigns: 0,
  connectedAt: OLD,
  lastActionAt: OLD,
  lastCampaignTouch: OLD,
  lastMessageAt: OLD,
  lastSeenAt: OLD,
};

describe("isIdleForRelease (rule 63)", () => {
  it("releases only when every signal is older than the window", () => {
    expect(isIdleForRelease(base, NOW)).toBe(true);
    for (const key of ["connectedAt", "lastActionAt", "lastCampaignTouch", "lastMessageAt", "lastSeenAt"] as const) {
      expect(isIdleForRelease({ ...base, [key]: RECENT }, NOW)).toBe(false);
    }
  });

  it("never releases an account with a running campaign", () => {
    expect(isIdleForRelease({ ...base, runningCampaigns: 1 }, NOW)).toBe(false);
  });

  it("keeps an account whose sign-in could not be read, or whose dates cannot be", () => {
    expect(isIdleForRelease({ ...base, lastSeenAt: undefined }, NOW)).toBe(false);
    expect(isIdleForRelease({ ...base, lastActionAt: "garbage" }, NOW)).toBe(false);
  });

  it("treats a signal that never happened as old", () => {
    expect(isIdleForRelease({ ...base, lastActionAt: null, lastMessageAt: null, lastSeenAt: null }, NOW)).toBe(true);
  });

  it("is exactly fourteen days", () => {
    const edge = new Date(NOW.getTime() - 14 * 86_400_000 + 60_000).toISOString();
    expect(isIdleForRelease({ ...base, lastSeenAt: edge }, NOW)).toBe(false);
    const past = new Date(NOW.getTime() - 14 * 86_400_000 - 60_000).toISOString();
    expect(isIdleForRelease({ ...base, lastSeenAt: past }, NOW)).toBe(true);
  });
});

describe("isIdleReleased", () => {
  it("recognises the release and nothing else", () => {
    expect(isIdleReleased({ status: "disconnected", status_detail: IDLE_RELEASE_DETAIL })).toBe(true);
    expect(isIdleReleased({ status: "active", status_detail: IDLE_RELEASE_DETAIL })).toBe(false);
    expect(isIdleReleased({ status: "disconnected", status_detail: null })).toBe(false);
    expect(isIdleReleased(null)).toBe(false);
  });
});
