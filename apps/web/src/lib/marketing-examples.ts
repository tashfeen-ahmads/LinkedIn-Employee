import { dailyInviteCap, spreadGapMs } from "@le/linkedin";
import { findFreeSlots } from "@le/calendar";
import { DEFAULT_WORKING_HOURS, LINKEDIN_LIMITS } from "@le/shared";

/*
 * The worked example the marketing pages draw, computed rather than typed.
 *
 * Every number on the home page's pictures comes out of the functions the
 * sender runs: the ramp is `dailyInviteCap` called once a day, the example day
 * is `spreadGapMs` placing that day's allowance across the working hours, and
 * the offered times are `findFreeSlots`. A picture that disagrees with the code
 * is a confident, illustrated lie, and these cannot disagree with it.
 *
 * The people are invented and the pages say so wherever they could be read as
 * somebody's real data.
 */

const DAY_MS = 86_400_000;
const FIRST_SEND = new Date("2026-01-05T00:00:00Z");

/** The daily invitation cap, one point per day, from the account's first send. */
export const RAMP_DAYS = LINKEDIN_LIMITS.warmupDays + 7;
export const RAMP = Array.from({ length: RAMP_DAYS + 1 }, (_, day) => ({
  day,
  cap: dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + day * DAY_MS)),
}));

/**
 * A seeded generator, so the example day is the same on every build. The
 * sender uses `Math.random`; the shape of the day is what is being shown, and
 * a picture that reshuffles on every deploy reads as a bug.
 */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Which day of sending the example account is on. */
export const EXAMPLE_DAY_NUMBER = 3;
/** That day's allowance, from the same function the limiter reads. */
export const EXAMPLE_DAY_CAP = RAMP[EXAMPLE_DAY_NUMBER]!.cap;

const START_MIN = DEFAULT_WORKING_HOURS.start * 60;
const END_MIN = DEFAULT_WORKING_HOURS.end * 60;

/** Minutes after midnight at which each of the day's invitations goes out. */
const EXAMPLE_MINUTES: number[] = (() => {
  const random = seeded(7);
  const out: number[] = [];
  let at = START_MIN;
  for (let placed = 0; placed < EXAMPLE_DAY_CAP; placed += 1) {
    at += spreadGapMs({ remaining: EXAMPLE_DAY_CAP - placed, windowMs: (END_MIN - at) * 60_000, random }) / 60_000;
    out.push(at);
  }
  return out;
})();

/**
 * A time of day the way an American reader writes it: "8 a.m.", "4:52 p.m.".
 * Whole hours drop the minutes, so a working day reads "8 a.m. to 6 p.m.".
 */
