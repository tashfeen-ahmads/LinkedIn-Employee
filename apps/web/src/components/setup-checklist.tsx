import Link from "next/link";
import {
  ONBOARDING_STEPS,
  isReadyToSend,
  nextStep,
  onboardingProgress,
  type OnboardingState,
} from "@le/shared";

/**
 * What is left to set up.
 *
 * Reads ONBOARDING_STEPS — the same list the nudge emails read — so the app and
 * the inbox can never disagree about what is outstanding. An email asking for
 * something the dashboard says is done tells the reader nobody is paying
 * attention.
 *
 * Disappears entirely once everything is done rather than lingering as a row of
 * ticks: a finished checklist is clutter on a page someone opens every morning.
 */
export function SetupChecklist({ state }: { state: OnboardingState }) {
  const { done, total } = onboardingProgress(state);
  if (done === total) return null;

  /*
   * Once everything required is finished, this stops being a checklist.
   *
   * A workspace at five of six with one optional step left was shown a
   * full-width card naming that step, and directly beneath it a second
   * full-width card with a progress meter and six rows — to say the same one
   * thing. Two heavy blocks for one small suggestion reads as a product that
   * cannot tell what matters.
   *
   * So it steps back to a line. The remaining step is already named above; all
   * this has to add is that nothing is blocked.
   */
  if (isReadyToSend(state)) {
    return (
      <p className="small subtle">
        {done} of {total} steps done — everything required is finished, so campaigns can send. The
        rest is worth doing when you have a minute.
      </p>
    );
  }

  // nextStep, not "the first unticked row": required steps come first, so the
  // button here and the subject line of the nudge email name the same thing.
  const next = nextStep(state);

  return (
    <section className="card raised stack-4" aria-labelledby="setup-heading">
      {/*
        No button here, and that is the point.

        `NextStep` sits directly above this on the overview and its whole job is
        naming the one thing to do, as a full-width card with that action on it.
        Repeating the same label as a second button six lines below it gave the
        screen two identical calls to action stacked on top of each other —
        which does not read as emphasis, it reads as a page that has lost track
        of itself. This is the reference list; the instruction is above.
      */}
      <div className="stack-1">
        <h2 id="setup-heading">Finish setting up</h2>
        <p className="small muted">
          {done} of {total} done. Nothing sends until the required steps are.
        </p>
      </div>

      <div className="step-meter" role="presentation">
        {ONBOARDING_STEPS.map((step) => (
          <span
            key={step.key}
            className={state[step.key] ? "is-done" : step.key === next?.key ? "is-next" : ""}
          />
        ))}
      </div>

      <ol className="checklist">
        {ONBOARDING_STEPS.map((step) => {
          const complete = state[step.key];
          return (
            <li
              key={step.key}
              className={`checklist-row${complete ? " is-done" : ""}${
                step.key === next?.key ? " is-next" : ""
              }`}
            >
              <span className="checklist-tick" aria-hidden="true">
                {complete ? "✓" : ""}
              </span>
              <div className="stack-1 grow">
                <div className="cluster">
                  <span className="small">{step.label}</span>
                  {step.key === next?.key ? <span className="pill accent tiny">next</span> : null}
                  {step.required || complete ? null : <span className="pill plain tiny">optional</span>}
                </div>
                {complete ? null : <p className="tiny subtle">{step.why}</p>}
              </div>
              {/* The action sits at the end of its own row rather than the label
                  doubling as a link. A row that was both a sentence and a
                  control never said which part to click. */}
              {complete ? null : (
                <Link href={step.href} className="btn ghost small checklist-go">
                  Open
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
