/**
 * What a LinkedIn sign-in that did not finish says, keyed by a short code.
 *
 * The worker used to put these sentences in the address bar (`?error=…`), and
 * onboarding — which shows only words written on its own page, never text from
 * a URL (rule 65) — replaced every one of them with a generic line. So the one
 * piece of advice that fixes most failed sign-ins, "you sign in with Google,
 * so set a LinkedIn password", reached nobody in setup, which is where every
 * new customer connects.
 *
 * So the worker sends a code and both screens that can receive one (the
 * onboarding LinkedIn step and the profile) read the words from here. One
 * definition, so the two cannot drift. No supplier is named (rule 54).
 */
export const LINKEDIN_CONNECT_ERRORS = {
  /** LinkedIn refused or abandoned the sign-in. The provider does not say why. */
  "signin-failed":
    "LinkedIn didn't finish signing you in. The usual reasons: (1) you normally sign in to LinkedIn with Google or Apple, so your LinkedIn account has no password yet — set one in LinkedIn under Settings → Sign in & security → Change password, then try again; (2) LinkedIn asked for a verification code — have your phone or email open when you press Connect; (3) the password was mistyped. Press Connect LinkedIn to try again, or tell us from the Support page and we'll walk through it with you.",
  /** The signed return token was older than an hour. */
  "connect-expired": "That LinkedIn sign-in link expired after an hour. Press Connect LinkedIn to start a fresh one.",
  /** The return trip arrived without a token we could read. */
  "connect-incomplete":
    "The connection to LinkedIn didn't complete. Press Connect LinkedIn to start again — it takes about a minute.",
} as const;

export type LinkedInConnectError = keyof typeof LINKEDIN_CONNECT_ERRORS;

/** The words for a code, or null for anything that is not one of ours. */
export function linkedInConnectError(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.prototype.hasOwnProperty.call(LINKEDIN_CONNECT_ERRORS, code)
    ? LINKEDIN_CONNECT_ERRORS[code as LinkedInConnectError]
    : null;
}
