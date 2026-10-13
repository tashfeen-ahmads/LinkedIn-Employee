import { DEFAULT_WORKING_HOURS, LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";

/**
 * The warm-up ramp on /guides/linkedin-warm-up-schedule, drawn and tabulated
 * from one reading of the sender's own `dailyInviteCap`.
 *
 * Server-only: @le/linkedin cannot be bundled for the browser, and the chart
 * needs no script. It is plain HTML bars on one axis (invitations a day), so it
 * reflows to a phone instead of shrinking its labels inside a fixed viewBox.
 *
 * A first send on a Monday (January 5, 2026) lines the weeks up with the
 * default Monday-to-Friday hours; only the distance from the first send
 * matters to the cap.
 */
const DAY_MS = 86_400_000;
const FIRST_SEND = new Date("2026-01-05T09:00:00Z");
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Weeks the ramp takes, then one full week after it. */
export const WARMUP_WEEKS = Math.ceil(LINKEDIN_LIMITS.warmupDays / 7);
/** Working days in the default week. */
export const WORKING_DAYS = DEFAULT_WORKING_HOURS.days.length;
/** The weekly ceiling spread evenly over the working week: the pace to plan for. */
export const EVEN_DAILY = Math.floor(LINKEDIN_LIMITS.invitesPerWeek / WORKING_DAYS);

export interface RampWeek {
  week: number;
  firstDay: number;
  lastDay: number;
  days: ReadonlyArray<{ name: string; cap: number }>;
  low: number;
  high: number;
  sum: number;
  /** What the week can actually hold: the daily caps added up, clamped by the weekly ceiling. */
  most: number;
  weeklyBinds: boolean;
}

export function warmupSchedule(): readonly RampWeek[] {
  return Array.from({ length: WARMUP_WEEKS + 1 }, (_, index) => {
    const days = DEFAULT_WORKING_HOURS.days.map((weekday) => {
      const offset = index * 7 + ((weekday + 6) % 7);
      return {
        name: DAY_NAMES[weekday] ?? String(weekday),
        cap: dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + offset * DAY_MS)),
      };
    });
    const caps = days.map((d) => d.cap);
    const sum = caps.reduce((a, b) => a + b, 0);
    return {
      week: index + 1,
      firstDay: index * 7,
      lastDay: index * 7 + 6,
      days,
      low: Math.min(...caps),
      high: Math.max(...caps),
      sum,
      most: Math.min(sum, LINKEDIN_LIMITS.invitesPerWeek),
      weeklyBinds: sum > LINKEDIN_LIMITS.invitesPerWeek,
    };
  });
}

export function capRange(low: number, high: number): string {
  return low === high ? String(low) : `${low} to ${high}`;
}

export function RampChart() {
  const weeks = warmupSchedule();
  const top = Math.ceil(LINKEDIN_LIMITS.invitesPerDayMax / 10) * 10;
  const ticks = Array.from({ length: top / 10 + 1 }, (_, i) => i * 10);
  const pct = (n: number) => `${(n / top) * 100}%`;
  const first = weeks[0]!;
  const full = weeks[weeks.length - 1]!;

  return (
    <figure className="gb2-chart">
      <p className="gb2-chart-title" id="gb2-ramp-title">
        Invitations allowed each working day, from the first send
      </p>
      <p className="sr-only">
        A bar for each working day of the first {weeks.length} weeks. The allowance starts at {first.low} a day and
        climbs a little each day to {full.high} from week {full.week}. A dashed line at {EVEN_DAILY} a day marks the weekly
        ceiling of {LINKEDIN_LIMITS.invitesPerWeek} spread over {WORKING_DAYS} days. The table below gives every number.
      </p>
      <div className="gb2-plot" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} className="gb2-tick" style={{ bottom: pct(t) }}>
            <span>{t}</span>
          </span>
        ))}
        <span className="gb2-ref" style={{ bottom: pct(EVEN_DAILY) }}>
          <span className="gb2-ref-label">
            {LINKEDIN_LIMITS.invitesPerWeek} a week = {EVEN_DAILY} a day
          </span>
        </span>
        <div className="gb2-weeks">
          {weeks.map((w) => (
            <div key={w.week} className="gb2-week">
              <div className="gb2-bars">
                {w.days.map((d) => (
                  <span
                    key={d.name}
                    className="gb2-bar"
                    style={{ height: pct(d.cap) }}
                    title={`Week ${w.week}, ${d.name}: ${d.cap}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="gb2-week-labels" aria-hidden="true">
        {weeks.map((w) => (
          <span key={w.week}>
            <strong>
              <span className="gb2-wk-word">Week </span>
              {w.week > WARMUP_WEEKS ? `${w.week}+` : w.week}
            </strong>
            <span className="gb2-wk-range">{capRange(w.low, w.high)}</span>
          </span>
        ))}
      </div>
      <p className="gb2-week-axis" aria-hidden="true">
        Weeks from the first send
      </p>
      <figcaption className="gb2-caption">
        Each bar is one working day&apos;s allowance. Days above the dashed line are allowed, but a week of them would pass
        the weekly ceiling, so from week {weeks.find((w) => w.weeklyBinds)?.week ?? full.week} the week runs out before the
        days do.
      </figcaption>
    </figure>
  );
}
