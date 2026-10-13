import { DEFAULT_WORKING_HOURS, LINKEDIN_LIMITS } from "@le/shared";
import { nextGapMs, spreadGapMs } from "@le/linkedin";

/*
 * Small drawn figures for the AI SDR and timing guides. Server-only, because
 * @le/linkedin cannot be bundled for the browser, and drawn from the same
 * functions the sender calls so a figure cannot disagree with the product.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "8 a.m.", "12 p.m.", "6 p.m.": US style, as the copy around it is written. */
export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "a.m." : "p.m.";
  if (h === 12) return "noon";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

/** "9:07 a.m." from minutes after midnight. */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const suffix = h < 12 ? "a.m." : "p.m.";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${String(m).padStart(2, "0")} ${suffix}`;
}

/*
 * A fixed sequence stands in for Math.random, so the figure is the same on
 * every render and every gap in it is one the sender could really draw.
 */
const DRAWS = [0.42, 0.81, 0.13, 0.66, 0.29, 0.94, 0.51, 0.07, 0.73, 0.35, 0.58, 0.22];

function spreadDay(count: number, startHour: number, endHour: number): number[] {
  const startMin = startHour * 60;
  const endMs = (endHour - startHour) * HOUR;
  const times: number[] = [];
  let elapsed = 0;
  for (let i = 0; i < count; i++) {
    const draw = DRAWS[i % DRAWS.length]!;
    // The first invitation also waits one spread gap, as a loop starting at
    // the top of the day would place it.
    elapsed += spreadGapMs({ remaining: count - i, windowMs: endMs - elapsed, random: () => draw });
    times.push(startMin + elapsed / MINUTE);
  }
  return times;
}

function burst(count: number, startHour: number): number[] {
  const times: number[] = [startHour * 60];
  for (let i = 1; i < count; i++) {
    const draw = DRAWS[i % DRAWS.length]!;
    times.push(times[i - 1]! + nextGapMs(() => draw) / MINUTE);
  }
  return times;
}

/**
 * One working day, two ways: a day's allowance spread across the hours, and
 * the same allowance sent from 9 a.m. at the floor gap, which is a burst.
 */
export function PacingDayFigure() {
  const start = DEFAULT_WORKING_HOURS.start;
  const end = DEFAULT_WORKING_HOURS.end;
  const count = LINKEDIN_LIMITS.invitesPerDayStart;
  const spread = spreadDay(count, start, end);
  const cluster = burst(count, 9);
  const clusterEnd = cluster[cluster.length - 1]!;

  const w = 640;
  const left = 10;
  const plotW = w - left * 2;
  const x = (minutes: number) => left + ((minutes - start * 60) / ((end - start) * 60)) * plotW;
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const rows = [
    {
      key: "is-spread",
      label: `Spread across the day: ${clock(spread[0]!)} to ${clock(spread[spread.length - 1]!)}`,
      desc: `${count} invitations spread from ${clock(spread[0]!)} to ${clock(spread[spread.length - 1]!)}.`,
      times: spread,
    },
    {
      key: "is-burst",
      label: `Sent from 9 a.m. at the floor gap: all out by ${clock(clusterEnd)}`,
      desc: `The same ${count} invitations sent from 9:00 a.m., all out by ${clock(clusterEnd)}.`,
      times: cluster,
    },
  ];

  return (
    <figure className="ga1-figure ga1-pace">
      {rows.map((row, index) => {
        const last = index === rows.length - 1;
        const h = last ? 74 : 40;
        return (
          <div key={row.key} className={`ga1-pace-row ${row.key}`}>
            <p className="ga1-pace-label">{row.label}</p>
            <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={row.desc}>
              {hours.map((hour) => (
                <line key={hour} x1={x(hour * 60)} x2={x(hour * 60)} y1={4} y2={36} className="ga1-pace-grid" />
              ))}
              <line x1={left} x2={left + plotW} y1={20} y2={20} className="ga1-pace-track" />
              {row.times.map((t, i) => (
                <circle key={i} cx={x(t)} cy={20} r={7} className="ga1-pace-dot" />
              ))}
              {last
                ? hours.filter((hour) => (hour - start) % 2 === 0).map((hour) => (
                    <text
                      key={hour}
                      x={x(hour * 60)}
                      y={66}
                      className="ga1-pace-axis"
                      textAnchor={hour === start ? "start" : hour === end ? "end" : "middle"}
                    >
                      {hourLabel(hour)}
                    </text>
                  ))
                : null}
            </svg>
          </div>
        );
      })}
      <figcaption>
        Both rows send the same {count} invitations, the starting daily allowance, in a working day of{" "}
        {hourLabel(start)} to {hourLabel(end)} The gaps come from the functions Nora&apos;s sender runs, with a fixed set of random draws so
        the picture stays the same between visits.
      </figcaption>
    </figure>
  );
}

export interface CostBar {
  label: string;
  /** Dollars a year; null for a free row, which is said in words. */
  value: number | null;
  note: string;
}

/**
 * Annual cost, one shared scale, every value written beside its bar. A free
 * row draws no bar and says so, rather than a zero that reads as missing.
 */
export function CostBars({ caption, bars }: { caption: string; bars: readonly CostBar[] }) {
  const top = Math.max(...bars.map((b) => b.value ?? 0), 1);
  return (
    <figure className="ga1-figure">
      <ul className="ga1-bars" aria-label={caption}>
        {bars.map((bar) => (
          <li key={bar.label}>
            <div className="ga1-bars-head">
              <span className="ga1-bars-label">{bar.label}</span>
              <span className="ga1-bars-value">
                {bar.value === null ? "Free" : `$${bar.value.toLocaleString("en-US")} a year`}
              </span>
            </div>
            <span className="ga1-bars-track" aria-hidden="true">
              {bar.value ? (
                <span className="ga1-bars-fill" style={{ width: `${Math.max(1.5, (bar.value / top) * 100)}%` }} />
              ) : null}
            </span>
            <span className="ga1-bars-note">{bar.note}</span>
          </li>
        ))}
      </ul>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export interface Rewrite {
  /** Who the invented prospect is. */
  who: string;
  /** The profile detail the rewritten note leaned on, quoted. */
  detail: string;
  before: string;
  after: string;
}

/**
 * Template note and rewritten note side by side, one card per prospect. A
 * four-column table squeezed both notes into columns a few words wide; here
 * each note reads at its real length, and the count is measured, not typed.
 */
export function RewritePairs({ caption, items, max }: { caption: string; items: readonly Rewrite[]; max: number }) {
  return (
    <figure className="ga1-figure ga1-rewrites">
      <ol className="ga1-rewrites-list">
        {items.map((item) => (
          <li key={item.who} className="ga1-rewrite">
            <p className="ga1-rewrite-who">{item.who}</p>
            <div className="ga1-rewrite-pair">
              <div className="ga1-rewrite-note is-before">
                <p className="ga1-rewrite-label">Merge-field template</p>
                <p className="ga1-rewrite-text">{item.before}</p>
              </div>
              <div className="ga1-rewrite-note is-after">
                <p className="ga1-rewrite-label">Written from the profile</p>
                <p className="ga1-rewrite-text">{item.after}</p>
                <p className="ga1-rewrite-meta">
                  {item.after.length} of {max} characters
                </p>
              </div>
            </div>
            <p className="ga1-rewrite-used">
              <span>Detail it used</span> {item.detail}
            </p>
          </li>
        ))}
      </ol>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/**
 * Where one Eastern sending day lands in each US time zone, on that zone's own
 * clock. The part of the day that arrives before the prospect's working day
 * starts is drawn in the warning color, so the shared hours read at a glance.
 */
export function ZoneOverlap({
  zones,
  start,
  end,
}: {
  zones: ReadonlyArray<{ name: string; city: string; behind: number }>;
  start: number;
  end: number;
}) {
  const furthest = Math.max(...zones.map((z) => z.behind));
  const axisStart = start - furthest;
  const axisEnd = end;
  const span = axisEnd - axisStart;
  const at = (hour: number) => `${(((hour - axisStart) / span) * 100).toFixed(2)}%`;
  const width = (from: number, to: number) => `${(((to - from) / span) * 100).toFixed(2)}%`;
  const ticks = Array.from({ length: span + 1 }, (_, i) => axisStart + i);
  return (
    <figure className="ga1-figure ga1-zones">
      <ul className="ga1-zones-list">
        {zones.map((zone) => {
          const sendFrom = start - zone.behind;
          const sendTo = end - zone.behind;
          const early = Math.max(0, Math.min(sendTo, start) - sendFrom);
          const inside = Math.max(0, sendTo - Math.max(sendFrom, start));
          const summary =
            early > 0
              ? `${hourLabel(sendFrom)} to ${hourLabel(sendTo)}; the first ${early === 1 ? "hour arrives" : `${early} hours arrive`} before their day starts`
              : `${hourLabel(sendFrom)} to ${hourLabel(sendTo)}, all inside their day`;
          return (
            <li key={zone.name} className="ga1-zone">
              <p className="ga1-zone-label">
                <strong>
                  {zone.name} ({zone.city})
                </strong>{" "}
                {summary}
              </p>
              <div className="ga1-zone-track" aria-hidden="true">
                {ticks.map((t) => (
                  <span key={t} className="ga1-zone-tick" style={{ left: at(t) }} />
                ))}
                <span className="ga1-zone-day" style={{ left: at(start), width: width(start, end) }} />
                {early > 0 ? (
                  <span className="ga1-zone-send is-early" style={{ left: at(sendFrom), width: width(sendFrom, sendFrom + early) }} />
                ) : null}
                {inside > 0 ? (
                  <span
                    className="ga1-zone-send is-inside"
                    style={{ left: at(Math.max(sendFrom, start)), width: width(Math.max(sendFrom, start), Math.max(sendFrom, start) + inside) }}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="ga1-zones-axis" aria-hidden="true">
        {ticks
          .filter((t) => t === axisEnd || ((t - axisStart) % 3 === 0 && axisEnd - t >= 2))
          .map((t) => (
            <span key={t} style={{ left: at(t) }}>
              {hourLabel(t)}
            </span>
          ))}
      </div>
      <figcaption>
        {/^(8|11)\b/.test(hourLabel(start)) ? "An" : "A"} {hourLabel(start)} to {hourLabel(end)} ET sending day, shown
        on each zone&apos;s local clock. The outline is that
        zone&apos;s own {hourLabel(start)} to {hourLabel(end)} working day; amber is sending that lands before it starts.
      </figcaption>
    </figure>
  );
}

export interface RateBar {
  label: string;
  /** A share, 0 to 100. */
  value: number;
  note: string;
}

/**
 * Rates on one shared scale with a marked threshold, every value written next
 * to its bar. A bar under the threshold takes the warning color; the line says
 * where the threshold comes from.
 */
export function RateBars({
  caption,
  bars,
  threshold,
  thresholdLabel,
}: {
  caption: string;
  bars: readonly RateBar[];
  threshold: number;
  thresholdLabel: string;
}) {
  const top = Math.ceil(Math.max(threshold, ...bars.map((b) => b.value)) / 10) * 10;
  const pos = (v: number) => `${((v / top) * 100).toFixed(2)}%`;
  return (
    <figure className="ga1-figure">
      <ul className="ga1-bars ga1-rates" aria-label={caption}>
        {bars.map((bar) => (
          <li key={bar.label}>
            <div className="ga1-bars-head">
              <span className="ga1-bars-label">{bar.label}</span>
              <span className="ga1-bars-value">{bar.value}%</span>
            </div>
            <span className="ga1-bars-track ga1-rates-track" aria-hidden="true">
              <span className={`ga1-bars-fill${bar.value < threshold ? " is-below" : ""}`} style={{ width: pos(bar.value) }} />
              <span className="ga1-rates-mark" style={{ left: pos(threshold) }} />
            </span>
            <span className="ga1-bars-note">{bar.note}</span>
          </li>
        ))}
      </ul>
      <p className="ga1-rates-key">
        <span className="ga1-rates-swatch" aria-hidden="true" /> {thresholdLabel}
      </p>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export interface RangeRow {
  label: string;
  versions: ReadonlyArray<{ name: string; rate: number; low: number; high: number; text: string }>;
  verdict: string;
  separated: boolean;
}

/**
 * Two acceptance rates as likely ranges on a 0 to 100% scale, one pair per
 * sample size. Overlapping bars are the picture of "too early to call".
 */
export function RangeFigure({ caption, rows }: { caption: string; rows: readonly RangeRow[] }) {
  const pos = (v: number) => `${(v * 100).toFixed(2)}%`;
  return (
    <figure className="ga1-figure ga1-ranges">
      <ul className="ga1-ranges-list">
        {rows.map((row) => (
          <li key={row.label} className="ga1-range-group">
            <p className="ga1-range-head">
              <strong>{row.label}</strong>
              <span className={row.separated ? "ga1-range-verdict is-yes" : "ga1-range-verdict"}>{row.verdict}</span>
            </p>
            {row.versions.map((v, i) => (
              <div key={v.name} className={`ga1-range is-v${i + 1}`}>
                <span className="ga1-range-name">{v.name}</span>
                <span className="ga1-range-track" aria-hidden="true">
                  <span className="ga1-range-band" style={{ left: pos(v.low), width: pos(v.high - v.low) }} />
                  <span className="ga1-range-dot" style={{ left: pos(v.rate) }} />
                </span>
                <span className="ga1-range-text">{v.text}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      <div className="ga1-range is-axis" aria-hidden="true">
        <span className="ga1-range-name" />
        <span className="ga1-ranges-axis">
          {[0, 25, 50, 75, 100].map((t) => (
            <span key={t} style={{ left: `${t}%` }}>
              {t}%
            </span>
          ))}
        </span>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
