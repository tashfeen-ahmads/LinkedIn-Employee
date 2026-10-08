"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
 *
 * Its own state is read from the rows, never kept beside them. It used to hold
 * a boolean of its own, so unticking one row left "Select all" ticked over a
 * list that was no longer all selected — a control stating something false
 * about the list directly under it. All ticked is ticked, none is clear, and
 * anything between is the indeterminate dash.
 */
export function SelectAll({ name, label }: { name: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState(false);

  const rows = useCallback((): HTMLInputElement[] => {
    const form = ref.current?.closest("form");
    if (!form) return [];
    return [...form.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`)];
  }, [name]);

  const sync = useCallback(() => {
    const boxes = rows();
    const ticked = boxes.filter((box) => box.checked).length;
    const all = boxes.length > 0 && ticked === boxes.length;
    setChecked(all);
    if (ref.current) ref.current.indeterminate = ticked > 0 && !all;
  }, [rows]);

  useEffect(() => {
    sync();
    const form = ref.current?.closest("form");
    if (!form) return;
    // One listener on the form catches every row's change, including rows a
    // re-render adds later.
    form.addEventListener("change", sync);
    return () => form.removeEventListener("change", sync);
  }, [sync]);

  return (
    <label className="inline-check">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          const next = event.target.checked;
          for (const box of rows()) box.checked = next;
          sync();
        }}
      />
      <span>{label}</span>
    </label>
  );
}
