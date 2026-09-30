import { describe, expect, it } from "vitest";
import {
  checkEmail,
  checkPassword,
  PASSWORD_MIN,
} from "../src/lib/auth-fields.js";

/**
 * What signup accepts, checked away from the browser.
 *
 * These run on a server action, which any client that can reach the route may
 * post to — so the `required` and `pattern` attributes on the inputs are a
 * courtesy to somebody typing, never the enforcement. This is the enforcement.
 */
describe("a password", () => {
  it("is held to length and nothing else", () => {
    /*
     * No character recipe on purpose. Forcing a capital, a digit and a symbol
     * produces `Password1!` — a string every cracking dictionary already has —
     * while making a long passphrase harder to type. Length is the property
     * that costs an attacker anything.
     */
    const phrase = "correct horse battery staple";
    expect(checkPassword(phrase, phrase).ok).toBe(true);
    expect(checkPassword("Ab1!", "Ab1!").ok).toBe(false);
  });

  it("refuses a mismatch on the server, not only in the browser", () => {
    const a = "a".repeat(PASSWORD_MIN);
    expect(checkPassword(a, `${a}x`).ok).toBe(false);
  });
});

describe("an email", () => {
  it("catches the obvious typo and lets everything else through", () => {
    /*
     * Deliberately loose: a regex that tries to encode RFC 5322 rejects real
     * addresses, and the confirmation link is what actually proves this one
     * exists. This only stops us sending to nowhere.
     */
    expect(checkEmail("  Sam@Company.com ").ok && checkEmail("Sam@Company.com").value).toBe(
      "sam@company.com",
    );
    for (const bad of ["sam", "sam@", "@company.com", "sam@company", "sam company.com"]) {
      expect(checkEmail(bad).ok, bad).toBe(false);
    }
  });
});
