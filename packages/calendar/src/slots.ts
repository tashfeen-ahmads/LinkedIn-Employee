import type { BusyInterval } from "./provider.js";

export interface WorkingHours {
  start: number;
  end: number;
  /** 0 = Sunday. */
  days: number[];
}

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
export function findFreeSlots(options: SlotOptions): string[] {
  const {
    from,
    to,
    durationMinutes,
    workingHours,
    timezone,
    busy,
    minNoticeHours = 12,
    bufferMinutes = 15,
    maxSlots = 3,
  } = options;

  const durationMs = durationMinutes * 60_000;
  const bufferMs = bufferMinutes * 60_000;
  const earliest = new Date(Math.max(from.getTime(), Date.now() + minNoticeHours * 3_600_000));
  const blocks = mergeIntervals(busy).map((interval) => ({
    start: Date.parse(interval.start) - bufferMs,
    end: Date.parse(interval.end) + bufferMs,
  }));

  const slots: string[] = [];
  const step = 30 * 60_000;
  // Align to the next half hour: nobody offers a meeting at 14:07.
  let cursor = Math.ceil(earliest.getTime() / step) * step;
  const offeredDays = new Set<string>();

  while (cursor + durationMs <= to.getTime() && slots.length < maxSlots) {
    const start = new Date(cursor);
    const end = new Date(cursor + durationMs);

    if (
      withinWorkingHours(start, workingHours, timezone) &&
      withinWorkingHours(new Date(end.getTime() - 60_000), workingHours, timezone) &&
      !overlapsAny(cursor, cursor + durationMs, blocks)
    ) {
      // At most one slot per day, so three options span three days rather than
      // three consecutive half hours on the same afternoon.
      const dayKey = dayKeyFor(start, timezone);
      if (!offeredDays.has(dayKey)) {
        offeredDays.add(dayKey);
        slots.push(start.toISOString());
      }
    }
    cursor += step;
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

export function withinWorkingHours(date: Date, hours: WorkingHours, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const weekdayName = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);

  if (!hours.days.includes(weekday < 0 ? 0 : weekday)) return false;
  const minutesIntoDay = hour * 60 + minute;
  return minutesIntoDay >= hours.start * 60 && minutesIntoDay <= hours.end * 60;
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
