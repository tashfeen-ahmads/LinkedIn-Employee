"use client";

import { useRef, useState } from "react";

/**
 * A submit button for a form that posts to a URL rather than a server action.
 *
 * `SubmitButton` reads `useFormStatus`, which only tracks server actions, so a
 * plain post needs its own: it disables on submit so a second press cannot
 * send the form twice, and says it is working while the page loads.
 */
export function PostButton({
  children,
  pendingLabel,
  className = "btn",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={ref}
      className={className}
      type="submit"
      aria-busy={pending}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        // Only once the browser has accepted the form as valid, or a required
        // field left empty would leave the button stuck on "working".
        const form = ref.current?.form;
        if (form && !form.checkValidity()) return;
        setTimeout(() => setPending(true), 0);
      }}
    >
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {pendingLabel ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}
