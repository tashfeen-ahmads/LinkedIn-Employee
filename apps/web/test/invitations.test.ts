import { describe, expect, it } from "vitest";
import {
  INVITE_TTL_DAYS,
  checkInvite,
  createInviteToken,
  inviteExpiry,
  inviteRejectionMessage,
  type InviteRecord,
} from "../src/lib/invitations.js";

const NOW = new Date("2026-09-09T12:00:00Z");

function invite(overrides: Partial<InviteRecord> = {}): InviteRecord {
  return {
    email: "teammate@company.com",
    expires_at: new Date(NOW.getTime() + 3 * 86_400_000).toISOString(),
    accepted_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe("createInviteToken", () => {
  it("produces a long, URL-safe token", () => {
    const token = createInviteToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 200 }, createInviteToken));
    expect(tokens.size).toBe(200);
  });
});

describe("inviteExpiry", () => {
  it("expires after the documented window", () => {
    const expiry = Date.parse(inviteExpiry(NOW));
    expect(expiry - NOW.getTime()).toBe(INVITE_TTL_DAYS * 86_400_000);
  });
});

describe("checkInvite", () => {
  it("accepts a live invitation for the right person", () => {
    expect(checkInvite(invite(), "teammate@company.com", NOW)).toEqual({ ok: true });
  });

  it("ignores case and surrounding whitespace in the email", () => {
    expect(checkInvite(invite(), "  TeamMate@Company.com ", NOW).ok).toBe(true);
  });

  it("refuses a token opened by the wrong person", () => {
    // A forwarded link, or one found in a shared mailbox, must not admit
    // whoever opens it.
    const result = checkInvite(invite(), "someone.else@company.com", NOW);
    expect(result).toEqual({ ok: false, reason: "wrong_email" });
  });

  it("refuses an expired invitation", () => {
    const expired = invite({ expires_at: new Date(NOW.getTime() - 60_000).toISOString() });
    expect(checkInvite(expired, "teammate@company.com", NOW)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a reused invitation", () => {
    const used = invite({ accepted_at: NOW.toISOString() });
    expect(checkInvite(used, "teammate@company.com", NOW)).toEqual({ ok: false, reason: "already_accepted" });
  });

  it("refuses a revoked invitation, even before it expires", () => {
    const revoked = invite({ revoked_at: NOW.toISOString() });
    expect(checkInvite(revoked, "teammate@company.com", NOW)).toEqual({ ok: false, reason: "revoked" });
  });

  it("checks revocation before anything else", () => {
    const revokedAndExpired = invite({
      revoked_at: NOW.toISOString(),
      expires_at: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    expect(checkInvite(revokedAndExpired, "teammate@company.com", NOW).ok).toBe(false);
  });
});

describe("inviteRejectionMessage", () => {
  it("tells the wrong-email case what to do about it", () => {
    expect(inviteRejectionMessage("wrong_email")).toContain("Sign in with that address");
  });
});
