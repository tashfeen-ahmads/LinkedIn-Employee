"use client";

import { useState } from "react";

/**
 * Ticks or clears every checkbox of one name inside the form it sits in.
 *
 * Twenty-six boxes is twenty-six clicks to do the obvious thing, and two
 * hundred is a screen nobody finishes. The obvious thing has to be one click,
 * and every other row still has to be individually removable — the whole
 * reason this list is a list rather than a count is that a rep reads it and
 * takes somebody off.
 *
 * Scoped to the form it is inside rather than the document, so a second list
 * on the same page is untouched. `closest("form")` rather than an id, because
 * an id is a second thing to keep in step with the markup.
 */
export function SelectAll({ name, label }: { name: string; label: string }) {
  const [all, setAll] = useState(false);

  return (
    <label className="inline-check">
      <input
        type="checkbox"
        checked={all}
        onChange={(event) => {
          const next = event.target.checked;
          setAll(next);
          const form = event.target.closest("form");
          if (!form) return;
          for (const box of form.querySelectorAll<HTMLInputElement>(
            `input[type="checkbox"][name="${name}"]`,
          )) {
            box.checked = next;
          }
        }}
      />
      <span>{label}</span>
    </label>
  );
}
