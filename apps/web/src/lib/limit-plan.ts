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
 */

/** dailyInviteCap for each whole day since the first send, index = day. */
export type CapTable = readonly number[];

export interface PlanInput {
  caps: CapTable;
  /** dailyInviteCap(null): what an account that has never sent gets. */
  neverSentCap: number;
  weeklyCeiling: number;
  /** Whole days since the first automated send, or null for never sent. */
  days: number | null;
  sentThisWeek: number;
}

export interface Plan {
  /** The ramp's allowance for today, before the week is considered. */
  dailyCap: number;
  /** Invitations the week still has room for. */
  weeklyLeft: number;
  /** What can actually go out today: the smaller of the two. */
  today: number;
  /** Which limit decides today. */
  binding: "day" | "week";
  /** 1-based day of the warm-up, or null once the ramp has finished. */
  rampDay: number | null;
  rampLength: number;
  line: string;
}

function whole(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

export function capForDay(caps: CapTable, neverSentCap: number, days: number | null): number {
  if (days === null) return neverSentCap;
  const d = whole(days);
  return caps[Math.min(d, caps.length - 1)] ?? neverSentCap;
}

export function planToday(input: PlanInput): Plan {
  const { caps, neverSentCap, weeklyCeiling } = input;
  const dailyCap = capForDay(caps, neverSentCap, input.days);
  const sent = whole(input.sentThisWeek);
  const weeklyLeft = Math.max(0, weeklyCeiling - sent);
  const today = Math.min(dailyCap, weeklyLeft);
  const binding = weeklyLeft < dailyCap ? "week" : "day";
  // The last entry of the table is the first day at the full allowance.
  const rampLength = caps.length - 1;
  const d = input.days === null ? 0 : whole(input.days);
  const rampDay = d >= rampLength ? null : d + 1;

  let line: string;
  if (today === 0) {
    line = `This week's ${weeklyCeiling} is spent. Send no more invitations until the week resets, and use today for replies and follow-ups.`;
  } else if (binding === "week") {
    line = `The week binds before the day: send at most ${today} today, spread across your working hours, then stop until the week resets.`;
  } else if (input.days === null) {
    line = `Start at ${today}. Spread them across your working hours, a few minutes apart, and let the ramp grow from today.`;
  } else {
    const fullDays = Math.floor(weeklyLeft / dailyCap);
    line = `Send up to ${today} today, spread across your working hours rather than in one sitting. At this pace the week's remaining ${weeklyLeft} lasts ${fullDays === 1 ? "1 more full day" : `${fullDays} more full days`}.`;
  }

  return { dailyCap, weeklyLeft, today, binding, rampDay, rampLength, line };
}
