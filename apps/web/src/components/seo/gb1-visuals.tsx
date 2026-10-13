import type { CSSProperties, ReactNode } from "react";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";

/**
 * Small drawn pieces for the notes and follow-up guides (bans, character limit,
 * templates, follow-up after connection, follow-up sequence, should you add a
 * note). Server components: nothing here needs the browser.
 *
 * Every number a visual draws is passed in from the page, which takes it from
 * `@le/shared` or computes it from the text it prints, so a bar can never be
 * longer or shorter than the figure written beside it.
 */

/**
 * The length to aim a connection note at. `INVITE_NOTE_MAX_CHARS` is the hard
 * stop Nora enforces; the aim sits a little under it so a longer name or a
 * second thought on review does not tip a note over.
 */
export const NOTE_AIM = { low: INVITE_NOTE_MAX_CHARS - 20, high: INVITE_NOTE_MAX_CHARS - 10 } as const;

/** An hour of the day on a 12-hour clock, the way a US reader writes it: "8 a.m.", "6 p.m.". */
export function clock(hour: number, minute = 0): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "a.m." : "p.m.";
  const display = h % 12 === 0 ? 12 : h % 12;
  return minute ? `${display}:${String(minute).padStart(2, "0")} ${suffix}` : `${display} ${suffix}`;
}

/** A summary box that replaces a bare "In short:" paragraph. */
export function Gb1Summary({ title = "In short", children }: { title?: string; children: ReactNode }) {
  return (
    <div className="article-callout gb1-summary" role="note">
      <p className="gb1-summary-title">{title}</p>
      {children}
    </div>
  );
}

export interface Gb1Step {
  /** The date or offset, as words: "March 25, 2026", "Day 0". */
  when: string;
  /** A machine-readable date for `<time>`, when `when` is a real date. */
  dateTime?: string;
  title: string;
  body?: ReactNode;
  /** The wait before this step, drawn as a connector whose length grows with `size`. */
  gap?: { label: string; size: number };
  /** "muted" for a step that is reported or still open rather than settled. */
  tone?: "solid" | "muted" | "end";
}

/**
 * A vertical timeline. Used for dated events (the bans page) and for a sequence
 * whose gaps grow (the follow-up sequence page). Vertical on every screen, so it
 * needs no phone fallback and labels never collide.
 */
export function Gb1Timeline({ label, steps }: { label: string; steps: readonly Gb1Step[] }) {
  return (
    <figure className="gb1-figure">
      <figcaption className="gb1-caption">{label}</figcaption>
      <ol className="gb1-timeline">
        {steps.map((step) => (
          <li
            key={`${step.when}-${step.title}`}
            className={`gb1-step is-${step.tone ?? "solid"}`}
            style={step.gap ? ({ "--gb1-gap": step.gap.size } as CSSProperties) : undefined}
          >
            {step.gap ? <p className="gb1-gap">{step.gap.label}</p> : null}
            <div className="gb1-step-body">
              <p className="gb1-when">
                {step.dateTime ? <time dateTime={step.dateTime}>{step.when}</time> : step.when}
              </p>
              <p className="gb1-title">{step.title}</p>
              {step.body ? <div className="gb1-detail">{step.body}</div> : null}
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/**
 * Note lengths drawn against LinkedIn's two published ceilings and the length to
 * aim for. Every bar has its count written beside it, so nothing depends on
 * reading a length against the marks, and the note itself sits under its label
 * so the words and their length are read together.
 */
export function Gb1LengthBars({
  notes,
  free,
  premium,
  caption,
}: {
  notes: readonly { label: string; length: number; text?: string }[];
  free: number;
  premium: number;
  caption?: string;
}) {
  const scale = Math.max(premium, ...notes.map((n) => n.length));
  const pct = (n: number) => `${((n / scale) * 100).toFixed(2)}%`;
  const marks = {
    "--gb1-aim-from": pct(NOTE_AIM.low),
    "--gb1-aim-to": pct(NOTE_AIM.high),
    "--gb1-free": pct(free),
    "--gb1-premium": pct(premium),
  } as CSSProperties;
  return (
    <figure className="gb1-figure">
      <figcaption className="gb1-caption">
        {caption ?? `The notes against the ${free}-character limit on a free account and the ${premium} on Premium`}
      </figcaption>
      <ul className="gb1-bars" style={marks}>
        {notes.map((note) => {
          const over = note.length > free;
          return (
            <li key={note.label} className="gb1-bar-row">
              <p className="gb1-bar-label">
                <span>{note.label}</span>
                <span className="gb1-bar-value">
                  {note.length} characters{over ? `, ${note.length - free} over ${free}` : `, ${free - note.length} to spare`}
                </span>
              </p>
              {note.text ? <p className="gb1-bar-text">&ldquo;{note.text}&rdquo;</p> : null}
              <div className="gb1-track" aria-hidden="true">
                <span className="gb1-aim" />
                <span className={over ? "gb1-fill is-over" : "gb1-fill"} style={{ width: pct(note.length) }} />
                <span className="gb1-mark is-free" />
                <span className="gb1-mark is-premium" />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="gb1-legend" aria-hidden="true">
        <span className="gb1-legend-free">{free}: the hard stop</span>
        <span className="gb1-legend-aim">
          {NOTE_AIM.low} to {NOTE_AIM.high}: the length to aim for
        </span>
        <span className="gb1-legend-premium">{premium}: Premium only</span>
      </p>
    </figure>
  );
}

/** A message as the person receives it. `avoid` greys it out: the version not to send. */
export function Gb1Message({ children, avoid = false }: { children: ReactNode; avoid?: boolean }) {
  return <p className={avoid ? "gb1-msg is-avoid" : "gb1-msg"}>{children}</p>;
}

export interface Gb1Situation {
  id: string;
  title: string;
  /** One line on when to use it and what to watch. */
  when: ReactNode;
  message: string;
}

/** Situations, each a card holding its guidance and one example message. */
export function Gb1Situations({ items }: { items: readonly Gb1Situation[] }) {
  return (
    <div className="gb1-sits">
      {items.map((item) => (
        <section key={item.id} className="gb1-sit" id={item.id} aria-labelledby={`${item.id}-title`}>
          <h3 id={`${item.id}-title`}>{item.title}</h3>
          <p className="gb1-sit-when">{item.when}</p>
          <Gb1Message>&ldquo;{item.message}&rdquo;</Gb1Message>
        </section>
      ))}
    </div>
  );
}

export interface Gb1PairItem {
  key: string;
  left: { label: string; text: string };
  right: { label: string; text: string };
  note?: ReactNode;
}

/** Messages in pairs, the one to avoid beside the one to send. */
export function Gb1Pairs({ items, label }: { items: readonly Gb1PairItem[]; label: string }) {
  return (
    <div className="gb1-pairs" role="group" aria-label={label}>
      {items.map((item) => (
        <div key={item.key} className="gb1-pair">
          <div className="gb1-pair-side">
            <p className="gb1-pair-label">{item.left.label}</p>
            <Gb1Message avoid>&ldquo;{item.left.text}&rdquo;</Gb1Message>
          </div>
          <div className="gb1-pair-side">
            <p className="gb1-pair-label">{item.right.label}</p>
            <Gb1Message>&ldquo;{item.right.text}&rdquo;</Gb1Message>
          </div>
          {item.note ? <p className="gb1-pair-note">{item.note}</p> : null}
        </div>
      ))}
    </div>
  );
}
