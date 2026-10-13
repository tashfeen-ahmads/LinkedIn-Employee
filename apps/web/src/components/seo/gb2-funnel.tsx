/**
 * The seven gates of /guides/linkedin-prospecting, drawn as a sequence a
 * prospect passes through, each gate naming the mistake it stops. Gate 3 is
 * the checkpoint: nobody goes further unless a person can open their profile.
 *
 * Equal-width gates on purpose: the diagram shows order, not how many people
 * survive each step, and narrowing bars would read as a count nobody measured.
 * Server-only, no script; each gate links to its section of the guide.
 */
const GATES = [
  { id: "who-buys", step: "Decide who buys", stops: "Writing to people who resemble you: peers and competitors." },
  { id: "search", step: "Turn it into a search", stops: "A search that returns nobody, or the wrong people, with no error." },
  {
    id: "check-profiles",
    step: "Check every profile",
    stops: "Spending a capped invitation on someone nobody looked at.",
    check: "Checkpoint: only people a reviewer can open go further.",
  },
  {
    id: "contact-once",
    step: "Exclude, and contact once",
    stops: "Writing to a customer, or to the same stranger twice.",
    note: "Checked again right before every send.",
  },
  { id: "one-note", step: "One note per person", stops: "A template the recipient recognizes as a template." },
  { id: "pace", step: "Pace the sending", stops: "A burst of invitations, the pattern behind most restrictions." },
  { id: "follow-up", step: "Follow up, answer, book", stops: "An acceptance followed by silence, or by a pitch." },
] as const;

export function ProspectingGates() {
  return (
    <figure className="gb2-funnel" aria-labelledby="gb2-funnel-title">
      <p className="gb2-chart-title" id="gb2-funnel-title">
        Seven gates from a profile to a meeting, and what each one stops
      </p>
      <ol className="gb2-gates">
        {GATES.map((gate, i) => (
          <li key={gate.id} className={`gb2-gate${"check" in gate ? " is-check" : ""}`}>
            <span className="gb2-gate-n" aria-hidden="true">
              {i + 1}
            </span>
            <span className="gb2-gate-body">
              <a href={`#${gate.id}`} className="gb2-gate-step">
                <span className="sr-only">Step {i + 1}: </span>
                {gate.step}
              </a>
              <span className="gb2-gate-stops">
                Stops: {gate.stops.charAt(0).toLowerCase() + gate.stops.slice(1)}
              </span>
              {"check" in gate ? <span className="gb2-gate-flag">{gate.check}</span> : null}
              {"note" in gate ? <span className="gb2-gate-flag">{gate.note}</span> : null}
            </span>
          </li>
        ))}
        <li className="gb2-gate is-end">
          <span className="gb2-gate-n" aria-hidden="true" />
          <span className="gb2-gate-body">
            <span className="gb2-gate-step">A conversation, then a meeting</span>
          </span>
        </li>
      </ol>
    </figure>
  );
}
