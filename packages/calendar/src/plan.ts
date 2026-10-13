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
  // One midnight per local calendar date, never `start + n × 24h`: on the
  // day the clocks go back that day is 25 hours long, a fixed step lands at
  // 23:00 on the same date, and the week draws Sunday twice and loses its last
  // day — with every time the agent would have offered on it.
  const start = startOfDay(from, timezone);
  const dayStarts = Array.from({ length: days + 1 }, (_, index) => addLocalDays(start, index, timezone));
  const end = dayStarts[days]!;

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
    const dayStart = dayStarts[index]!;
    const dayEnd = dayStarts[index + 1]!;
    const date = dayKey(dayStart, timezone);
    const weekday = weekdayIn(dayStart, timezone);
    const working = workingHours.days.includes(weekday);

    const dayMeetings = meetings
      .filter((m) => dayKey(new Date(m.start), timezone) === date)
      .sort((a, b) => a.start.localeCompare(b.start));
    const dayBlocked = mergeIntervals(blocked)
      .filter((b) => overlapsDay(b, dayStart, dayEnd))
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
  const [y, m, d] = dayKey(date, timezone).split("-").map(Number);
  return zonedMidnight(y!, m!, d!, timezone);
}

/** Midnight `count` local calendar dates after `dayStart`, however long the days between. */
function addLocalDays(dayStart: Date, count: number, timezone: string): Date {
  const [y, m, d] = dayKey(dayStart, timezone).split("-").map(Number);
  return zonedMidnight(y!, m!, d! + count, timezone);
}

/**
 * The first instant of a local date. Computed from the zone's real offset on
 * that date rather than assumed, which is wrong twice a year, and rather than
 * probed hour by hour from UTC midnight, which lands on 09:00 east of
 * Greenwich and on the half hour in a +5:30 zone. `day` may overflow the
 * month: `Date.UTC` carries it.
 */
function zonedMidnight(year: number, month: number, day: number, timezone: string): Date {
  const wall = Date.UTC(year, month - 1, day);
  const key = new Date(wall).toISOString().slice(0, 10);
  let t = wall - offsetMs(new Date(wall), timezone);
  // Once more at the guess, because the offset at UTC midnight can differ from
  // the offset at local midnight across a change.
  t = wall - offsetMs(new Date(t), timezone);
  // A zone that changes its clocks at midnight has no 00:00 that day; the day
  // then starts at the first instant that reads as it.
  for (let i = 0; i < 4 && dayKey(new Date(t), timezone) < key; i++) t += 30 * 60_000;
  return new Date(t);
}

/** How far the zone's wall clock is ahead of UTC at this instant. */
function offsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
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

function overlapsDay(interval: BusyInterval, dayStart: Date, dayEnd: Date): boolean {
  const from = dayStart.getTime();
  const to = dayEnd.getTime();
  const s = Date.parse(interval.start);
  const e = Date.parse(interval.end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return false;
  // Overlapping the day, not contained by it: a block that began yesterday
  // evening and runs into this morning still makes this morning busy.
  return s < to && e > from;
}

/** The hours a day is drawn across, so every column shares one scale. */
export function dayExtent(hours: WorkingHours): { start: number; end: number } {
  return { start: hours.start, end: hours.end };
}

export { isWithinWorkingHours };
