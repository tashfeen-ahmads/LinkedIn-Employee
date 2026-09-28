/**
 * What a signup form is allowed to accept, checked in one place.
 *
 * The rules live here rather than in the page for the reason every other rule
 * in this repo does: the sign-up form and the profile screen both edit the
 * same columns, and two readings of "is this a username" drift — the one
 * somebody believes is whichever screen they happened to be on. It is pure, so
 * it is testable without a browser or a database.
 */

/** LinkedIn-ish handle rules: what people expect a username to be. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

export type FieldCheck = { ok: true; value: string } | { ok: false; reason: string };

/**
 * A username, or the reason it is not one.
 *
 * Lower-cased before it is stored, because the column is citext and the index
 * is unique: storing "Sam" and comparing "sam" would work, and reading it back
 * capitalised differently on different screens would not. Letters, digits,
 * a dot, an underscore and a hyphen — a handle with a space or an @ in it is
 * something somebody typed into the wrong field.
 */
export function checkUsername(raw: string): FieldCheck {
  const value = raw.trim().toLowerCase();
  if (!value) return { ok: false, reason: "Choose a username." };
  if (value.length < USERNAME_MIN) {
    return { ok: false, reason: `A username is at least ${USERNAME_MIN} characters.` };
  }
  if (value.length > USERNAME_MAX) {
    return { ok: false, reason: `A username is at most ${USERNAME_MAX} characters.` };
  }
  if (!/^[a-z0-9._-]+$/.test(value)) {
    return { ok: false, reason: "Use letters, numbers, dots, underscores or hyphens — no spaces." };
  }
  if (/^[._-]|[._-]$/.test(value)) {
    return { ok: false, reason: "A username cannot start or end with a dot, underscore or hyphen." };
  }
  return { ok: true, value };
}

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
