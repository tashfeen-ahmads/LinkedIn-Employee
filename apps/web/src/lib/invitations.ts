import "server-only";
import { randomBytes } from "node:crypto";

/** Days an invitation stays valid. */
export const INVITE_TTL_DAYS = 7;

/**
 * Invitation token. 32 random bytes, base64url. Possession of this string is
 * what admits someone to a workspace, so it is generated from a CSPRNG and
 * derived from nothing the recipient's email address would reveal.
 */
export function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString();
}

export interface InviteRecord {
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  email: string;
}

export type InviteRejection = "expired" | "already_accepted" | "revoked" | "wrong_email";

/**
 * Whether an invitation may be accepted by this signed-in user.
 *
 * The email check matters: an invitation is addressed to a person, and a token
 * that lands in the wrong inbox — forwarded, or found in a shared mailbox —
 * must not silently admit whoever opens it.
 */
export function checkInvite(
  invite: InviteRecord,
  userEmail: string,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: InviteRejection } {
  if (invite.revoked_at) return { ok: false, reason: "revoked" };
  if (invite.accepted_at) return { ok: false, reason: "already_accepted" };
  if (Date.parse(invite.expires_at) <= now.getTime()) return { ok: false, reason: "expired" };
  if (invite.email.trim().toLowerCase() !== userEmail.trim().toLowerCase()) {
    return { ok: false, reason: "wrong_email" };
  }
  return { ok: true };
}

export function inviteRejectionMessage(reason: InviteRejection): string {
  switch (reason) {
    case "expired":
      return "This invitation has expired. Ask your admin to send a new one.";
    case "already_accepted":
      return "This invitation has already been used.";
    case "revoked":
      return "This invitation was withdrawn.";
    case "wrong_email":
      return "This invitation was sent to a different email address. Sign in with that address to accept it.";
  }
}
