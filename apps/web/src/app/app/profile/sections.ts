/**
 * The profile's sections, and where every old link into it now lands.
 *
 * Profile was one long page with everything stacked: the business, the rep,
 * the hours, the LinkedIn account, the team and billing. It is now a set of
 * sections, one on screen at a time, each its own route under
 * `/app/profile/*`, with a menu beside them (`SectionNav`).
 *
 * The old page was reached by anchors — `#team` from the Needs you list,
 * `#billing` from the trial banner and the billing emails, `#sales-navigator`
 * from the campaign page, `#linkedin-heading` from Strategies — and some of
 * those links live in emails already sent. A fragment never reaches the server,
 * so the mapping is read in the browser (`ProfileLegacyAnchor`) and the person
 * is moved to the section the anchor meant, query string and all.
 */

export const PROFILE_SECTIONS = {
  /** The first section is the profile's own address, so every old link to it still opens it. */
  you: "/app/profile",
  company: "/app/profile/company",
  linkedin: "/app/profile/linkedin",
  hours: "/app/profile/hours",
  replies: "/app/profile/replies",
  meetings: "/app/profile/meetings",
  activity: "/app/profile/activity",
  team: "/app/profile/team",
  billing: "/app/profile/billing",
} as const;

export type ProfileSection = keyof typeof PROFILE_SECTIONS;

/** Every anchor the one-page profile had, and the section it now lives in. */
export const LEGACY_ANCHORS: Record<string, ProfileSection> = {
  business: "company",
  sound: "you",
  sending: "hours",
  autonomy: "replies",
  "sales-navigator": "linkedin",
  "sales-navigator-heading": "linkedin",
  linkedin: "linkedin",
  "linkedin-heading": "linkedin",
  team: "team",
  members: "team",
  "members-heading": "team",
  invites: "team",
  billing: "billing",
  plan: "billing",
  "plan-heading": "billing",
  data: "billing",
  "data-heading": "billing",
  engagement: "activity",
  posts: "activity",
};

/**
 * Where an old anchor should take somebody who is on `pathname`, or null when
 * they are already in that section (or the anchor is not one of the old ones).
 */
export function legacyAnchorTarget(pathname: string, hash: string): string | null {
  const section = LEGACY_ANCHORS[hash.replace(/^#/, "")];
  if (!section) return null;
  const target = PROFILE_SECTIONS[section];
  if (pathname === target || (section !== "you" && pathname.startsWith(`${target}/`))) return null;
  return target;
}

/** Every hour boundary a sending window can start or end on. */
export const HOURS = Array.from({ length: 25 }, (_, h) => h);

/** "8 AM", "Noon", "6 PM", "Midnight": the hour as a US reader says it. */
export function hourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return "Midnight";
  if (hour === 12) return "Noon";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/** "9", "5", "Noon": the short form for a menu hint, where "9 AM–5 PM" is too long. */
function hourShort(hour: number): string {
  if (hour === 0 || hour === 24) return "midnight";
  if (hour === 12) return "noon";
  return String(hour > 12 ? hour - 12 : hour);
}

export const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

export interface Hours {
  start: number;
  end: number;
  days: number[];
}

/** The same shape and fallback the worker's limiter applies to this column. */
export function readWorkingHours(value: unknown): Hours {
  const fallback = { start: 8, end: 18, days: [1, 2, 3, 4, 5] };
  if (!value || typeof value !== "object") return fallback;
  const hours = value as Partial<Hours>;
  if (typeof hours.start === "number" && typeof hours.end === "number" && Array.isArray(hours.days)) {
    return { start: hours.start, end: hours.end, days: hours.days };
  }
  return fallback;
}

/** Validated against the runtime's own list rather than a hand-kept one. */
export function isKnownTimezone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "every day", "Mon–Fri", "Mon, Wed, Fri": the days as a person says them. */
export function daysInWords(days: number[]): string {
  const order = DAYS.map((d) => d.value).filter((d) => days.includes(d));
  if (order.length === 7) return "every day";
  if (order.length === 0) return "no days";
  const names = new Map<number, string>(DAYS.map((d) => [d.value, d.label]));
  const runs: number[][] = [];
  for (const day of order) {
    const run = runs[runs.length - 1];
    const index = DAYS.findIndex((d) => d.value === day);
    const previous = run ? DAYS.findIndex((d) => d.value === run[run.length - 1]) : -2;
    if (run && index === previous + 1) run.push(day);
    else runs.push([day]);
  }
  return runs
    .map((run) =>
      run.length > 2 ? `${names.get(run[0]!)}–${names.get(run[run.length - 1]!)}` : run.map((d) => names.get(d)).join(", "),
    )
    .join(", ");
}

/** The city part of a zone, said as a place: "America/New_York" → "New York". */
export function zonePlace(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

/** "9–5 New York, Mon–Fri": a sending window in one short line, for the menu. */
export function hoursHint(hours: Hours, zone: string | null | undefined): string {
  return `${hourShort(hours.start)}–${hourShort(hours.end)} ${zonePlace(zone)}, ${daysInWords(hours.days)}`;
}
