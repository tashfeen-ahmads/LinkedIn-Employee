"use client";

import { useFormStatus } from "react-dom";

/**
 * A button that shows it is working.
 *
 * A server action that ends in a redirect gives the page no way to say
 * anything while it runs, so the button looked identical before, during and
 * after — and the Targeting Agent takes the better part of a minute. Somebody
 * pressing it saw nothing, pressed it again, and again, queueing a second and
 * third search of the same profile against a paid seat. "I click and click and
 * nothing happens" was the report, and it was an accurate description of the
 * product.
 *
 * `useFormStatus` is the one thing that knows a server action is in flight, and
 * it only works from inside the form, which is why this is a component rather
 * than a prop on the page.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = "btn",
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={className}
      type="submit"
      // Disabled while it runs, so a second press cannot queue a second job.
      // This is the part that actually costs money.
      disabled={disabled || pending}
      aria-busy={pending}
      title={title}
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
