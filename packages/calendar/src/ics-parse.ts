import type { BusyInterval } from "./provider.js";

/**
 * Busy time, read out of a published calendar feed.
 *
 * The own calendar cannot see a meeting booked anywhere else, which makes
 * double-booking a matter of whether the rep remembered to block something out.
 * A published .ics URL closes most of that gap and needs no OAuth, no scopes
 * and no brand verification — Google and Outlook both hand out a secret feed
 * address from their own settings.
 *
 * Every decision here errs towards *more* busy time rather than less. A block
 * we invent costs an offered slot; a block we miss costs a rep sitting in two
 * meetings at once, and they find out by being in one of them.
 */

export interface ParseOptions {
  /** Only events overlapping this window are returned. */
  from: Date;
  to: Date;
  /**
   * What to assume for a datetime with no zone and no TZID. RFC 5545 calls
   * these "floating" and says they mean local time wherever the calendar is
   * read — for a rep's own feed, that is the rep's own timezone.
   */
  fallbackTimezone: string;
  /** Guards against a feed with a runaway recurrence rule. */
  maxIntervals?: number;
}

export function parseIcsBusy(text: string, options: ParseOptions): BusyInterval[] {
  const max = options.maxIntervals ?? 2000;
  const out: BusyInterval[] = [];

  for (const block of vevents(unfold(text))) {
    const event = readEvent(block, options.fallbackTimezone);
    if (!event) continue;

    for (const occurrence of expand(event, options)) {
      if (out.length >= max) return out;
      out.push(occurrence);
    }
  }
  return out;
}

/**
 * RFC 5545 wraps long lines: CRLF followed by one space or tab continues the
 * previous line. Reading a folded file line-by-line silently truncates every
 * long value, and the one that matters is RRULE.
 */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

function* vevents(lines: string[]): Generator<string[]> {
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith("BEGIN:VEVENT")) current = [];
    else if (line.startsWith("END:VEVENT")) {
      if (current) yield current;
      current = null;
    } else if (current) current.push(line);
  }
}

interface IcsEventShape {
  start: number;
  end: number;
  allDay: boolean;
  rrule: string | null;
  exdates: number[];
}

function readEvent(lines: string[], fallbackTimezone: string): IcsEventShape | null {
  let start: { at: number; allDay: boolean } | null = null;
  let end: { at: number; allDay: boolean } | null = null;
  let duration: number | null = null;
  let rrule: string | null = null;
  const exdates: number[] = [];

  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    const key = name.split(";")[0]!.toUpperCase();

    // An event the organiser cancelled is not busy time, and a feed keeps it
    // for clients that need to remove it.
    if (key === "STATUS" && value.toUpperCase() === "CANCELLED") return null;
    // "Free"/"Show me as available". Honouring it is the difference between a
    // usable calendar and one where a day marked out-of-office for information
    // blocks every slot in it.
    if (key === "TRANSP" && value.toUpperCase() === "TRANSPARENT") return null;

    if (key === "DTSTART") start = parseDateTime(name, value, fallbackTimezone);
    if (key === "DTEND") end = parseDateTime(name, value, fallbackTimezone);
    if (key === "DURATION") duration = parseDuration(value);
    if (key === "RRULE") rrule = value;
    if (key === "EXDATE") {
      for (const part of value.split(",")) {
        const parsed = parseDateTime(name, part.trim(), fallbackTimezone);
        if (parsed) exdates.push(parsed.at);
      }
    }
  }

  if (!start) return null;

  let finish: number;
  if (end) finish = end.at;
  else if (duration !== null) finish = start.at + duration;
  // RFC 5545: an event with a DATE start and no end lasts one day; a
  // date-time one with no end has no duration. A zero-length block is not
  // busy time, so it is dropped rather than recorded as a point in time.
  else if (start.allDay) finish = start.at + 86_400_000;
  else return null;

  if (!(finish > start.at)) return null;
  return { start: start.at, end: finish, allDay: start.allDay, rrule, exdates };
}

/**
 * A DTSTART in each of the three forms RFC 5545 allows.
 *
 * `...Z` is UTC. `TZID=Europe/London` is local to a named zone. Bare is
 * floating. The middle one is the interesting case: the offset depends on the
 * date, so it has to be computed for that instant rather than taken once.
 */
function parseDateTime(name: string, value: string, fallbackTimezone: string): { at: number; allDay: boolean } | null {
  const isDate = /;VALUE=DATE(;|$)/i.test(name) || /^\d{8}$/.test(value);
  const tzid = /;TZID=([^;:]+)/i.exec(name)?.[1];

  const digits = value.replace(/[^0-9TZ]/g, "");
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/.exec(digits);
  if (!m) return null;

  const [, y, mo, d, hh = "00", mm = "00", ss = "00", z] = m;
  const parts = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(hh),
    minute: Number(mm),
    second: Number(ss),
  };

  if (z) return { at: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second), allDay: isDate };

  // An all-day event has no time and belongs to the calendar's own day, so it
  // is resolved in the rep's zone rather than UTC — otherwise a day off in
  // Auckland blocks the wrong twenty-four hours.
  const zone = tzid ?? fallbackTimezone;
  return { at: localToUtc(parts, zone), allDay: isDate };
}

