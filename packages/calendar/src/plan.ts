import { isWithinWorkingHours, type WorkingHours } from "@le/shared";
import type { BusyInterval } from "./provider.js";
import { mergeIntervals, offerableStarts } from "./slots.js";

/**
 * What a week actually looks like, day by day.
 *
 * The availability screen was four number boxes and a row of checkboxes. That
 * is the *rule*, and a rep cannot read a rule and know what a prospect will be
 * offered on Thursday — they have to hold the working hours, the notice
 * period, the buffers, the daily maximum and every existing meeting in their
 * head and run the algorithm themselves. Nobody does that, so nobody knows
 * what the product is about to say on their behalf, which is why the screen
 * carried a sentence apologising for it instead.
 *
 * This renders the same answer the Reply Agent will give. Both go through
 * `offerableStarts`, so the calendar cannot show a time the agent would not
 * offer, or hide one it would — rule 6's whole point, applied to the screen
 * rather than only to the message.
 */
export interface PlannedSlot {
  /** ISO start. The thing a prospect would actually be given. */
  start: string;
  end: string;
}

export interface PlannedMeeting extends PlannedSlot {
  id: string;
  /** Who it is with, as far as this product knows. Never a guess. */
  who: string | null;
}

export type DayState = "offerable" | "none-left" | "outside-hours" | "full";

export interface DayPlan {
  /** `YYYY-MM-DD` in the rep's own zone, which is the only date they mean. */
  date: string;
  /** 0 = Sunday, matching `WorkingHours.days`. */
  weekday: number;
  /** A working day at all? A weekend is not "fully booked", it is not offered. */
  working: boolean;
  /** Meetings this product booked. */
  meetings: PlannedMeeting[];
  /** Everything else that makes a time unavailable: blackouts, a feed's busy. */
  blocked: PlannedSlot[];
  /** Every start a prospect could be given, in order. */
  free: string[];
  /** Why this day looks the way it does, so the screen never has to guess. */
  state: DayState;
}

export interface PlanOptions {
  from: Date;
  days: number;
  durationMinutes: number;
  workingHours: WorkingHours;
  timezone: string;
  /** Meetings booked here, which are both busy and worth showing by name. */
  meetings: PlannedMeeting[];
  /** Blackouts and any calendar feed's busy time. Busy, and nothing else. */
  blocked: BusyInterval[];
  minNoticeHours?: number;
  bufferMinutes?: number;
  /** The rep's own ceiling. A day at it offers nothing more. */
  maxPerDay?: number;
}

/**
 * The days a rep is looking at, each carrying what it would offer and why.
 *
 * `maxPerDay` is applied here rather than inside `offerableStarts` because it
 * is a preference about a day and not a fact about a time: a day already at
 * the rep's ceiling has free half-hours that are deliberately not on offer,
 * and a screen that drew them as available would be promising something the
 * booking path then refuses.
 */
export function planDays(options: PlanOptions): DayPlan[] {
  const {
    from,
    days,
    durationMinutes,
    workingHours,
    timezone,
    meetings,
    blocked,
    minNoticeHours,
    bufferMinutes,
    maxPerDay,
  } = options;

  const durationMs = durationMinutes * 60_000;
  const start = startOfDay(from, timezone);
  const end = new Date(start.getTime() + days * 86_400_000);

  // One call for the whole range rather than one per day: the notice period is
  // measured from now, so a per-day call would recompute the same cutoff seven
  // times and a day boundary in the rep's zone is not a day boundary in UTC.
  const free = offerableStarts({
    from: start,
    to: end,
    durationMinutes,
    workingHours,
    timezone,
    // Both kinds of busy, because a time is unavailable whether the reason is
    // a meeting we booked or an hour the rep blocked out.
    busy: [...meetings.map(({ start: s, end: e }) => ({ start: s, end: e })), ...blocked],
    minNoticeHours,
    bufferMinutes,
  });

  const freeByDay = groupByDay(free, timezone);
  const plans: DayPlan[] = [];

  for (let index = 0; index < days; index++) {
    const dayStart = new Date(start.getTime() + index * 86_400_000);
    const date = dayKey(dayStart, timezone);
    const weekday = weekdayIn(dayStart, timezone);
    const working = workingHours.days.includes(weekday);

    const dayMeetings = meetings
      .filter((m) => dayKey(new Date(m.start), timezone) === date)
      .sort((a, b) => a.start.localeCompare(b.start));
    const dayBlocked = mergeIntervals(blocked)
      .filter((b) => overlapsDay(b, dayStart, timezone))
      .map((b) => ({ start: b.start, end: b.end }));

    let dayFree = freeByDay.get(date) ?? [];
    // The ceiling counts meetings already booked, or a rep with two meetings
    // and a maximum of three would still be offered three more.
    const room = maxPerDay === undefined ? dayFree.length : Math.max(0, maxPerDay - dayMeetings.length);
    const capped = dayFree.slice(0, room);

    plans.push({
      date,
      weekday,
      working,
      meetings: dayMeetings,
      blocked: dayBlocked,
      free: capped,
      state: !working
        ? "outside-hours"
        : capped.length > 0
          ? "offerable"
          : dayFree.length > 0 || dayMeetings.length > 0
            ? "full"
            : "none-left",
    });
    void durationMs;
  }

  return plans;
}

/** Midnight in the rep's zone, which is where their day actually starts. */
function startOfDay(date: Date, timezone: string): Date {
  const key = dayKey(date, timezone);
  // Walk back from the instant to the first minute that still reads as this
  // date locally. Cheaper and more honest than assuming a fixed offset, which
  // is wrong twice a year.
  let cursor = new Date(date.getTime());
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < 48; i++) {
    const probe = new Date(cursor.getTime() + i * 3_600_000);
    if (dayKey(probe, timezone) === key) return probe;
  }
  return cursor;
}

function dayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "short" }).format(date);
}

function weekdayIn(date: Date, timezone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function groupByDay(starts: string[], timezone: string): Map<string, string[]> {
  const byDay = new Map<string, string[]>();
  for (const start of starts) {
    const key = dayKey(new Date(start), timezone);
    const list = byDay.get(key);
    if (list) list.push(start);
    else byDay.set(key, [start]);
  }
  return byDay;
}

function overlapsDay(interval: BusyInterval, dayStart: Date, timezone: string): boolean {
  const from = dayStart.getTime();
  const to = from + 86_400_000;
  const s = Date.parse(interval.start);
  const e = Date.parse(interval.end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  void timezone;
  // Overlapping the day, not contained by it: a block that began yesterday
  // evening and runs into this morning still makes this morning busy.
  return s < to && e > from;
}

/** The hours a day is drawn across, so every column shares one scale. */
export function dayExtent(hours: WorkingHours): { start: number; end: number } {
  return { start: hours.start, end: hours.end };
}

export { isWithinWorkingHours };
