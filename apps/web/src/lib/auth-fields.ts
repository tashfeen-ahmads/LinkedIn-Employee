/**
 * What a signup form is allowed to accept, checked in one place.
 *
 * Pure, so it is testable without a browser or a database, and in one file so
 * the form and the server action cannot hold two readings of the same rule.
 *
 * `checkUsername` used to live here. The handle it validated was required at
 * signup, stored on `profiles`, shown read-only on the profile screen — and
 * read by nothing else in the product. It was not the login identifier, it was
 * in no URL, no prospect ever saw it, and there was no screen on which to
 * change it. So it was a mandatory field that could refuse to create an
 * account and could never be corrected afterwards. The column and its unique
 * index stay; if handles become a feature, the rule comes back with the screen
 * that needs it.
 */

export type FieldCheck = { ok: true; value: string } | { ok: false; reason: string };

/**
 * A password, held to length rather than to a character recipe.
 *
 * Twelve characters and nothing else, deliberately. Forcing a capital, a digit
 * and a symbol produces `Password1!` — a pattern every cracking dictionary has
 * — while making a long passphrase harder to type. Length is the property that
 * actually costs an attacker anything, and it is the one a person can satisfy
 * without being annoyed into reusing something.
 */
export const PASSWORD_MIN = 12;

export function checkPassword(raw: string, confirm: string): FieldCheck {
  if (raw.length < PASSWORD_MIN) {
    return { ok: false, reason: `Use at least ${PASSWORD_MIN} characters. A short phrase is fine.` };
  }
  // Checked here as well as by the browser's `required`, because a form can be
  // posted by anything that can reach the route.
  if (raw !== confirm) return { ok: false, reason: "The two passwords do not match." };
  return { ok: true, value: raw };
}

/** An email, to the one rule worth enforcing before the provider sees it. */
export function checkEmail(raw: string): FieldCheck {
  const value = raw.trim().toLowerCase();
  // Deliberately loose. A regex that tries to encode RFC 5322 rejects real
  // addresses, and the confirmation email is what actually proves this one
  // exists — so this only catches the obvious typo before we send to nowhere.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { ok: false, reason: "That does not look like an email address." };
  }
  return { ok: true, value };
}