/**
 * Wall-clock time in a named zone, as an instant.
 *
 * There is no tz database here, so the offset is recovered from `Intl`: format
 * a guess as if it were in that zone, see how far the answer is from what we
 * asked for, and correct. Twice, because a guess an hour out can land on the
 * wrong side of a daylight-saving change and the first correction then uses
 * the wrong offset.
 */
function localToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timezone: string,
): number {
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const offset = offsetAt(guess, timezone);
    const corrected = wanted - offset;
    if (corrected === guess) break;
    guess = corrected;
  }
  return guess;
}

/** How far ahead of UTC a zone is at a given instant, in milliseconds. */
function offsetAt(instant: number, timezone: string): number {
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(instant));
  } catch {
    // An unknown zone means we cannot do better than UTC, and guessing an
    // offset would move every block in the feed by hours.
    return 0;
  }
  const m = /(\d{4})-(\d{2})-(\d{2}),?\s+(\d{2}):(\d{2}):(\d{2})/.exec(formatted);
  if (!m) return 0;
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) % 24, Number(m[5]), Number(m[6]));
  return asUtc - instant;
}

/** ISO 8601 durations, in the subset calendars actually emit. */
function parseDuration(value: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, sign, w, d, h, min, s] = m;
  const ms =
    Number(w ?? 0) * 604_800_000 +
    Number(d ?? 0) * 86_400_000 +
    Number(h ?? 0) * 3_600_000 +
    Number(min ?? 0) * 60_000 +
    Number(s ?? 0) * 1000;
  return sign === "-" ? -ms : ms;
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/**
 * The occurrences of one event that fall inside the window.
 *
 * A weekly standup counted once is fifty-one slots a year offered on top of a
 * meeting that is actually happening, so RRULE is not optional. Handled here:
 * DAILY, WEEKLY (with BYDAY), MONTHLY and YEARLY, with INTERVAL, COUNT and
 * UNTIL. Anything else expands as a single occurrence rather than being
 * dropped — one real block beats none.
 */
function expand(event: IcsEventShape, options: ParseOptions): BusyInterval[] {
  const from = options.from.getTime();
  const to = options.to.getTime();
  const length = event.end - event.start;
  const out: BusyInterval[] = [];

  const push = (start: number) => {
    if (event.exdates.includes(start)) return;
    const end = start + length;
    if (start < to && end > from) out.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
  };

  if (!event.rrule) {
    push(event.start);
    return out;
  }

  const rule = Object.fromEntries(
    event.rrule.split(";").map((part) => {
      const [k, v] = part.split("=");
      return [k?.toUpperCase() ?? "", v ?? ""];
    }),
  );

  const freq = (rule.FREQ ?? "").toUpperCase();
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1) || 1);
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  const until = rule.UNTIL ? parseDateTime("DTSTART", rule.UNTIL, "UTC")?.at ?? Infinity : Infinity;
  const byDay = (rule.BYDAY ?? "")
    .split(",")
    .map((d) => DAY_CODES.indexOf(d.trim().slice(-2).toUpperCase()))
    .filter((i) => i >= 0);

  // Bounded two ways: never past the window, and never more iterations than a
  // daily rule could produce across it. A malformed FREQ cannot spin here.
  const horizon = Math.min(to, until);
  let emitted = 0;
  let cursor = event.start;
  const maxSteps = Math.ceil((horizon - event.start) / 86_400_000) + 366;

  for (let step = 0; step <= maxSteps && cursor <= horizon && emitted < count; step++) {
    if (freq === "WEEKLY" && byDay.length > 0) {
      // Each named day of this week, so "every Tuesday and Thursday" is two
      // blocks a week rather than one.
      const weekStart = cursor - new Date(cursor).getUTCDay() * 86_400_000;
      for (const day of byDay) {
        const at = weekStart + day * 86_400_000;
        if (at >= event.start && at <= horizon && emitted < count) {
          push(at);
          emitted++;
        }
      }
    } else {
      push(cursor);
      emitted++;
    }

    if (freq === "DAILY") cursor += interval * 86_400_000;
    else if (freq === "WEEKLY") cursor += interval * 7 * 86_400_000;
    else if (freq === "MONTHLY") cursor = addMonths(cursor, interval);
    else if (freq === "YEARLY") cursor = addMonths(cursor, interval * 12);
    else break;
  }

  return out;
}

function addMonths(instant: number, months: number): number {
  const d = new Date(instant);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}
