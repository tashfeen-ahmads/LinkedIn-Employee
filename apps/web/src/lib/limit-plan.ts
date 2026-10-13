/**
 * The arithmetic behind /tools/linkedin-limit-calculator, kept free of any
 * import so the client component can run it.
 *
 * It does not reimplement the ramp. The page calls `dailyInviteCap` from
 * @le/linkedin on the server, once per day of the warm-up, and hands the
 * results in as `caps`; this file only looks a day up in that table. The
 * package itself cannot be bundled for the browser (it carries the provider
 * client, which needs node:crypto), and a second copy of the formula is the
 * kind of thing that drifts from the one the sender enforces.
 *
 * The weekly ceiling is counted the way the sender counts it
 * (`invitesInLastWeek` in @le/linkedin, CLAUDE.md rule 61): the seven days
 * ending today, today included. Nothing resets on a Monday. Each day's
 * invitations stop counting when that day is seven days old, so room comes
 * back a day at a time, in exactly the amounts that day held.
 */

/** dailyInviteCap for each whole day since the first send, index = day. */
export type CapTable = readonly number[];

/** The days a weekly count looks back over, today included. */
export const WINDOW_DAYS = 7;

export interface PlanInput {
  caps: CapTable;
  /** dailyInviteCap(null): what an account that has never sent gets. */
  neverSentCap: number;
  weeklyCeiling: number;
  /** Whole days since the first automated send, or null for never sent. */
  days: number | null;
  /**
   * Invitations sent on each of the last seven days, oldest first; the last
   * entry is today so far. Shorter arrays are read as the most recent days,
   * missing days as zero.
   */
  sentByDay: readonly number[];
  /**
   * Today's `Date.getDay()` (0 is Sunday), when it is known. It is only known
   * in the browser; omitted, the plan says "in 3 days" rather than naming one.
   */
  weekday?: number;
  /** The weekdays the sender uses, `Date.getDay()` numbering. Every day when omitted. */
  workingDays?: readonly number[];
}

