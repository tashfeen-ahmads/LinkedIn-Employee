import Link from "next/link";
import { ONBOARDING_STEPS, nextStep, onboardingProgress, type OnboardingState } from "@le/shared";

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

  // nextStep, not "the first unticked row": required steps come first, so the
  // button here and the subject line of the nudge email name the same thing.
  const next = nextStep(state);

  return (
    <section className="card raised stack-4" aria-labelledby="setup-heading">
      <div className="between">
        <div className="stack-1">
          <h2 id="setup-heading">Finish setting up</h2>
          <p className="small muted">
            {done} of {total} done. Nothing sends until the required steps are.
          </p>
        </div>
        {next ? (
          <Link href={next.href} className="btn small">
            {next.label}
          </Link>
        ) : null}
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
                  {step.key === next?.key ? "Start" : "Open"}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
