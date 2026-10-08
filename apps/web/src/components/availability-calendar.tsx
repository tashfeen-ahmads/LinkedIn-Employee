import type { DayPlan } from "@le/calendar";

/**
 * The week a prospect would actually see, drawn.
 *
 * The availability screen was four number boxes and a row of checkboxes, which
 * is the *rule* rather than the answer. A rep cannot read "9 to 17, 30 minutes,
 * 12 hours notice, 15 either side, 3 a day" and know what Thursday looks like —
 * they would have to hold five settings and every booked meeting in their head
 * and run the algorithm themselves. So nobody knew what the product was about
 * to offer on their behalf, and the page carried a paragraph apologising for
 * that instead of showing it.
 *
 * Every mark here comes from `planDays`, which is built on the same
 * `offerableStarts` the Reply Agent uses. The calendar therefore cannot show a
 * time the agent would not offer, or hide one it would — which is rule 6
 * applied to the screen rather than only to the message. The alternative is two
 * readings of one rule, and the screen's is the one a rep believes.
 *
 * Drawn from a shared scale rather than positioned by hand, for rule 35's
 * reason: a block whose height disagrees with the hours it covers is a chart
 * lying about its own data.
 */
export function AvailabilityCalendar({
  days,
  timezone,
  openHour,
  closeHour,
}: {
  days: DayPlan[];
  timezone: string;
  openHour: number;
  closeHour: number;
}) {
  // The band every column is drawn against. Widened to include anything that
  // falls outside the working window — a meeting booked at eight in the
  // morning is exactly what a rep needs to see, and clipping it to the working
  // hours would draw the one thing they are looking for as nothing at all.
  const bounds = extent(days, timezone, openHour, closeHour);
  const span = Math.max(1, bounds.end - bounds.start);
  const hours = Array.from({ length: span + 1 }, (_, i) => bounds.start + i);

  return (
    <figure className="cal">
      <figcaption className="cal-legend">
        <span className="cal-key"><i className="cal-swatch is-free" /> Offered to prospects</span>
        <span className="cal-key"><i className="cal-swatch is-meeting" /> Booked here</span>
        <span className="cal-key"><i className="cal-swatch is-blocked" /> Busy or blocked</span>
        <span className="cal-key"><i className="cal-swatch is-closed" /> Outside your hours</span>
      </figcaption>

      {/*
        One grid per week, not one grid for the fortnight.
        Fourteen day columns after a single hour gutter wrap onto a second row
        that has no gutter of its own, so every day in week two sits one column
        to the left and Sunday lands under the clock. The columns still looked
        like a calendar, which is what made it worth catching — the marks were
        right and the dates above them were not.
      */}
      {weeksOf(days).map((week) => (
      <div key={week[0]!.date} className="cal-grid" style={{ "--cal-rows": span } as React.CSSProperties}>
        <div className="cal-hours" aria-hidden="true">
          {hours.map((hour) => (
            <span key={hour} className="cal-hour">{label(hour)}</span>
          ))}
        </div>

        {week.map((day) => (
          <div
            key={day.date}
            className={`cal-day${day.working ? "" : " is-closed"}`}
            /* Column 1 is the clock, so Sunday is 2 and Saturday is 8. Placed
               rather than flowed: a range starting on a Wednesday would
               otherwise pack its four days against the clock and print
               Wednesday under the column headed Sunday. */
            style={{ gridColumn: day.weekday + 2 }}
          >
            <p className="cal-date">
              <span className="cal-weekday">{weekdayName(day.date)}</span>
              <span className="cal-daynum">{dayNumber(day.date)}</span>
            </p>

            {/* Drawn for the eye only. The times live in `title` attributes on
                empty spans, which a screen reader does not reach, so the same
                marks are listed in words underneath. */}
            <div className="cal-track" aria-hidden="true">
              {/* Hour lines first, so every mark sits on the same scale. */}
              {hours.slice(1).map((hour) => (
                <span key={hour} className="cal-rule" style={pos(hour, hour, bounds)} aria-hidden="true" />
              ))}

              {day.blocked.map((block, i) => (
                <span
                  key={`b${i}`}
                  className="cal-mark is-blocked"
                  style={pos(hourOf(block.start, timezone), hourOf(block.end, timezone), bounds)}
                  title={`Busy ${time(block.start, timezone)}–${time(block.end, timezone)}`}
                />
              ))}

              {day.meetings.map((meeting) => (
                <span
                  key={meeting.id}
                  className="cal-mark is-meeting"
                  style={pos(hourOf(meeting.start, timezone), hourOf(meeting.end, timezone), bounds)}
                  title={`${meeting.who ?? "Meeting"} · ${time(meeting.start, timezone)}`}
                >
                  {/* The name, not a coloured bar somebody has to hover to read. */}
                  <span className="cal-mark-label">{meeting.who ?? "Meeting"}</span>
                </span>
              ))}

              {day.free.map((start) => (
                <span
                  key={start}
                  className="cal-mark is-free"
                  style={pos(hourOf(start, timezone), hourOf(start, timezone) + 0.5, bounds)}
                  title={`Can be offered at ${time(start, timezone)}`}
                />
              ))}
            </div>

            {marksInWords(day, timezone).length ? (
              <ul
                className="sr-only"
                role="list"
                aria-label={`${weekdayName(day.date)} ${dayNumber(day.date)}`}
              >
                {marksInWords(day, timezone).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : null}

            <p className="cal-note tiny">{note(day)}</p>
          </div>
        ))}
      </div>
      ))}
    </figure>
  );
}

/**
 * The days split into calendar weeks, each starting on the rep's Sunday.
 *
 * Chunking by seven from the first day would put a different weekday at the
 * left edge of each row, which reads as two unrelated strips rather than one
 * fortnight. The first row is short where the range starts mid-week, and its
 * missing days are drawn as gaps by the grid itself.
 */
function weeksOf(days: DayPlan[]): DayPlan[][] {
  const weeks: DayPlan[][] = [];
  for (const day of days) {
    const last = weeks[weeks.length - 1];
    if (!last || day.weekday === 0) weeks.push([day]);
    else last.push(day);
  }
  return weeks;
}

/**
 * What this day is, in words.
 *
 * A column with nothing in it has four different meanings — not a working day,
 * fully booked, at the daily ceiling, or too soon to offer — and drawn as
 * emptiness they are one. Saying which is the difference between a rep
 * changing a setting and a rep filing a bug.
 */
function note(day: DayPlan): string {
  if (!day.working) return "Not a working day";
  if (day.free.length > 0) {
    const times = `${day.free.length} time${day.free.length === 1 ? "" : "s"} offerable`;
    // The marks stop at the daily ceiling, so the empty afternoon underneath
    // them is a choice rather than a busy diary. Unsaid, a rep reads their own
    // setting as the product failing to find them any time.
    return day.meetings.length > 0 ? `${times} · ${day.meetings.length} booked` : times;
  }
  if (day.meetings.length > 0) return "At your daily maximum";
  if (day.blocked.length > 0) return "Blocked all day";
  return "Nothing offerable — inside your notice period";
}

/**
 * Every mark on one day as a sentence, in time order — the same facts the
 * blocks draw, for anybody who cannot see them.
 */
function marksInWords(day: DayPlan, timezone: string): string[] {
  const marks: Array<{ at: string; text: string }> = [
    ...day.blocked.map((block) => ({
      at: block.start,
      text: `Busy ${time(block.start, timezone)} to ${time(block.end, timezone)}`,
    })),
    ...day.meetings.map((meeting) => ({
      at: meeting.start,
      text: `${meeting.who ? `Meeting with ${meeting.who}` : "Meeting"} ${time(meeting.start, timezone)} to ${time(meeting.end, timezone)}`,
    })),
    ...day.free.map((start) => ({ at: start, text: `Can be offered at ${time(start, timezone)}` })),
  ];
  return marks
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map((mark) => mark.text);
}

/** Fractional hour of an instant, in the rep's zone. */
function hourOf(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/** Top and height as percentages of the shared band. */
function pos(from: number, to: number, bounds: { start: number; end: number }): React.CSSProperties {
  const span = Math.max(1, bounds.end - bounds.start);
  const top = ((from - bounds.start) / span) * 100;
  const height = ((Math.max(to, from + 0.25) - from) / span) * 100;
  return { top: `${clamp(top)}%`, height: `${clamp(height)}%` };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

/** The band to draw, widened past the working hours by anything real. */
function extent(days: DayPlan[], timezone: string, openHour: number, closeHour: number) {
  let start = openHour;
  let end = closeHour;
  for (const day of days) {
    for (const mark of [...day.meetings, ...day.blocked]) {
      start = Math.min(start, Math.floor(hourOf(mark.start, timezone)));
      end = Math.max(end, Math.ceil(hourOf(mark.end, timezone)));
    }
  }
  return { start: Math.max(0, start), end: Math.min(24, Math.max(end, start + 1)) };
}

const label = (hour: number) => `${String(hour % 24).padStart(2, "0")}:00`;

const time = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );

const weekdayName = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

const dayNumber = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
