"use client";

import { useState } from "react";

/**
 * A password box you can look at.
 *
 * Typing a passphrase blind into two boxes and being told afterwards that they
 * do not match is the most common way a signup is abandoned, and the fix is
 * older than this product: let people see what they typed. The toggle is a
 * real `<button type="button">` rather than an icon with a click handler, so
 * it is reachable by keyboard and announces its state — a screen-reader user
 * otherwise gets an unlabelled control that appears to do nothing.
 *
 * It never leaves the browser. Switching `type` is the whole mechanism: the
 * value is the same value, submitted by the same form, and nothing here reads
 * or copies it.
 */
export function PasswordField({
  name,
  label,
  hint,
  autoComplete = "new-password",
  required = true,
  minLength,
}: {
  name: string;
  label: string;
  hint?: string;
  autoComplete?: string;
  required?: boolean;
  /**
   * Enforced by the browser as well as by the server.
   *
   * `checkPassword` has always required a minimum and the input carried none,
   * so a short password was accepted by the form, refused by the server, and
   * answered with a re-rendered empty page — the person losing their name,
   * their email and both passwords to a rule nothing had told them about
   * until after they pressed the button.
   */
  minLength?: number;
}) {
  const [shown, setShown] = useState(false);

  return (
    <label className="field">
      <span>{label}</span>
      <span className="password-box">
        <input
          type={shown ? "text" : "password"}
          name={name}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-peek"
          onClick={() => setShown((was) => !was)}
          aria-pressed={shown}
          // The label says what pressing it does, not what state it is in:
          // "Hide password" on a hidden password is the sentence that makes
          // somebody press it twice.
          aria-label={shown ? "Hide password" : "Show password"}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}
