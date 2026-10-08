"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button for something that cannot be undone: the first press arms
 * it, the second does it.
 *
 * Several actions here deleted or replaced real data in one click — erasing a
 * prospect, removing a do-not-contact entry (which lets campaigns write to
 * that company again), throwing away a post. A second press on the same spot
 * is the lightest confirmation that still catches a misclick, and it needs no
 * dialog, so it works the same with a keyboard, on a phone, and in a table row.
 * It disarms itself after a few seconds, so an armed button left on screen is
 * never a trap.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  pendingLabel = "Working…",
  className = "btn small danger",
  formAction,
  name,
  value,
}: {
  children: React.ReactNode;
  /** What the armed button says — name the consequence, e.g. "Erase for good". */
  confirmLabel: string;
  pendingLabel?: string;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-busy={pending}
      formAction={formAction}
      name={name}
      value={value}
      onClick={(event) => {
        if (!armed) {
          event.preventDefault();
          setArmed(true);
        }
      }}
    >
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : armed ? (
        confirmLabel
      ) : (
        children
      )}
      <span className="sr-only" aria-live="polite">
        {armed ? ` Press again to confirm: ${confirmLabel}.` : ""}
      </span>
    </button>
  );
}
