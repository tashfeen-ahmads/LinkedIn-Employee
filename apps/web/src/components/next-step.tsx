import Link from "next/link";
import type { OnboardingStep } from "@le/shared";

/**
 * The one thing to do next, said once and given the whole top of the page.
 *
 * The dashboard used to open with a greeting, a status line, a seven-item
 * checklist, a row of zeros and a table — five sections of equal weight and no
 * instruction anywhere. Somebody who has never seen this product cannot tell
 * from that which of the twelve sidebar links wants them, and the answer was
 * always knowable: `nextStep` has computed it for months and nothing led with
 * it.
 *
 * One action, not a list. A checklist is a reference for somebody who already
 * understands the product; a person on their first day needs to be told what to
 * press. The checklist still sits below this for the second reading.
 */
export function NextStep({ step, ready }: { step: OnboardingStep | null; ready: boolean }) {
  if (!step) {
    return (
      <section className="card next-step done">
        <p className="eyebrow">You are set up</p>
        <h2>Everything is connected and running.</h2>
        <p className="small muted">
          Invitations go out through the day, paced two to eleven minutes apart. Replies that need you
          appear in the Inbox — nothing is sent on your behalf without the rules you set.
        </p>
      </section>
    );
  }

  return (
    <section className="card next-step">
      <p className="eyebrow">{ready ? "Worth doing next" : "Your next step"}</p>
      <h2>{step.label}</h2>
      <p className="small muted">{step.why}</p>
      <p>
        <Link className="btn" href={step.href}>
          {step.label}
        </Link>
      </p>
      {!ready ? (
        // Said plainly, because the most common confusion in this product is
        // somebody waiting for something to happen that is waiting on them.
        <p className="tiny subtle">Nothing is sent to anybody until this is done.</p>
      ) : null}
    </section>
  );
}
