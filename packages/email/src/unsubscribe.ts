import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The one-click unsubscribe link.
 *
 * The token is the link's whole authorisation — somebody clicking it is not
 * signed in, and a mailbox provider acting on `List-Unsubscribe-Post` never
 * will be — so it is signed rather than merely opaque: an HMAC over the user
 * id, under a key derived from the deployment's internal secret. Derived, not
 * used directly, so the secret that authenticates the web app to the worker is
 * never the thing a link in somebody's inbox is checked against.
 *
 * It does not expire. An unsubscribe link that stops working after a month is
 * a spam complaint waiting to happen, and the only thing it can do is stop
 * email — there is nothing to protect by making it short-lived.
 *
 * Fails closed in both directions (rule 8): no secret means no token can be
 * made, and the caller then sends no marketing email at all rather than one
 * without a working way out; and no secret means every token is refused.
 */

const LABEL = "email-unsubscribe-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(LABEL).digest();
}

function signature(userId: string, secret: string): string {
  return createHmac("sha256", signingKey(secret)).update(`unsubscribe:${userId}`).digest("base64url");
}

export function signUnsubscribeToken(userId: string, secret: string | undefined): string | null {
  if (!secret || !UUID.test(userId)) return null;
  return `${Buffer.from(userId, "utf8").toString("base64url")}.${signature(userId, secret)}`;
}

/** The user id a token names, or null for anything not signed by this deployment. */
export function verifyUnsubscribeToken(token: unknown, secret: string | undefined): string | null {
  if (!secret || typeof token !== "string" || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const userId = Buffer.from(parts[0], "base64url").toString("utf8");
  if (!UUID.test(userId)) return null;

  const presented = Buffer.from(parts[1]);
  const expected = Buffer.from(signature(userId, secret));
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
  return userId;
}

/**
 * Where the link points. On the app host rather than the worker's: a
 * `*.onrender.com` address in somebody's inbox reads as phishing, and the page
 * is ours to style.
 */
export function unsubscribeUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/unsubscribe/confirm?token=${encodeURIComponent(token)}`;
}

/**
 * RFC 8058. `List-Unsubscribe-Post` is what tells Gmail and Apple Mail the URL
 * may be POSTed to directly, without a page, which is what a native
 * "Unsubscribe" button beside the sender's name does.
 */
export function unsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
