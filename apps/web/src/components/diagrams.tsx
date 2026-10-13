import { LINKEDIN_LIMITS } from "@le/shared";
import { RAMP, RAMP_DAYS } from "@/lib/marketing-examples";
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

/*
 * Day zero of the ramp is an account's first invitation, not the day it was
 * connected: see dailyInviteCap. An account that has been connected for weeks
 * and never sent anything is still on the left-hand edge of these charts.
 * `RAMP` is that function called once a day, in lib/marketing-examples.ts, so
 * the home page's tile and this page's chart are one series.
 */

/** A step line, because the cap changes once a day rather than continuously. */
function stepPath(x: (day: number) => number, y: (cap: number) => number): string {
  const steps = RAMP.flatMap((point, index) => {
    const previous = RAMP[index - 1];
    return previous ? [`L${x(point.day)},${y(previous.cap)}`, `L${x(point.day)},${y(point.cap)}`] : [];
  });
  return `M${x(0)},${y(RAMP[0]!.cap)} ${steps.join(" ")}`;
}

/**
 * The home page's ramp: the same series, drawn small, in the limits colour.
 * Dots mark one value a week so the line can be read against the axis.
 */
export function RampChart() {
  const w = 640;
  const h = 250;
  const pad = { top: 14, right: 16, bottom: 30, left: 30 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const maxY = 40;
  const x = (day: number) => pad.left + (day / RAMP_DAYS) * plotW;
  const y = (cap: number) => pad.top + plotH - (cap / maxY) * plotH;
  const weeks = [0, 7, 14, 21, 28, 35, 42].filter((d) => d <= RAMP_DAYS);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" className="mk-ramp" aria-labelledby="mk-ramp-title">
      <title id="mk-ramp-title">
        {`Daily invitation cap: ${weeks.map((d) => `day ${d}, ${RAMP[d]!.cap}`).join("; ")}.`}
      </title>
      {[0, 10, 20, 30, 40].map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={pad.left + plotW} y1={y(tick)} y2={y(tick)} className="mk-ramp-grid" />
          <text x={pad.left - 8} y={y(tick) + 4} className="mk-ramp-axis" textAnchor="end">
            {tick}
          </text>
        </g>
      ))}
      <path d={stepPath(x, y)} className="mk-ramp-line" />
      {weeks.map((day) => (
        <circle key={day} cx={x(day)} cy={y(RAMP[day]!.cap)} r={4} className="mk-ramp-dot" />
      ))}
      {weeks.map((day) => (
        <text
          key={day}
          x={x(day)}
          y={h - 8}
          // Every other week is dropped on a phone, where the labels are drawn
          // larger and seven of them would run into each other.
          className={`mk-ramp-axis${day % 14 === 7 ? " is-minor" : ""}`}
          textAnchor={day === 0 ? "start" : day === weeks[weeks.length - 1] ? "end" : "middle"}
        >
          {day === 0 ? "First send" : `Day ${day}`}
        </text>
      ))}
    </svg>
  );
}

/*
 * Drawn twice, at two widths, and the stylesheet shows one. A single 720-wide
 * drawing scaled onto a phone shrank its labels to about five pixels; the
 * narrow one is laid out for a phone's width, with fewer ticks, so its text
 * reaches the screen at the size it was set.
 */
function RampSvg({ narrow }: { narrow: boolean }) {
  const w = narrow ? 360 : 720;
  const h = narrow ? 240 : 260;
  const pad = narrow
    ? { top: 20, right: 20, bottom: 34, left: 30 }
    : { top: 20, right: 56, bottom: 34, left: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const maxY = LINKEDIN_LIMITS.invitesPerDayMax;
  const x = (day: number) => pad.left + (day / RAMP_DAYS) * plotW;
  const y = (cap: number) => pad.top + plotH - (cap / maxY) * plotH;

  const line = stepPath(x, y);
  const area = `${line} L${x(RAMP_DAYS)},${pad.top + plotH} L${x(0)},${pad.top + plotH} Z`;

  const ticks = narrow ? [0, 10, 20, 35] : [0, 10, 20, 30, 35];
  const days = (narrow ? [0, 14, 28, 42] : [0, 7, 14, 21, 28, 35, 42]).filter((d) => d <= RAMP_DAYS);
  const titleId = narrow ? "ramp-title-narrow" : "ramp-title";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      className={`chart-svg ${narrow ? "ramp-narrow" : "ramp-wide"}`}
      aria-labelledby={titleId}
    >
      {/*
        One string, not eight children.
        A `<title>` whose children are an array is the one piece of JSX React
        cannot serialise the same way twice: the browser treats everything
        inside the tag as a single text node, so the server's markup and the
        client's differ, React throws away the whole page tree and rebuilds
        it, and what a visitor sees is the landing page flickering on arrival.
      */}
      <title id={titleId}>
        {`Daily invitation cap rising from ${LINKEDIN_LIMITS.invitesPerDayStart} to ${LINKEDIN_LIMITS.invitesPerDayMax} over ${LINKEDIN_LIMITS.warmupDays} days, then flat.`}
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
      <text
        x={x(LINKEDIN_LIMITS.warmupDays) + (narrow ? -6 : 6)}
        y={pad.top + plotH - 8}
        className="axis strong"
        textAnchor={narrow ? "end" : "start"}
      >
        fully warmed
      </text>
      {narrow ? null : (
        <text x={x(RAMP_DAYS)} y={y(maxY) - 8} className="axis strong" textAnchor="end">
          {maxY} a day
        </text>
      )}
      {/* Under the line, not over it: the step line climbs through anything
          set above its first few days. */}
      <text x={x(0) + 6} y={y(LINKEDIN_LIMITS.invitesPerDayStart) + 18} className="axis">
        starts at {LINKEDIN_LIMITS.invitesPerDayStart}
      </text>

      {days.map((day) => (
        <text
          key={day}
          x={x(day)}
          y={h - 12}
          className="axis"
          textAnchor={day === 0 ? "start" : day === days[days.length - 1] ? "end" : "middle"}
        >
          {day === 0 ? "First send" : `Day ${day}`}
        </text>
      ))}
    </svg>
  );
}

export function WarmupRamp() {
  return (
    <figure className="chart stack-3">
      <figcaption className="stack-1">
        <h3>What a new account is allowed to send, from its first invitation</h3>
        <p className="small muted">
          Drawn from the same rule the sender checks before every invitation. Not a redrawing of
          it.
        </p>
      </figcaption>

      <RampSvg narrow={false} />
      <RampSvg narrow />

      <details className="chart-table">
        <summary className="small muted">See the numbers</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Daily invitation cap by day">
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
                  <td className="num">{day}</td>
                  <td className="num">{RAMP[day]!.cap}</td>
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

/* In its own module, because the playable gate is a client component and this
   file reads the worked example, which pulls a server-only package with it. */
export { ReplyGate } from "./reply-gate";
