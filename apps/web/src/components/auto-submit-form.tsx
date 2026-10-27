"use client";

import type { FormHTMLAttributes, ReactNode } from "react";

/**
 * A filter form that applies itself.
 *
 * A dropdown that does nothing until a separate Show button is pressed is a
 * dropdown that looks broken: somebody picks a campaign, the board stays the
 * same, and they conclude the filter does not work. So a change to any
 * dropdown submits the form. It is still an ordinary GET form, so a filtered
 * view is an address that can be bookmarked, and without script the button the
 * caller puts in `<noscript>` is how it is sent.
 */
export function AutoSubmitForm({ children, ...props }: FormHTMLAttributes<HTMLFormElement> & { children: ReactNode }) {
  return (
    <form
      {...props}
      onChange={(event) => {
        if (event.target instanceof HTMLSelectElement) event.currentTarget.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}
