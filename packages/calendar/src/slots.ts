import { isWithinWorkingHours, type WorkingHours } from "@le/shared";
import type { BusyInterval } from "./provider.js";

export type { WorkingHours };
export { isWithinWorkingHours };

export interface SlotOptions {
  from: Date;
  to: Date;
  durationMinutes: number;
  workingHours: WorkingHours;
  timezone: string;
  busy: BusyInterval[];
  /** Do not offer anything sooner than this many hours from now. */
  minNoticeHours?: number;
  /** Leave this much clear either side of an existing meeting. */
  bufferMinutes?: number;
  maxSlots?: number;
}

/**
 * Free slots the Reply Agent may offer. Deliberately deterministic and pure:
 * the model is never allowed to invent a time, so this is the only source of
 * the datetimes that reach a prospect.
 */
/**
 * Every start in the range this rep could actually be offered, uncapped.
 *
 * `findFreeSlots` below is this plus two rules for a *reply*: at most one
 * option per day, and at most three in all. A calendar needs the same question
 * answered without those — every bookable time in a week, not the three the
 * agent would pick — and the one thing it must not do is work it out for
 * itself.
 *
 * Rule 6 says this file produces the only times that reach a prospect. A
 * screen that computed its own would drift from it, and the screen's answer is
 * the one a rep believes: they would block a Tuesday that was never offered,
 * or see a gap the agent will not use and conclude the product is broken. Both
 * readings come from here, so they cannot disagree.
 */
export function offerableStarts(options: SlotOptions): string[] {
  const {
    from,
    to,
    durationMinutes,
    workingHours,
    timezone,
    busy,
    minNoticeHours = 12,
    bufferMinutes = 15,
  } = options;

  const durationMs = durationMinutes * 60_000;
  const bufferMs = bufferMinutes * 60_000;
  const earliest = new Date(Math.max(from.getTime(), Date.now() + minNoticeHours * 3_600_000));
  const blocks = mergeIntervals(busy).map((interval) => ({
    start: Date.parse(interval.start) - bufferMs,
    end: Date.parse(interval.end) + bufferMs,
  }));

  const starts: string[] = [];
  const step = 30 * 60_000;
  // Align to the next half hour: nobody offers a meeting at 14:07.
  let cursor = Math.ceil(earliest.getTime() / step) * step;

  while (cursor + durationMs <= to.getTime()) {
    const start = new Date(cursor);
    const end = new Date(cursor + durationMs);
    if (
      isWithinWorkingHours(start, workingHours, timezone) &&
      // The last minute of the meeting, not the first minute after it: a 30
      // minute slot ending exactly at 17:00 finishes inside the window.
      isWithinWorkingHours(new Date(end.getTime() - 60_000), workingHours, timezone) &&
      !overlapsAny(cursor, cursor + durationMs, blocks)
    ) {
      starts.push(start.toISOString());
    }
    cursor += step;
  }

  return starts;
}

/**
 * Free slots the Reply Agent may offer. Deliberately deterministic and pure:
 * the model is never allowed to invent a time, so this is the only source of
 * the datetimes that reach a prospect.
 */
export function findFreeSlots(options: SlotOptions): string[] {
  const { timezone, maxSlots = 3 } = options;
  const slots: string[] = [];
  const offeredDays = new Set<string>();

  for (const start of offerableStarts(options)) {
    if (slots.length >= maxSlots) break;
    // At most one slot per day, so three options span three days rather than
    // three consecutive half hours on the same afternoon.
    const dayKey = dayKeyFor(new Date(start), timezone);
    if (offeredDays.has(dayKey)) continue;
    offeredDays.add(dayKey);
    slots.push(start);
  }

  return slots;
}

export function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  const parsed = intervals
    .map((interval) => ({ start: Date.parse(interval.start), end: Date.parse(interval.end) }))
    .filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of parsed) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.map((interval) => ({
    start: new Date(interval.start).toISOString(),
    end: new Date(interval.end).toISOString(),
  }));
}

function overlapsAny(start: number, end: number, blocks: Array<{ start: number; end: number }>): boolean {
  return blocks.some((block) => start < block.end && end > block.start);
}

function dayKeyFor(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, dateStyle: "short" }).format(date);
}

/** Human-readable rendering of a slot, in the prospect's own words. */
export function formatSlot(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}
