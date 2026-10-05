/**
 * Where a confirmation or sign-in link goes when its code cannot be exchanged.
 *
 * The common case is not a bad link. A confirmation email opened on a
 * different device or browser from the one that signed up has no PKCE code
 * verifier there — the exchange fails, and yet the click has already
 * confirmed the address. The person was sent to /login with the provider's
 * own words in red ("invalid request: both auth code and code verifier should
 * be non-empty"), read that as the signup having failed, and signed up again.
 *
 * What they need to hear is that it worked and the password they chose is the
 * way in. Anything else gets a plain sentence, never the provider's message.
 */
export const CONFIRMED_ELSEWHERE = "Your email is confirmed. Sign in with your password to continue.";
export const LINK_DID_NOT_WORK =
  "That link did not sign you in — it may have expired or already been used. Sign in with your password, or ask for a new link below.";

export function isPkceFailure(error: { message?: string | null; code?: string | null }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return /pkce|code[ _-]?verifier|flow[ _-]?state/.test(text);
}

export function callbackFailurePath(
  error: { message?: string | null; code?: string | null },
  invite?: string | null,
): string {
  const q = invite ? `&invite=${encodeURIComponent(invite)}` : "";
  return isPkceFailure(error)
    ? `/login?notice=${encodeURIComponent(CONFIRMED_ELSEWHERE)}${q}`
    : `/login?error=${encodeURIComponent(LINK_DID_NOT_WORK)}${q}`;
}