export interface Plan {
  /** The ramp's allowance for today, before the seven days are considered. */
  dailyCap: number;
  /** Invitations the last seven days, today included, still have room for. */
  weeklyLeft: number;
  /** Invitations already counted in the seven days ending today. */
  sentInWindow: number;
  /** What can still go out today: the smallest of the day's room and the window's. */
  today: number;
  /** Which limit decides today. */
  binding: "day" | "week";
  /**
   * When room next comes back once today's plan is sent: the first day an
   * older day's invitations age out and leave the window below the ceiling,
   * and how much room that adds. Null when nothing is waiting to age out.
   */
  nextFree: { inDays: number; frees: number } | null;
  /** 1-based day of the warm-up, or null once the ramp has finished. */
  rampDay: number | null;
  rampLength: number;
  line: string;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function whole(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function capForDay(caps: CapTable, neverSentCap: number, days: number | null): number {
  if (days === null) return neverSentCap;
  const d = whole(days);
  return caps[Math.min(d, caps.length - 1)] ?? neverSentCap;
}

/** The last seven days as whole numbers, oldest first, padded with zeros at the old end. */
export function lastSevenDays(sentByDay: readonly number[]): number[] {
  const recent = sentByDay.slice(-WINDOW_DAYS).map(whole);
  return [...Array<number>(WINDOW_DAYS - recent.length).fill(0), ...recent];
}

/** The weekday `inDays` from `weekday`, as a name. */
function dayName(weekday: number, inDays: number): string {
  return DAY_NAMES[(((weekday + inDays) % 7) + 7) % 7] ?? "";
}

function when(inDays: number, weekday: number | undefined): string {
  if (inDays === 1) return "tomorrow";
  if (weekday === undefined) return `in ${inDays} days`;
  return `on ${dayName(weekday, inDays)}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function planToday(input: PlanInput): Plan {
  const { caps, neverSentCap, weeklyCeiling } = input;
  const dailyCap = capForDay(caps, neverSentCap, input.days);
  const window = lastSevenDays(input.sentByDay);
  const sentToday = window[WINDOW_DAYS - 1] ?? 0;
  const sentInWindow = window.reduce((a, b) => a + b, 0);
  const weeklyLeft = Math.max(0, weeklyCeiling - sentInWindow);
  const dayLeft = Math.max(0, dailyCap - sentToday);
  const today = Math.min(dayLeft, weeklyLeft);
  const binding = weeklyLeft < dayLeft ? "week" : "day";
  // The last entry of the table is the first day at the full allowance.
  const rampLength = caps.length - 1;
  const d = input.days === null ? 0 : whole(input.days);
  const rampDay = d >= rampLength ? null : d + 1;

  // Tomorrow the oldest day leaves the window, the day after the next one,
  // and so on: what was sent `k` days before today stops counting in
  // 7 - k days. Today's own invitations, plan included, stay for all seven.
  // Room comes back only below the ceiling, so a day that held more than the
  // whole week returns the ceiling and no more.
  const after = [...window];
  after[WINDOW_DAYS - 1] = sentToday + today;
  let nextFree: Plan["nextFree"] = null;
  for (let k = 1; k <= WINDOW_DAYS; k++) {
    const stillCounted = after.slice(k).reduce((a, b) => a + b, 0);
    const room = Math.max(0, weeklyCeiling - stillCounted);
    const before = Math.max(0, weeklyCeiling - (stillCounted + (after[k - 1] ?? 0)));
    if ((after[k - 1] ?? 0) > 0 && room > before) {
      nextFree = { inDays: k, frees: room - before };
      break;
    }
  }

  const free = nextFree
    ? `${nextFree.frees} ${nextFree.frees === 1 ? "frees" : "free"} up ${when(nextFree.inDays, input.weekday)}, when ${
        nextFree.inDays === WINDOW_DAYS ? "today's invitations" : `the invitations sent ${plural(WINDOW_DAYS - nextFree.inDays, "day")} ago`
      } turn seven days old`
    : null;

  let line: string;
  if (weeklyLeft === 0) {
    line = `The last seven days hold ${sentInWindow}, so the ${weeklyCeiling} is spent. Send no more invitations today and use it for replies and follow-ups. Nothing comes back all at once: ${free ?? "room returns as each day turns seven days old"}.`;
  } else if (today === 0) {
    line = `Today's ${dailyCap} has gone out. The seven days still have room for ${weeklyLeft}, so pick up again tomorrow at the day's new cap.`;
  } else if (binding === "week") {
    line = `The seven-day ceiling binds before the day: send at most ${today} today, spread across your working hours, then stop. ${free ? `${free.charAt(0).toUpperCase()}${free.slice(1)}.` : "Room comes back as each day turns seven days old."}`;
  } else if (input.days === null) {
    line = `Start at ${today}. Spread them across your working hours, a few minutes apart, and let the ramp grow from today.`;
  } else {
    const send = `Send up to ${today} today, spread across your working hours rather than in one sitting.`;
    const binds = firstBindingDay(input, window, today);
    if (binds === null) {
      line = `${send} At the daily cap, the last seven days stay under ${weeklyCeiling} for the whole of the coming week.`;
    } else if (binds === 1) {
      line = `${send} Even at the daily cap, the seven-day ceiling binds from tomorrow: what you send then is limited by what the last seven days hold.`;
    } else {
      line = `${send} At the daily cap every working day, the seven-day ceiling starts to bind ${when(binds, input.weekday)}, ${plural(binds, "day")} from now.`;
    }
  }

  return { dailyCap, weeklyLeft, sentInWindow, today, binding, nextFree, rampDay, rampLength, line };
}

/**
 * Sending the full daily cap on every working day from tomorrow, the first
 * day on which the seven days ending that day leave less room than the cap.
 * Null when that does not happen within the next seven days. Working days are
 * only applied when today's weekday is known; without it every day counts,
 * which can only bring the answer earlier.
 */
function firstBindingDay(input: PlanInput, window: readonly number[], todayPlanned: number): number | null {
  const history = [...window];
  history[WINDOW_DAYS - 1] = (history[WINDOW_DAYS - 1] ?? 0) + todayPlanned;
  const working = input.workingDays && input.weekday !== undefined ? new Set(input.workingDays) : null;
  for (let k = 1; k <= WINDOW_DAYS; k++) {
    const weekday = input.weekday === undefined ? undefined : (input.weekday + k) % 7;
    const sends = working === null || (weekday !== undefined && working.has(weekday));
    const cap = capForDay(input.caps, input.neverSentCap, input.days === null ? null : whole(input.days) + k);
    const inWindow = history.slice(-(WINDOW_DAYS - 1)).reduce((a, b) => a + b, 0);
    const room = Math.max(0, input.weeklyCeiling - inWindow);
    if (sends && room < cap) return k;
    history.push(sends ? Math.min(cap, room) : 0);
  }
  return null;
}
