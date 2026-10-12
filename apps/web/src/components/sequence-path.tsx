import { BRAND } from "@le/shared";
import { NavIcon } from "./icons";
import type { SequenceStep } from "./sequence";

/*
 * The application's drawing of a sequence, kept apart from `sequence.tsx` so
 * the step definitions (and the marketing page that reads them) do not carry
 * the icon set with them.
 */

/** The glyph for a step: an eye, a person joining, a message, then waiting. */
function stepIcon(step: SequenceStep, i: number, steps: SequenceStep[]): string {
  if (step.kind === "view") return "view";
  if (step.kind === "invite") return "invite";
  // The first message answers an acceptance; every one after it waits on the
  // message before it, which is what the clock says.
  const firstMessage = steps.findIndex((s) => s.kind === "message");
  return i === firstMessage ? "support" : "clock";
}

/**
 * The sequence as a numbered path: one row per step, its timing on the right,
 * and a lock beside every timing the product sets rather than the person. The
 * reason a timing is fixed is written under the step, never left to a tooltip,
 * because rule 52 says the steps the product owns carry the reason they are
 * not editable. Message bodies live in the copy form, where they are edited.
 */
export function SequencePath({ steps }: { steps: SequenceStep[] }) {
  return (
    <ol className="seq">
      {steps.map((step, i) => (
        <li key={`${step.label}-${i}`} className="seq-step">
          <span className="seq-num" aria-hidden="true">
            {i + 1}
          </span>
          <span className="seq-icon" aria-hidden="true">
            <NavIcon name={stepIcon(step, i, steps)} />
          </span>
          <div className="seq-body">
            <p className="seq-label">
              {step.label}
              {step.variant ? <span className="pill plain tiny">{step.variant}</span> : null}
            </p>
          </div>
          <div className="seq-when">
            <span className="small">{step.when}</span>
            {step.fixed ? (
              <span className="tiny subtle seq-fixed">
                <NavIcon name="lock" className="seq-lock" />
                Set by {BRAND.name}
              </span>
            ) : null}
          </div>
          {step.fixed ? <p className="seq-why tiny subtle prose">{step.fixed}</p> : null}
        </li>
      ))}
    </ol>
  );
}
