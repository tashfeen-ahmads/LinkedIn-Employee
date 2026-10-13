/*
 * The reply gate, drawn: every condition applyRules checks, in its order.
 * Free of server-only imports, so the client simulator can render it.
 */

/**
 * Exactly the conditions in applyRules, in the order it evaluates them.
 * `optional` marks the three a workspace can let the agent answer itself; the
 * rest hold in every mode (rule 41).
 */
const GATES = [
  { test: "Asked to be removed", then: "Stops for good", kind: "stop", optional: false },
  { test: "Asks to speak to a person", then: "Waits for you", kind: "hold", optional: false },
  { test: "The model is not confident", then: "Waits for you", kind: "hold", optional: false },
  { test: "Asks about price", then: "Waits for you", kind: "hold", optional: true },
  { test: "Raises legal or security", then: "Waits for you", kind: "hold", optional: true },
  { test: "Sounds annoyed", then: "Waits for you", kind: "hold", optional: true },
  { test: "Not interested", then: "Stops the sequence", kind: "stop", optional: false },
] as const;

/**
 * `active` names the condition that caught a reply (or "else" for one nothing
 * caught), so the playable gate on /how-it-works can light the row it hit.
 */
export function ReplyGate({ active = null }: { active?: string | null }) {
  return (
    <figure className="gate stack-4">
      <figcaption className="stack-1">
        <h3>What happens to a reply before anything is sent</h3>
        <p className="small muted">
          Every condition below is checked in this order. Any one of them is enough to stop.
        </p>
      </figcaption>

      <div className="gate-body">
        <div className="gate-in">
          <span className="pill accent">A reply arrives</span>
        </div>

        <ol className="gate-list">
          {GATES.map((gate) => (
            <li key={gate.test} className={`gate-row${active === gate.test ? " is-hit" : ""}`}>
              <span className="gate-test">
                {gate.test}
                {gate.optional ? <span className="tiny subtle"> (by default)</span> : null}
              </span>
              <span className="gate-arrow" aria-hidden="true" />
              <span className={`pill ${gate.kind === "stop" ? "danger" : "warning"}`}>{gate.then}</span>
            </li>
          ))}
        </ol>

        <div className={`gate-out${active === "else" ? " is-hit" : ""}`}>
          <span className="pill positive">Everything else: a reply is drafted</span>
          <p className="small muted prose">
            By default a clean reply waits for your approval; on autopilot it sends. You can let the
            agent answer the three holds marked &ldquo;by default,&rdquo; and the others stay on in
            every mode.
          </p>
        </div>
      </div>
    </figure>
  );
}
