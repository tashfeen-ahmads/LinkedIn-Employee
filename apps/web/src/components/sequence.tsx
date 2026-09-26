import { FIRST_STEP_DELAY_DAYS, LINKEDIN_LIMITS } from "@le/shared";

/**
 * What a prospect actually receives, drawn as the sequence it is.
 *
 * Every tool in this category ships a drag-and-drop canvas, and the canvas is
 * the demo: it is the one screen that makes "an automated sequence" a thing a
 * person can picture. This product had the same sequence in a table of rows
 * with a `delay_days` column, which reads as configuration rather than as a
 * conversation.
 *
 * Drawn rather than dragged, deliberately. A canvas implies every arrangement
 * is available, and most are not: a link may never appear in a connection
 * request (rule 29), the first message after an acceptance is not on a schedule
 * anybody sets (rule 43), and the warm-up view has to land before the invitation
 * rather than wherever it was dropped. A builder offering those would be
 * offering a campaign this product refuses to send — which is worse than not
 * offering it, because the refusal arrives after the work.
 *
 * So the steps a person owns are shown as theirs, and the ones the product owns
 * are shown with the reason they are not editable. The value of the canvas was
 * always the picture, not the dragging.
 */

export interface SequenceStep {
  /** "Profile view", "Connection request", "Follow-up 1". */
  label: string;
  /** The message, as a prospect would read it. Null for an action with no text. */
  body?: string | null;
  /** When it happens, in the rep's words. */
  when: string;
  /** Why this timing is not editable, when it is not. */
  fixed?: string;
  /** This step belongs to an angle rather than to the campaign. */
  variant?: string | null;
}

export function sequenceFor(input: {
  warmUp: boolean;
  connectionNote: string | null;
  steps: Array<{ step_number: number; delay_days: number; message: string; variant?: string | null }>;
}): SequenceStep[] {
  const out: SequenceStep[] = [];

  if (input.warmUp) {
    out.push({
      label: "Profile view",
      when: `${Math.round(LINKEDIN_LIMITS.warmUpToInviteMinMs / 60_000)} minutes to ${Math.round(
        LINKEDIN_LIMITS.warmUpToInviteMaxMs / 3_600_000,
      )} hours before the invitation`,
      fixed: "A view has to land before the request and close enough to still be remembered. It comes from its own daily allowance and never costs an invitation.",
    });
  }

  out.push({
    label: "Connection request",
    body: input.connectionNote,
    when: "Paced across your sending hours",
    fixed: "Written for each person from their own profile, and never carrying a link — LinkedIn penalises them in invitations.",
  });

  for (const step of [...input.steps].sort((a, b) => a.step_number - b.step_number)) {
    const first = step.step_number === 1;
    out.push({
      label: `Follow-up ${step.step_number}`,
      body: step.message,
      variant: step.variant ?? null,
      when: first
        ? `${Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / 60_000)} to ${Math.round(
            LINKEDIN_LIMITS.acceptFollowUpMaxMs / 60_000,
          )} minutes after they accept`
        : `${step.delay_days} ${step.delay_days === 1 ? "day" : "days"} after the message before it`,
      /*
       * Step 1 has no configurable delay, and saying so is the point.
       *
       * What precedes it is the acceptance, not a message — so `delay_days` is
       * meaningless there, and left configurable the Targeting Agent wrote 3
       * into step 1 of every campaign this deployment ever built. Three
       * strangers accepted a connection request and heard nothing for three
       * days. A screen that still showed "3 days" would be the second reading
       * of a rule, and the screen's is the one somebody believes.
       */
      fixed: first
        ? `Sent while they still remember accepting. This one is not on a schedule — ${FIRST_STEP_DELAY_DAYS === 0 ? "it goes out the same day" : "it follows the acceptance"}, whatever a step number suggests.`
        : undefined,
    });
  }

  return out;
}

export function Sequence({ steps }: { steps: SequenceStep[] }) {
  return (
    <ol className="sequence">
      {steps.map((step, i) => (
        <li key={`${step.label}-${i}`} className="sequence-step">
          <div className="sequence-rail" aria-hidden>
            <span className="sequence-dot" />
            {i < steps.length - 1 ? <span className="sequence-line" /> : null}
          </div>
          <div className="sequence-body">
            <p className="sequence-head">
              <span className="sequence-label">{step.label}</span>
              {step.variant ? <span className="pill small">{step.variant}</span> : null}
              <span className="tiny subtle">{step.when}</span>
            </p>
            {/* The message as a prospect reads it, in a quote rather than a
                field: this is copy, and a textarea makes it look like config. */}
            {step.body ? <blockquote className="sequence-message">{step.body}</blockquote> : null}
            {step.fixed ? <p className="tiny subtle prose">{step.fixed}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
