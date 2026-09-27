/**
 * The zones a rep picks from, and the rule for reading one.
 *
 * Sending hours, meeting slots and the warm-up ramp are all evaluated in a
 * zone, and every one of them read `profiles.timezone` — which was a free-text
 * box and therefore `UTC` on every account this deployment has. "8 to 18" then
 * means four in the morning to two in the afternoon for a prospect in New York:
 * outreach nobody sees, at an hour no person sends it, which is the shape
 * LinkedIn's own heuristics look for.
 *
 * A short list rather than `Intl.supportedValuesOf("timeZone")`, which is ~400
 * entries and turns a settings row into a search problem. Anything already
 * saved stays selectable, so a zone off this list is never silently lost.
 */
export type Timezone = { readonly id: string; readonly label: string };

export const COMMON_TIMEZONES: readonly Timezone[] = [
  { id: "America/New_York", label: "US Eastern" },
  { id: "America/Chicago", label: "US Central" },
  { id: "America/Denver", label: "US Mountain" },
  { id: "America/Los_Angeles", label: "US Pacific" },
  { id: "America/Toronto", label: "Toronto" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Dublin", label: "Dublin" },
  { id: "Europe/Lisbon", label: "Lisbon" },
  { id: "Europe/Madrid", label: "Madrid" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Warsaw", label: "Warsaw" },
  { id: "Europe/Athens", label: "Athens" },
  { id: "Europe/Istanbul", label: "Istanbul" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Karachi", label: "Karachi" },
  { id: "Asia/Kolkata", label: "India" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "Pacific/Auckland", label: "Auckland" },
  { id: "UTC", label: "UTC" },
];

/**
 * Is this a zone this runtime can actually evaluate?
 *
 * The check is the formatter itself rather than a pattern, because the only
 * thing that matters is whether the code computing a send window can use it.
 * A pattern that accepts `Mars/Olympus` passes validation and then falls back
 * to UTC at the one moment it counts.
 */
export function isValidTimezone(zone: string | null | undefined): boolean {
  const id = (zone ?? "").trim();
  if (!id) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: id }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * What a saved window actually means, in words.
 *
 * `8` and `18` on a screen are not a claim anybody can check. "08:00–18:00,
 * Mon–Fri, US Eastern — 14:52 there now" is: a rep reading it at nine in the
 * evening can see at once why nothing is sending.
 */
export function describeWorkingHours(
  hours: { start: number; end: number; days: number[] },
  zone: string,
  now: Date = new Date(),
): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = [1, 2, 3, 4, 5, 6, 0].filter((d) => hours.days.includes(d));
  const label = runsOf(days)
    .map((run) => (run.length > 1 ? `${names[run[0]!]}–${names[run[run.length - 1]!]}` : names[run[0]!]))
    .join(", ");
  const pad = (n: number) => String(n).padStart(2, "0");
  const window = `${pad(hours.start)}:00–${pad(hours.end)}:00`;
  if (!isValidTimezone(zone)) {
    // Never present an unreadable zone as if it were being applied.
    return `${window}, ${label} — timezone "${zone}" is not one this can read, so UTC is used`;
  }
  const there = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).format(now);
  return `${window}, ${label}, ${zone} — ${there} there now`;
}

/** Consecutive days, so Mon,Tue,Wed,Thu,Fri reads as one range and not five. */
function runsOf(days: number[]): number[][] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const runs: number[][] = [];
  for (const day of days) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev !== undefined && order.indexOf(day) === order.indexOf(prev) + 1) last.push(day);
    else runs.push([day]);
  }
  return runs;
}
