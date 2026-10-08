"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

interface Slot {
  iso: string;
  readable: string;
}

/**
 * The times as one choice, and a button that says which one it will book.
 *
 * Every slot used to be its own form with its own name and email boxes, so a
 * page offering six times asked for a name six times and twelve inputs sat
 * between somebody and the button. One set of radios, one name, one email.
 *
 * The button names the chosen time because "Book this" under a list is a
 * question about which one, and the answer matters: it is a meeting with a
 * stranger. Without JavaScript the radios and the form still work; only the
 * label stays generic.
 */
export function SlotPicker({ slots, children }: { slots: ReadonlyArray<Slot>; children: ReactNode }) {
  const [chosen, setChosen] = useState<Slot | null>(null);

  return (
    <>
      <fieldset className="stack-3">
        <legend>Choose a time</legend>
        {slots.map((slot) => (
          <label key={slot.iso} className="check">
            <input
              type="radio"
              name="startsAt"
              value={slot.iso}
              required
              onChange={() => setChosen(slot)}
            />
            <span>{slot.readable}</span>
          </label>
        ))}
      </fieldset>
      {children}
      <BookButton chosen={chosen} />
    </>
  );
}

function BookButton({ chosen }: { chosen: Slot | null }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn block" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" />
          Booking…
        </>
      ) : chosen ? (
        `Book ${chosen.readable}`
      ) : (
        "Book this time"
      )}
    </button>
  );
}