export function twelveHour(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const suffix = hour % 24 < 12 ? "a.m." : "p.m.";
  return minute === 0 ? `${h} ${suffix}` : `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function clock(minutes: number): string {
  return twelveHour(Math.floor(minutes / 60), Math.floor(minutes % 60));
}

export const EXAMPLE_DAY = {
  start: clock(START_MIN),
  end: clock(END_MIN),
  times: EXAMPLE_MINUTES.map(clock),
};

/** Where each of the example day's invitations lands, for the hero's timeline. */
export const EXAMPLE_SPREAD = { startMin: START_MIN, endMin: END_MIN, minutes: EXAMPLE_MINUTES };

/** The hero's account is part-way through that day. */
export const EXAMPLE_SENT = 7;
export const EXAMPLE_NEXT = EXAMPLE_DAY.times[EXAMPLE_SENT]!;
export const EXAMPLE_MESSAGES = 8;

export type ExamplePerson = {
  name: string;
  role: string;
  company: string;
  photo: string;
};

export const PEOPLE = {
  maya: { name: "Maya Chen", role: "Head of Growth", company: "Calder & Finch", photo: "/people/example-1.webp" },
  daniel: { name: "Daniel Okafor", role: "Operations Director", company: "Brightwater Dental", photo: "/people/example-2.webp" },
  ingrid: { name: "Ingrid Solberg", role: "Head of People", company: "Ridgeline Freight", photo: "/people/example-3.webp" },
  marco: { name: "Marco Bellini", role: "VP of Sales", company: "Peakstone Software", photo: "/people/example-4.webp" },
} satisfies Record<string, ExamplePerson>;

/*
 * Three invitations as the review screen shows them. Each is within the
 * connection-note limit, carries no link and no pitch (rules 29 and 40), and
 * names the profile fields it was written from (rule 16's grounding).
 */
export const EXAMPLE_NOTES: ReadonlyArray<{ person: ExamplePerson; note: string; grounding: string[] }> = [
  {
    person: PEOPLE.daniel,
    note: "Hi Daniel, running operations across six Brightwater clinics sounds like a scheduling puzzle most weeks. I work with dental groups on the same problem and would be glad to connect.",
    grounding: ["headline", "company"],
  },
  {
    person: PEOPLE.ingrid,
    note: "Hi Ingrid, what you wrote about hiring drivers in a tight market stayed with me. Would be good to have you in my network.",
    grounding: ["about", "role"],
  },
  {
    person: PEOPLE.marco,
    note: "Hi Marco, saw you took over sales at Peakstone this year. Building a new team's first pipeline is a lot. Happy to connect.",
    grounding: ["role", "company", "headline"],
  },
];

/*
 * The hero's note: one invitation written for one example person. The parts
 * marked `from` are the details taken from her profile, which the hero
 * highlights the way the review screen names a note's grounding (rule 16).
 * No link and no pitch (rules 29 and 40); its length is counted against the
 * real limit where it is drawn.
 */
export const HERO_NOTE: { person: ExamplePerson; parts: ReadonlyArray<{ text: string; from?: string }> } = {
  person: PEOPLE.maya,
  parts: [
    { text: "Hi Maya, saw your team " },
    { text: "doubled its outbound pod this spring", from: "her headline" },
    { text: ". Curious how you keep " },
    { text: "replies personal", from: "a recent post" },
    { text: " at that pace. Happy to connect." },
  ],
};
export const HERO_NOTE_TEXT = HERO_NOTE.parts.map((part) => part.text).join("");

/*
 * The offered times, from the function that produces the only times that ever
 * reach a prospect (rule 6). The week after the build, so the example never
 * offers a date in the past; one weekday morning blocked, as a real calendar
 * would have, so the picture shows the agent working around something.
 */
const SLOT_TZ = "America/New_York";
/** How the example's zone is written beside a time. */
export const SLOT_TZ_LABEL = "ET";

function nextMonday(from: Date): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  return new Date(d.getTime() + add * DAY_MS);
}

const monday = nextMonday(new Date());
const SLOT_MINUTES = 30;

export const EXAMPLE_SLOTS: string[] = findFreeSlots({
  from: new Date(monday.getTime() + 1 * DAY_MS),
  to: new Date(monday.getTime() + 5 * DAY_MS),
  durationMinutes: SLOT_MINUTES,
  workingHours: { ...DEFAULT_WORKING_HOURS, days: [...DEFAULT_WORKING_HOURS.days] },
  timezone: SLOT_TZ,
  busy: [
    {
      // Tuesday 12:00 to 18:00 UTC: the rep's morning in New York.
      start: new Date(monday.getTime() + 1 * DAY_MS + 12 * 3_600_000).toISOString(),
      end: new Date(monday.getTime() + 1 * DAY_MS + 18 * 3_600_000).toISOString(),
    },
  ],
});

const slotDay = new Intl.DateTimeFormat("en-US", { timeZone: SLOT_TZ, weekday: "short", day: "numeric", month: "short" });
const slotLong = new Intl.DateTimeFormat("en-US", { timeZone: SLOT_TZ, weekday: "long", day: "numeric", month: "long" });
const slotClock = new Intl.DateTimeFormat("en-US", { timeZone: SLOT_TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" });

function slotTime(d: Date): string {
  const parts = slotClock.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return twelveHour(get("hour"), get("minute"));
}

export function slotLabel(iso: string): string {
  const d = new Date(iso);
  return `${slotDay.format(d)}, ${slotTime(d)}`;
}

/** The slot the example prospect accepts, and the meeting it becomes. */
export const BOOKED_SLOT = EXAMPLE_SLOTS[1] ?? EXAMPLE_SLOTS[0] ?? null;

export function meetingLines(iso: string): { day: string; time: string } {
  const start = new Date(iso);
  const end = new Date(start.getTime() + SLOT_MINUTES * 60_000);
  return {
    day: slotLong.format(start),
    time: `${slotTime(start)} to ${slotTime(end)} ${SLOT_TZ_LABEL} (${SLOT_MINUTES} min)`,
  };
}

export const BOOKED_DAY_NAME = BOOKED_SLOT
  ? new Intl.DateTimeFormat("en-US", { timeZone: SLOT_TZ, weekday: "long" }).format(new Date(BOOKED_SLOT))
  : "Wednesday";
