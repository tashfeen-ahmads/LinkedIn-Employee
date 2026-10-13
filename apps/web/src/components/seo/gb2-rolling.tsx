import { DEFAULT_WORKING_HOURS, LINKEDIN_LIMITS } from "@le/shared";

/**
 * The rolling seven-day window on /guides/linkedin-weekly-invitation-limit:
 * one fully warmed account launched on a Wednesday, sending as much as each
 * count allows on every working day for two weeks, counted two ways.
 *
 * A count that resets on Monday hands the whole ceiling back at the start of
 * the second week, so the seven days either side of that Monday hold far
 * more than the ceiling. Nora's count, the last seven days (CLAUDE.md rule
 * 61), only gives back what ages out, so no seven days in a row ever hold
 * more. Both rows come from one simulation with the counting rule swapped,
 * and every total on the figure is computed from the rows. Server-only, no
 * script.
 */
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Monday first, the way the week is drawn. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const STRIP = [...WEEK, ...WEEK];
const WORKING = new Set<number>(DEFAULT_WORKING_HOURS.days);
const MAX = LINKEDIN_LIMITS.invitesPerDayMax;
const CEILING = LINKEDIN_LIMITS.invitesPerWeek;
const SPAN = 7;
/** The launch day: midweek, which is where a Monday reset does its damage. */
const LAUNCH = STRIP.indexOf(3);

type Counter = (row: readonly number[], index: number) => number;

/** Invitations a Monday reset still counts on day `index`: this calendar week's so far. */
const calendarWeek: Counter = (row, index) => {
  const monday = index - WEEK.indexOf(STRIP[index] ?? 1);
  return row.slice(Math.max(0, monday), index).reduce((a, b) => a + b, 0);
};

/** Invitations the last seven days still count on day `index`: the six before it. */
const lastSevenDays: Counter = (row, index) =>
  row.slice(Math.max(0, index - (SPAN - 1)), index).reduce((a, b) => a + b, 0);

/** Send the daily maximum on every working day from the launch, as far as the count allows. */
function simulate(counted: Counter): number[] {
  const row: number[] = [];
  STRIP.forEach((day, index) => {
    const sends = index >= LAUNCH && WORKING.has(day);
    row.push(sends ? Math.max(0, Math.min(MAX, CEILING - counted(row, index))) : 0);
  });
  return row;
}

const spanSum = (row: readonly number[], start: number) => row.slice(start, start + SPAN).reduce((a, b) => a + b, 0);

/** The first busiest seven days in a row on a strip. */
function busiest(row: readonly number[]): { start: number; total: number } {
  let best = { start: 0, total: -1 };
  for (let start = 0; start + SPAN <= row.length; start++) {
    const total = spanSum(row, start);
    if (total > best.total) best = { start, total };
  }
  return best;
}

const CALENDAR_ROW = simulate(calendarWeek);
const ROLLING_ROW = simulate(lastSevenDays);
const CALENDAR_PEAK = busiest(CALENDAR_ROW);
const ROLLING_PEAK = busiest(ROLLING_ROW);
/** Shade the calendar row's worst seven days in both strips, so the same days are compared. */
const SHADE = CALENDAR_PEAK.start;
const inShade = (i: number) => i >= SHADE && i < SHADE + SPAN;
/** The first day of the second week the rolling count lets the account send again. */
const RESUME = ROLLING_ROW.findIndex((n, i) => i >= SPAN && n > 0);

const short = (i: number) => SHORT[STRIP[i] ?? 0] ?? "";
const long = (i: number) => LONG[STRIP[i] ?? 0] ?? "";

export const ROLLING_EXAMPLE = {
  launchDay: long(LAUNCH),
  shadeStart: short(SHADE),
  shadeEnd: short(SHADE + SPAN - 1),
  /** The worst seven days in a row under a Monday reset. */
  calendarPeak: CALENDAR_PEAK.total,
  /** The worst seven days in a row under Nora's count, anywhere on the strip. */
  rollingPeak: ROLLING_PEAK.total,
  resumeDay: RESUME >= 0 ? long(RESUME) : "",
};

function Strip({ title, row, peak }: { title: string; row: readonly number[]; peak: number }) {
  const shaded = spanSum(row, SHADE);
  return (
    <div className="gb2-roll-row">
      <p className="gb2-roll-name">{title}</p>
      <ol className="gb2-roll-strip">
        {row.map((n, i) => (
          <li key={i} className={`gb2-roll-day${inShade(i) ? " is-in" : ""}${i === SPAN ? " is-week2" : ""}`}>
            <span className="gb2-roll-dow">{short(i)}</span>
            <span className={n > 0 ? "gb2-roll-n" : "gb2-roll-n is-zero"}>{n}</span>
          </li>
        ))}
      </ol>
      <p className={`gb2-roll-total${shaded > CEILING ? " is-over" : ""}`}>
        Shaded seven days: <strong>{shaded}</strong>
        {shaded > CEILING ? `, ${shaded - CEILING} over ${CEILING}` : `, at or under ${CEILING}`}. Busiest seven days in a
        row anywhere: {peak}.
      </p>
    </div>
  );
}

export function RollingWindow() {
  return (
    <figure className="gb2-roll">
      <p className="gb2-chart-title">One launch, counted two ways</p>
      <Strip title="A count that resets on Monday" row={CALENDAR_ROW} peak={CALENDAR_PEAK.total} />
      <Strip title="Nora’s count: the last seven days" row={ROLLING_ROW} peak={ROLLING_PEAK.total} />
      <p className="gb2-roll-key" aria-hidden="true">
        <span className="is-in">The same seven days in a row</span>
        <span>Outside them</span>
      </p>
      <figcaption className="gb2-caption">
        A fully warmed account launched on a {ROLLING_EXAMPLE.launchDay}, sending as much as the count allows, up to{" "}
        {MAX} a day on working days. A Monday reset hands the whole {CEILING} back at once, so the shaded{" "}
        {ROLLING_EXAMPLE.shadeStart} to {ROLLING_EXAMPLE.shadeEnd} holds {ROLLING_EXAMPLE.calendarPeak}. Counted over the
        last seven days, room comes back only as each day turns seven days old, so the account sends again on the following{" "}
        {ROLLING_EXAMPLE.resumeDay} and no seven days in a row hold more than {ROLLING_EXAMPLE.rollingPeak}.
      </figcaption>
    </figure>
  );
}
