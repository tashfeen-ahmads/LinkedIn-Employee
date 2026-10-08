"use client";

import { useId, useState } from "react";

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
  const id = useId();
  const hintId = `${id}-hint`;

  /*
   * A `div`, not a wrapping `<label>`.
   *
   * Wrapped in the label, the toggle's text and the hint both became part of
   * the input's accessible name — a screen reader announced "Password Show At
   * least twelve characters, edit text". The label now names the input alone
   * through `htmlFor`, the hint is attached as a description, and the toggle
   * is its own control beside it. The label sits in a `span` so it keeps the
   * `.field > span` type every other field label has.
   */
  return (
    <div className="field">
      <span>
        <label htmlFor={id}>{label}</label>
      </span>
      <span className="password-box">
        <input
          id={id}
          type={shown ? "text" : "password"}
          name={name}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          aria-describedby={hint ? hintId : undefined}
        />
        <button
          type="button"
          className="password-peek"
          onClick={() => setShown((was) => !was)}
          aria-controls={id}
          aria-pressed={shown}
          // The label says what pressing it does, and matches the word on the
          // button so voice control can find it by what it shows.
          aria-label={shown ? "Hide password" : "Show password"}
        >
          {shown ? "Hide" : "Show"}
        </button>
      </span>
      {hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
