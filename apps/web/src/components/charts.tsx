import type { ReactNode } from "react";

/**
 * The charts this product draws.
 *
 * Everything here is inline SVG with no library: four shapes, each doing one
 * job, is less code than a charting dependency's configuration — and a chart
 * built from a scale we own cannot silently draw a bar whose length does not
 * match its own label.
 *
 * Rules that hold in all of them:
 *  - one scale per chart, never two y-axes;
 *  - every series takes its colour from the validated `--viz-*` tokens, in
 *    fixed order, never cycled;
 *  - text wears text tokens, never the series colour, so a value stays legible
 *    when its mark is pale;
 *  - the number is written next to the mark, so nothing depends on reading a
 *    length against an axis;
 *  - the grid recedes behind the data.
 */

const SERIES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"] as const;

/** The colour for series `i`, by position. A fifth series folds into "Other". */
export function seriesColor(i: number): string {
  return SERIES[i % SERIES.length]!;
}

export interface FunnelStep {
  label: string;
  value: number;
  /** What this stage means, for the tooltip. */
  hint?: string;
}

/**
 * The outreach funnel as horizontal bars on one shared scale.
 *
 * Bars rather than the trapezoid every CRM draws: a trapezoid encodes the
 * numbers as *area*, so a stage holding half as many people looks a quarter as
 * big, and the drop-off it claims to show is the one thing it misrepresents.
 *
 * The scale is the first stage, so each bar reads as a share of everyone who
 * entered — and the conversion from the step above is printed on each row,
 * because the question is never "how many accepted" but "how many of the ones
 * we invited".
 */
