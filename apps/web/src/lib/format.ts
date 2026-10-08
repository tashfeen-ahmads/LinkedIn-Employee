/**
 * Dates and times, said one way everywhere.
 *
 * These render on the server, where `toLocaleString()` means the server's
 * locale in UTC — so a 7pm New York call read as tomorrow, and different
 * screens wrote the same moment three different ways. Every screen formats
 * through here, in the reader's own timezone when we know it.
 */
const LOCALE = "en-GB";

function at(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const date = iso instanceof Date ? iso : new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

function zone(timezone: string | null | undefined): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/** "7 Oct 2026" */
export function formatDate(iso: string | Date | null | undefined, timezone?: string | null): string {
  const date = at(iso);
  return date ? new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeZone: zone(timezone) }).format(date) : "—";
}

/** "7 Oct 2026, 14:05" */
export function formatDateTime(iso: string | Date | null | undefined, timezone?: string | null): string {
  const date = at(iso);
  return date
    ? new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short", timeZone: zone(timezone) }).format(date)
    : "—";
}

/** "14:05" */
export function formatTime(iso: string | Date | null | undefined, timezone?: string | null): string {
  const date = at(iso);
  return date ? new Intl.DateTimeFormat(LOCALE, { timeStyle: "short", timeZone: zone(timezone) }).format(date) : "—";
}

/** "2026-10-07" — the calendar day this moment falls on in that timezone, for grouping. */
export function dayKey(iso: string | Date | null | undefined, timezone?: string | null): string {
  const date = at(iso);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The value for a `<time dateTime>` attribute. */
export function isoAttr(iso: string | Date | null | undefined): string | undefined {
  return at(iso)?.toISOString();
}

/**
 * A `datetime-local` value read as wall-clock time in `timezone`, as epoch ms
 * (`NaN` when unreadable).
 *
 * The input carries no zone, so `Date.parse` reads it in the server's — UTC —
 * and a rep in New York who typed 9am got 5am. Every time field names the rep's
 * zone, and this reads it in that zone.
 */
export function wallTimeToUtc(value: string, timezone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return Number.NaN;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0));
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return wall;
  }
  // How far `timezone` is from UTC at an instant: its wall clock minus the instant.
  const offsetAt = (instant: number) => {
    const parts = format.formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second")) - instant;
  };
  // Twice, so a time near a daylight-saving change settles on the right offset.
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}
