"use client";

import { useFormStatus } from "react-dom";

/**
 * An on/off switch that is a submit button.
 *
 * Each LinkedIn activity is one setting with two states, and a person reading
 * the LinkedIn activity section should see which state at a glance rather
 * than read it out of a button labelled with the opposite ("Turn off" meant
 * "it is on"). So it is drawn as a switch and announced as one
 * (`role="switch"`, `aria-checked`), and pressing it posts the form it sits in,
 * which asks for the other state. No script beyond the pending state: without
 * it the button still posts.
 */
export function LinkedInActivitySwitch({ on, label }: { on: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={pending}
      disabled={pending}
      className="activity-switch"
    >
      <span className="activity-switch-track" aria-hidden="true">
        <span className="activity-switch-thumb" />
      </span>
      <span className="activity-switch-text">{pending ? "Saving…" : on ? "On" : "Off"}</span>
    </button>
  );
}
