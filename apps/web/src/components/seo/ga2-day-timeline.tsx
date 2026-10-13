import { invitePaceMs } from "@le/linkedin";
import { LINKEDIN_LIMITS } from "@le/shared";

/**
 * One sending day drawn twice: the burst the first live account sent, and the
 * same kind of allowance spread the way the sender now spreads it.
 *
 * HTML rather than SVG so the labels stay readable at phone width: a drawing
 * scaled down to 358px shrinks its text with it. The spread row is computed
 * from `invitePaceMs`, the function the sender uses, at the middle of its
 * random range, so the picture cannot drift from the code.
 */

const MINUTE_MS = 60_000;
/** The axis: 9 a.m. to 6 p.m. */
const AXIS_START_MIN = 9 * 60;
const AXIS_END_MIN = 18 * 60;
/** The working day the spread row is placed in: 9 a.m. to 5 p.m. */
const DAY_END_MIN = 17 * 60;

/** The incident: seven invitations, the first at 4:52 p.m. and the last at 5:19 p.m. */
export const BURST_FIRST_MIN = 16 * 60 + 52;
export const BURST_LAST_MIN = 17 * 60 + 19;
const BURST_COUNT = 7;

function burstTimes(): number[] {
  const step = (BURST_LAST_MIN - BURST_FIRST_MIN) / (BURST_COUNT - 1);
  return Array.from({ length: BURST_COUNT }, (_, i) => BURST_FIRST_MIN + i * step);
}

/** A day's allowance placed one gap at a time, each gap re-read from the time and count left. */
function spreadTimes(count: number): number[] {
  const times: number[] = [];
  let now = AXIS_START_MIN;
  for (let left = count; left > 0; left--) {
    const paceMs = invitePaceMs({ remaining: left, windowMs: (DAY_END_MIN - now) * MINUTE_MS }) ?? LINKEDIN_LIMITS.minGapMs;
    now += Math.max(paceMs, LINKEDIN_LIMITS.minGapMs) / MINUTE_MS;
    times.push(now);
  }
  return times;
}

function at(minute: number): string {
  return `${(((minute - AXIS_START_MIN) / (AXIS_END_MIN - AXIS_START_MIN)) * 100).toFixed(2)}%`;
}

export function clock(minute: number): string {
  const rounded = Math.round(minute);
  const h24 = Math.floor(rounded / 60);
  const m = rounded % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  const suffix = h24 < 12 ? "a.m." : "p.m.";
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

const TICKS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((h) => h * 60);
const LABELLED = new Set([9 * 60, 12 * 60, 15 * 60, 18 * 60]);

export function DayTimeline({ dailyCount }: { dailyCount: number }) {
  const burst = burstTimes();
  const spread = spreadTimes(dailyCount);
  return (
    <figure className="ga2-timeline">
      <div className="ga2-tl-row">
        <p className="ga2-tl-label">
          <strong>Day one, before the fix:</strong> {BURST_COUNT} invitations between {clock(BURST_FIRST_MIN)} and{" "}
          {clock(BURST_LAST_MIN)}
        </p>
        <div className="ga2-tl-track" aria-hidden="true">
          {TICKS.map((t) => (
            <span key={t} className="ga2-tl-tick" style={{ left: at(t) }} />
          ))}
          {burst.map((t, i) => (
            <span key={i} className="ga2-tl-dot is-burst" style={{ left: at(t) }} />
          ))}
        </div>
      </div>
      <div className="ga2-tl-row">
        <p className="ga2-tl-label">
          <strong>Spread today:</strong> {dailyCount} invitations between {clock(spread[0] ?? AXIS_START_MIN)} and{" "}
          {clock(spread[spread.length - 1] ?? DAY_END_MIN)}
        </p>
        <div className="ga2-tl-track" aria-hidden="true">
          {TICKS.map((t) => (
            <span key={t} className="ga2-tl-tick" style={{ left: at(t) }} />
          ))}
          {spread.map((t, i) => (
            <span key={i} className="ga2-tl-dot is-spread" style={{ left: at(t) }} />
          ))}
        </div>
      </div>
      <div className="ga2-tl-axis" aria-hidden="true">
        {TICKS.filter((t) => LABELLED.has(t)).map((t) => (
          <span key={t} style={{ left: at(t) }}>
            {t === 12 * 60 ? "noon" : clock(t)}
          </span>
        ))}
      </div>
      <figcaption>
        One sending day, 9 a.m. to 6 p.m. Top: the burst from the incident (the first and last times are real; the five in
        between are drawn evenly). Bottom: a first-day allowance spread across a 9 a.m. to 5 p.m. working day by the same
        calculation the sender uses, shown at the middle of its random range. Real days vary around it.
      </figcaption>
    </figure>
  );
}