export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1);

  return (
    <div className="funnel-chart">
      {steps.map((step, i) => {
        const previous = i === 0 ? null : steps[i - 1]!.value;
        const share = previous && previous > 0 ? step.value / previous : null;
        const width = Math.max(step.value > 0 ? 1.5 : 0, (step.value / top) * 100);
        return (
          <div className="funnel-row" key={step.label}>
            <div className="funnel-row-head">
              <span className="funnel-label">{step.label}</span>
              <span className="funnel-value mono">{step.value.toLocaleString()}</span>
            </div>
            <div className="funnel-track" title={step.hint ?? step.label}>
              <span
                className="funnel-bar"
                style={{ width: `${width}%`, background: seriesColor(0) }}
              />
            </div>
            {/* The conversion from the stage above, which is the number a rep
                actually acts on. Absent on the first row, where there is no
                "from" — never rendered as 100%, which would read as a result. */}
            <span className="funnel-rate tiny subtle">
              {share === null ? "entered" : `${Math.round(share * 100)}% of ${steps[i - 1]!.label.toLowerCase()}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface SeriesPoint {
  /** ISO date. */
  date: string;
  value: number;
}

/**
 * Invitations over time, as an area with its line on top.
 *
 * The one chart that answers "is this thing running", which five lifetime
 * totals cannot: totals only go up, so a campaign that stopped a fortnight ago
 * and one sending today look identical. This is the only shape on the page
 * that can fall.
 */
export function TrendChart({
  points,
  label,
  height = 132,
}: {
  points: SeriesPoint[];
  label: string;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <p className="small subtle">
        {label} appears once there are two days of sending to compare.
      </p>
    );
  }

  const width = 640;
  const pad = { top: 8, right: 8, bottom: 18, left: 8 };
  const peak = Math.max(1, ...points.map((p) => p.value));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const x = (i: number) => pad.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => pad.top + innerH - (v / peak) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(pad.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(pad.top + innerH).toFixed(1)} Z`;

  const total = points.reduce((sum, p) => sum + p.value, 0);
  const last = points[points.length - 1]!;

  return (
    <figure className="viz">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label}: ${total} over ${points.length} days, ${last.value} on ${last.date}`}
        preserveAspectRatio="none"
        className="viz-svg"
      >
        {/* Two gridlines, not a ruled page: the peak and the halfway mark are
            enough to read a magnitude against. */}
        {[0, 0.5].map((f) => (
          <line
            key={f}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + innerH * f}
            y2={pad.top + innerH * f}
            stroke="var(--viz-grid)"
            strokeWidth="1"
          />
        ))}
        <path d={area} fill={seriesColor(0)} opacity="0.12" />
        <path
          d={line}
          fill="none"
          stroke={seriesColor(0)}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* The endpoint, emphasised: where it got to is the point of the line.
            A ring in the surface colour keeps it readable over the area fill. */}
        <circle
          cx={x(points.length - 1)}
          cy={y(last.value)}
          r="4"
          fill={seriesColor(0)}
          stroke="var(--surface-raised)"
          strokeWidth="2"
        />
      </svg>
      <figcaption className="viz-caption tiny subtle">
        <span>{points[0]!.date}</span>
        <span className="viz-peak">peak {peak.toLocaleString()}</span>
        <span>{last.date}</span>
      </figcaption>
    </figure>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  /** Shown under the label — what the number is out of, or what it means. */
  note?: string;
  href?: string;
}

/**
 * A ranked comparison: strategies, campaigns, reps.
 *
 * Horizontal, because the labels are names and a rotated axis label is a chart
 * asking the reader to tilt their head. One hue: these are magnitudes of the
 * same thing, so a second colour would be claiming a difference that is not
 * in the data.
 */
export function RankedBars({ data, max }: { data: BarDatum[]; max?: number }) {
  const top = Math.max(1, max ?? Math.max(...data.map((d) => d.value), 1));
  return (
    <div className="ranked">
      {data.map((d) => (
        <div className="ranked-row" key={d.label}>
          <div className="ranked-head">
            <span className="ranked-label">{d.label}</span>
            <span className="mono small">{d.value.toLocaleString()}</span>
          </div>
          <div className="ranked-track">
            <span
              className="ranked-bar"
              style={{ width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / top) * 100)}%` }}
            />
          </div>
          {d.note ? <span className="tiny subtle">{d.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * One number that is the point of its tile, with what it is out of underneath.
 *
 * `tone` is a state, never decoration, and it always ships with a word as well
 * as a colour.
 */
export function Kpi({
  label,
  value,
  note,
  tone,
  trend,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  tone?: "positive" | "warning" | "neutral";
  /** A sparkline behind the number, when there is a history worth showing. */
  trend?: SeriesPoint[];
}) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${tone === "neutral" || !tone ? "" : `is-${tone}`}`}>{value}</span>
      {trend && trend.length > 1 ? <Sparkline points={trend} /> : null}
      {note ? <span className="kpi-note tiny subtle">{note}</span> : null}
    </div>
  );
}

/** A shape, not a chart: no axis, no labels, read only as a direction. */
export function Sparkline({ points, height = 26 }: { points: SeriesPoint[]; height?: number }) {
  if (points.length < 2) return null;
  const width = 120;
  const peak = Math.max(1, ...points.map((p) => p.value));
  const d = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - (p.value / peak) * (height - 3) - 1.5;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={seriesColor(0)} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export interface Allowance {
  label: string;
  used: number;
  cap: number;
  /** What the cap means, said rather than implied. */
  note?: string;
}

/**
 * An allowance as a meter: what was spent, against what is permitted.
 *
 * The competitors put a number here. A number alone answers "how many" and the
 * question a person actually has is "how close am I to the line" — which is the
 * whole anxiety this category runs on, given that a third of one competitor's
 * reviewers report being restricted inside ninety days.
 *
 * The bar is the *cap*, never the maximum of what happened to be sent. A meter
 * scaled to its own data always looks full, which is precisely the reading this
 * exists to prevent: 12 of 35 and 12 of 12 are the same picture if the scale
 * moves.
 *
 * Colour is earned, not decorative. Under four fifths it stays neutral, because
 * a bar that is amber at 40% teaches somebody to ignore amber — which is rule
 * 32's argument about marks, applied to a chart.
 */
export function AllowanceMeter({ label, used, cap, note }: Allowance) {
  const safeCap = Math.max(1, cap);
  const share = Math.min(1, used / safeCap);
  // Over the cap is drawn full and said in words. A bar longer than its track
  // is a rendering bug; a bar at 100% beside "16 of 14" is a fact.
  const tone = used >= cap ? "spent" : share >= 0.8 ? "close" : "clear";

  return (
    <div className="allowance" data-tone={tone}>
      <div className="allowance-head">
        <span className="tiny subtle">{label}</span>
        <span className="nums allowance-value">
          {used.toLocaleString()} <span className="subtle">of {cap.toLocaleString()}</span>
        </span>
      </div>
      <div
        className="allowance-track"
        role="meter"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-label={`${label}: ${used} of ${cap}`}
      >
        <div className="allowance-fill" style={{ width: `${share * 100}%` }} />
      </div>
      {note ? <p className="tiny subtle allowance-note">{note}</p> : null}
    </div>
  );
}

export interface StackedDay {
  /** ISO date, for the axis label and the key. */
  date: string;
  /** In fixed series order. Missing entries are zero, never absent. */
  values: number[];
}

/**
 * Days as stacked columns: what went out, and what came back, per day.
 *
 * The single trend line answered "are we sending" and never "is it working",
 * which are the two halves of the same worry — and reading them from two
 * separate charts means eyeballing one date against another. Stacked, a day is
 * one column and the proportions are the answer.
 *
 * Stacked rather than grouped because the series are parts of one day's work
 * rather than competitors for the same space, and because a grouped chart of
 * thirty days on a phone is sixty bars two pixels wide.
 *
 * Every segment keeps a 2px gap of surface, so two adjacent values never read
 * as one taller block. A day with nothing at all still gets its slot: dropping
 * the empty days would join Friday to Monday and draw a weekend that looks like
 * steady sending, and "did anything leave yesterday" is the question this chart
 * exists to answer.
 */
export function StackedDays({
  days,
  series,
  height = 120,
}: {
  days: StackedDay[];
  /** Fixed order, and the legend's order. Never more than four. */
  series: string[];
  height?: number;
}) {
  const totals = days.map((d) => d.values.reduce((sum, v) => sum + v, 0));
  const top = Math.max(1, ...totals);
  const width = Math.max(1, days.length) * 12;

  return (
    <figure className="viz">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="viz-svg viz-bars"
        role="img"
        aria-label={`${series.join(", ")} per day over ${days.length} days`}
      >
        {days.map((day, i) => {
          let y = height;
          return (
            <g key={day.date}>
              {day.values.map((value, s) => {
                if (value <= 0) return null;
                const h = (value / top) * (height - 2);
                y -= h;
                return (
                  <rect
                    key={s}
                    x={i * 12 + 2}
                    y={y}
                    width={8}
                    height={Math.max(1, h - 2)}
                    fill={seriesColor(s)}
                    rx={1}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      {/*
        A legend is always present for two or more series (rule 35): identity
        must never rest on colour alone. `.viz-legend` rather than a second
        caption class, because this is the same object the line chart captions —
        one name per thing, or the stylesheet grows two words for one idea.
      */}
      <figcaption className="viz-caption viz-legend tiny subtle">
        {series.map((name, i) => (
          <span key={name} className="viz-key">
            <span className="viz-swatch" style={{ background: seriesColor(i) }} aria-hidden />
            {name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
