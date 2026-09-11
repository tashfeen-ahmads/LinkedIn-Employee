import { dailyInviteCap } from "@le/linkedin";
import { LINKEDIN_LIMITS } from "@le/shared";
import { DrawPath } from "./reveal";

/*
 * Diagrams that show a mechanism, not decoration.
 *
 * Each one is drawn from the constants or the functions the product actually
 * runs on, so none of them can drift from the thing they claim to describe. A
 * marketing diagram that disagrees with the code is worse than no diagram: it
 * is a confident, illustrated lie.
 */

/* ------------------------------------------------------ the warm-up ramp */

/**
 * Day zero of the ramp is an account's first invitation, not the day it was
 * connected — see dailyInviteCap. An account that has been connected for weeks
 * and never sent anything is still on the left-hand edge of this chart.
 */
const DAY_ZERO = new Date("2026-01-01T00:00:00Z");
const RAMP_DAYS = LINKEDIN_LIMITS.warmupDays + 7;

/** Every point on this line is a call to the function that gates real sends. */
const RAMP = Array.from({ length: RAMP_DAYS + 1 }, (_, day) => ({
  day,
  cap: dailyInviteCap(DAY_ZERO, new Date(DAY_ZERO.getTime() + day * 86_400_000)),
}));

export function WarmupRamp() {
  const w = 720;
  const h = 260;
  const pad = { top: 20, right: 56, bottom: 34, left: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const maxY = LINKEDIN_LIMITS.invitesPerDayMax;
  const x = (day: number) => pad.left + (day / RAMP_DAYS) * plotW;
  const y = (cap: number) => pad.top + plotH - (cap / maxY) * plotH;

  // A step line, because the cap changes once a day rather than continuously.
  const steps = RAMP.flatMap((point, index) => {
    const previous = RAMP[index - 1];
    return previous ? [`L${x(point.day)},${y(previous.cap)}`, `L${x(point.day)},${y(point.cap)}`] : [];
  });
  const line = `M${x(0)},${y(RAMP[0]!.cap)} ${steps.join(" ")}`;
  const area = `${line} L${x(RAMP_DAYS)},${pad.top + plotH} L${x(0)},${pad.top + plotH} Z`;

  const ticks = [0, 10, 20, 30, 35];

  return (
    <figure className="chart stack-3">
      <figcaption className="stack-1">
        <h3>What a new account is allowed to send, from its first invitation</h3>
        <p className="small muted">
          Drawn by calling <code>dailyInviteCap</code> — the same function the sender checks before
          every invitation. Not a redrawing of it.
        </p>
      </figcaption>

      <svg viewBox={`0 0 ${w} ${h}`} role="img" className="chart-svg" aria-labelledby="ramp-title">
        <title id="ramp-title">
          Daily invitation cap rising from {LINKEDIN_LIMITS.invitesPerDayStart} to{" "}
          {LINKEDIN_LIMITS.invitesPerDayMax} over {LINKEDIN_LIMITS.warmupDays} days, then flat.
        </title>

        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} className="grid" />
            <text x={pad.left - 8} y={y(tick) + 4} className="axis" textAnchor="end">
              {tick}
            </text>
          </g>
        ))}

        <path d={area} className="area" />
        <DrawPath d={line} className="line" />

        {/* The one moment worth naming, labelled on the mark rather than in a
            legend the reader has to look away to decode. */}
        <line
          x1={x(LINKEDIN_LIMITS.warmupDays)}
          x2={x(LINKEDIN_LIMITS.warmupDays)}
          y1={pad.top}
          y2={pad.top + plotH}
          className="marker"
        />
        {/* Sat at the foot of its own rule rather than at the top, where it
            collided with the line it was labelling. */}
        <text x={x(LINKEDIN_LIMITS.warmupDays) + 6} y={pad.top + plotH - 8} className="axis strong">
          fully warmed
        </text>
        <text x={x(RAMP_DAYS)} y={y(maxY) - 8} className="axis strong" textAnchor="end">
          {maxY} a day
        </text>
        <text x={x(2)} y={y(LINKEDIN_LIMITS.invitesPerDayStart) - 14} className="axis">
          starts at {LINKEDIN_LIMITS.invitesPerDayStart}
        </text>

        {[0, 7, 14, 21, 28, 35, 42].map((day) => (
          <text key={day} x={x(day)} y={h - 12} className="axis" textAnchor="middle">
            {day === 0 ? "first send" : `d${day}`}
          </text>
        ))}
      </svg>

      <details className="chart-table">
        <summary className="small muted">See the numbers</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th className="num">Invitations allowed</th>
              </tr>
            </thead>
            <tbody>
              {[0, 7, 14, 21, 28, 35, 42].map((day) => (
                <tr key={day}>
                  <td className="mono">{day}</td>
                  <td className="num mono">{RAMP[day]!.cap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/* ---------------------------------------------------------- the reply gate */

/** Exactly the conditions in applyRules, in the order it evaluates them. */
const GATES = [
  { test: "Asked to be removed", then: "Stops for good", kind: "stop" },
  { test: "The model is not confident", then: "Waits for you", kind: "hold" },
  { test: "Asks about price", then: "Waits for you", kind: "hold" },
  { test: "Raises legal or security", then: "Waits for you", kind: "hold" },
  { test: "Asks to speak to a person", then: "Waits for you", kind: "hold" },
  { test: "Sounds annoyed", then: "Waits for you", kind: "hold" },
  { test: "Not interested", then: "Stops the sequence", kind: "stop" },
] as const;

export function ReplyGate() {
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
            <li key={gate.test} className="gate-row">
              <span className="gate-test">{gate.test}</span>
              <span className="gate-arrow" aria-hidden="true" />
              <span className={`pill ${gate.kind === "stop" ? "danger" : "warning"}`}>{gate.then}</span>
            </li>
          ))}
        </ol>

        <div className="gate-out">
          <span className="pill positive">Everything else — a reply is drafted</span>
          <p className="small muted">
            On approval mode it waits for your click. On autopilot it sends. The conditions above do
            not change between the two; only what happens to a clean message does.
          </p>
        </div>
      </div>
    </figure>
  );
}

/* ------------------------------------------------------------ the pipeline */

const STAGES = [
  { name: "Strategy", does: "Writes your customer profiles" },
  { name: "Targeting", does: "Builds the list and the copy" },
  { name: "Reply", does: "Answers and books" },
] as const;

export function Pipeline() {
  return (
    <figure className="pipeline stack-4">
      <figcaption className="stack-1">
        <h3>Where a person sits in the loop</h3>
        <p className="small muted">
          Three agents, and a human gate before each one&rsquo;s work is acted on.
        </p>
      </figcaption>

      <ol className="pipeline-row">
        {STAGES.map((stage, index) => (
          <li key={stage.name} className="pipeline-stage">
            <div className="card tight stack-2 pipeline-card">
              <span className="eyebrow">Agent {index + 1}</span>
              <strong>{stage.name}</strong>
              <span className="small muted">{stage.does}</span>
            </div>
            <div className="pipeline-gate">
              <span className="pill plain">You approve</span>
            </div>
          </li>
        ))}
        <li className="pipeline-stage">
          <div className="card tight stack-2 pipeline-card pipeline-end">
            <span className="eyebrow">Outcome</span>
            <strong>A meeting</strong>
            <span className="small muted">In your calendar, with the conversation attached</span>
          </div>
        </li>
      </ol>
    </figure>
  );
}
