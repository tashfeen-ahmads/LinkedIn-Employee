import {
  LINKEDIN_LIMITS,
  isWithinWorkingHours as sharedIsWithinWorkingHours,
  msUntilNextLocalMidnight as sharedMsUntilNextLocalMidnight,
  workingMsLeftToday as sharedWorkingMsLeftToday,
  zonedParts as sharedZonedParts,
  type WorkingHours,
} from "@le/shared";

export type { WorkingHours };

export interface AccountUsage {
  connectedAt: Date;
  /**
   * When this account first sent anything through us, or null if it never has.
   *
   * This — not connectedAt — is day zero of the warm-up. An account connected
   * six weeks before its first campaign would otherwise be treated as fully
   * warmed and allowed 35 invitations on its first day of sending, which is
   * exactly the burst the ramp exists to prevent.
   */
  firstActionAt: Date | null;
  invitesToday: number;
  invitesThisWeek: number;
  messagesToday: number;
  /**
   * Profile views spent today, on its own counter.
   *
   * A view is not an invitation: it has its own allowance, it does not come
   * off the invite ramp, and LinkedIn throttling invitations does not stop
   * one. Sharing a counter would mean warming a prospect cost us the ability
   * to write to them.
   */
  profileViewsToday: number;
  lastActionAt: Date | null;
  workingHours: WorkingHours;
  /** IANA zone used to evaluate workingHours. */
  timezone: string;
}

export type ActionKind = "invite" | "message" | "profile_view";

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: DenyReason; retryAfterMs: number };

export type DenyReason =
  | "daily_invite_cap"
  | "weekly_invite_cap"
  | "daily_message_cap"
  | "daily_profile_view_cap"
  | "outside_working_hours"
  | "too_soon";

/**
 * Daily invite allowance for an account, ramping linearly from
 * invitesPerDayStart to invitesPerDayMax over warmupDays.
 *
 * The clock starts at the account's FIRST ACTION, not at connection. Those are
 * the same day for someone who connects and launches together, and weeks apart
 * for someone who wires up their deployment over a fortnight — and in the
 * second case, measuring from connection would hand a never-used account its
 * full allowance on the first day it ever sends. That burst is the single
 * biggest cause of restrictions, which makes it the one thing the ramp exists
 * to prevent.
 *
 * An account that has sent nothing sits at the starting allowance, however long
 * ago it was connected.
 */
export function dailyInviteCap(firstActionAt: Date | null, now: Date = new Date()): number {
  const { invitesPerDayStart, invitesPerDayMax, warmupDays } = LINKEDIN_LIMITS;
  if (!firstActionAt) return invitesPerDayStart;
  const days = Math.floor((now.getTime() - firstActionAt.getTime()) / 86_400_000);
  if (days >= warmupDays) return invitesPerDayMax;
  if (days <= 0) return invitesPerDayStart;
  const step = (invitesPerDayMax - invitesPerDayStart) / warmupDays;
  return Math.floor(invitesPerDayStart + step * days);
}

/** Re-exported so callers here keep one import for everything time-related. */
export const zonedParts = sharedZonedParts;
export const isWithinWorkingHours = sharedIsWithinWorkingHours;
export const msUntilNextLocalMidnight = sharedMsUntilNextLocalMidnight;
export const workingMsLeftToday = sharedWorkingMsLeftToday;

/** Milliseconds until the next working-hours window opens. */
export function msUntilWorkingHours(now: Date, hours: WorkingHours, timezone: string): number {
  const step = 15 * 60_000;
  for (let ms = step; ms <= 8 * 86_400_000; ms += step) {
    if (isWithinWorkingHours(new Date(now.getTime() + ms), hours, timezone)) return ms;
  }
  return 86_400_000;
}

/** Randomized gap between two actions, so cadence never looks mechanical. */
export function nextGapMs(random: () => number = Math.random): number {
  const { minGapMs, maxGapMs } = LINKEDIN_LIMITS;
  return Math.round(minGapMs + random() * (maxGapMs - minGapMs));
}

/**
 * How wide the jitter around a spread gap is, as a fraction of the target.
 *
 * Not a cap and not in `constants.ts` for that reason (rule 4): it is the
 * shape of the randomness, not a limit anybody may raise. Wide enough that
 * consecutive gaps are visibly different, narrow enough that the day's
 * allowance still lands inside the day.
 */
const SPREAD_JITTER_LOW = 0.6;
const SPREAD_JITTER_HIGH = 1.4;

/**
 * The gap before the next invitation when a whole day's allowance is being
 * placed at once.
 *
 * The ramp (rule 3) decides how many invitations an account may send today.
 * Nothing decided *when*, so the pacing loop placed all of them two to nine
 * minutes apart and the day's allowance was spent in a single unbroken run —
 * for a ten-invitation cap, under an hour and a quarter, starting whenever the
 * tick happened to fire. That is what this deployment did on its first day:
 * seven connection requests between 16:52 and 17:19 from an account whose
 * first ever action was the first of them. LinkedIn throttled invitations from
 * it and was still refusing five days later, with five invitations outstanding
 * and seven sent all week. A daily ceiling with no pacing underneath it is a
 * burst with a maximum size, and the burst is the thing LinkedIn watches for.
 *
 * So the gap is the day's remaining working time divided among the
 * invitations still to place, jittered, and never below the ordinary gap
 * between two actions. `nextGapMs` remains the floor rather than being
 * replaced: a large allowance in a narrow window — a campaign launched at
 * half past four — collapses back to the old behaviour, which is correct,
 * because the alternative is placing invitations after the rep's day ends.
 *
 * The divisor carries the jitter's own ceiling, which is what makes the fit a
 * guarantee rather than an average. Dividing the window by the count alone
 * puts the *expected* last invitation on its edge — so half of all days push
 * their last few past the end of the rep's hours, where the send path defers
 * them and the allowance is quietly not spent. Dividing by the count times the
 * widest the jitter can go means even a day that draws high every single time
 * fits exactly.
 */
export interface InvitePace {
  /** Invitations still to place today. */
  remaining: number;
  /** Working milliseconds left today. */
  windowMs: number;
}

/**
 * The spacing the day's allowance works out to, before jitter — or null when
 * there is no day left to spread across.
 *
 * Its own function because two things read it and they must not disagree. The
 * loop jitters it into an actual delay; the campaign screen states it as the
 * wait somebody is about to sit through. Rule 21 is explicit that the screen
 * reads the rule the sender obeys rather than a second copy written for the
 * screen, and the drift here is not subtle: `checkAction` alone knows only the
 * two-minute floor, so the page would promise the next invitation in three
 * minutes while the pace put it three quarters of an hour out. A reassuring
 * sentence that turns out to be wrong is worse than no sentence, because the
 * next thing somebody does is conclude the product is broken.
 */
export function invitePaceMs(input: InvitePace): number | null {
  if (!Number.isFinite(input.windowMs) || input.windowMs <= 0) return null;
  const remaining = Math.max(1, Math.floor(input.remaining));
  return input.windowMs / (remaining * SPREAD_JITTER_HIGH);
}

export function spreadGapMs(input: InvitePace & { random?: () => number }): number {
  const random = input.random ?? Math.random;
  const floor = nextGapMs(random);
  /*
   * A window that is not a number is the ordinary gap, not a gap of nothing.
   *
   * Zero needs no guard — the floor below already wins that one. What does is
   * a window that arrived as NaN, because every step after this multiplies it
   * and `Math.max(floor, NaN)` is NaN: a delay of NaN put on the queue is a
   * job with no delay at all, and the whole allowance goes out at once. That
   * is the exact burst this function exists to prevent, arriving through the
   * function meant to prevent it.
   */
  const target = invitePaceMs(input);
  if (target === null) return floor;

  const jittered = target * (SPREAD_JITTER_LOW + random() * (SPREAD_JITTER_HIGH - SPREAD_JITTER_LOW));
  return Math.round(Math.max(floor, jittered));
}

/**
 * The single gate every LinkedIn action passes through. Denies rather than
 * queues: the caller reschedules using retryAfterMs.
 */
/**
 * Could an invitation actually follow a view, inside the window that makes the
 * view worth spending?
 *
 * The warm-up exists because a request arriving to a name somebody saw a few
 * hours ago lands better than one from a stranger. That is a claim about
 * *recency*, so a view is only worth its allowance if the invitation can
 * plausibly follow it before the memory goes.
 *
 * Eight real people were viewed one Friday afternoon with their invitations
 * due between four and six that evening — and LinkedIn was holding invitations
 * from that account until two the following afternoon. Every one of those
 * views was spent twenty-three hours early. Nothing was broken: the warm-up
 * correctly ignored an invitation throttle, because a throttle stops
 * invitations and not profile views, and that is exactly the behaviour that
 * lets a held campaign keep working. What nobody had asked was whether the
 * *invitation* would still be there when the view matured.
 *
 * Three ways it can fail, and only the first was obvious:
 *
 *  - the provider is holding invitations past the end of the window;
 *  - today's invitation allowance is already spent, so the next one is
 *    tomorrow;
 *  - working hours end before the invitation could go, so the next one is
 *    tomorrow morning.
 *
 * All three are answered by asking the limiter the question it already knows
 * how to answer, at the moment the hold lifts rather than now. `too_soon` is
 * the one refusal that does not count: it is the ordinary two-to-eleven minute
 * gap between actions, which is minutes and always inside the window.
 */
export function invitationCouldFollow(
  input: {
    usage: AccountUsage;
    /** When the provider stops refusing invitations, if it is refusing them. */
    pausedUntil: Date | null;
    /**
     * The earliest the invitation may follow the view.
     *
     * Asking whether an invitation could go *now* is the wrong question and
     * gives the wrong answer at the end of a working day: at half past five a
     * send is still allowed, so warming looks fine — and the invitation is
     * scheduled three quarters of an hour later, by which time the day is over
     * and the real send is on Monday morning, sixty hours after the view.
     */
    maturesAfterMs: number;
    /** How long a view stays worth having. */
    windowMs: number;
  },
  now: Date = new Date(),
): boolean {
  const deadline = now.getTime() + input.windowMs;

  const held = input.pausedUntil?.getTime() ?? 0;
  if (Number.isFinite(held) && held > deadline) return false;

  // From the moment the view has matured, or the moment invitations become
  // possible again, whichever is later. A six hour hold with four hours left
  // is still a window a view can live in.
  const from = new Date(
    Math.max(now.getTime() + input.maturesAfterMs, Number.isFinite(held) ? held : 0),
  );
  if (from.getTime() > deadline) return false;

  const decision = checkAction("invite", input.usage, from);
  if (decision.allowed) return true;

  // Every refusal is treated the same way: could it clear before the view goes
  // stale? There is deliberately no special case for `too_soon`, the ordinary
  // two-to-eleven minute gap between actions — the arithmetic already answers
  // it, because a two minute wait is always inside a window measured in hours.
  // A branch for it looked prudent and could never change the answer, which
  // makes it a guard no test can honestly cover.
  return from.getTime() + decision.retryAfterMs <= deadline;
}

export function checkAction(kind: ActionKind, usage: AccountUsage, now: Date = new Date()): Decision {
  if (!isWithinWorkingHours(now, usage.workingHours, usage.timezone)) {
    return {
      allowed: false,
      reason: "outside_working_hours",
      retryAfterMs: msUntilWorkingHours(now, usage.workingHours, usage.timezone),
    };
  }

  if (usage.lastActionAt) {
    const elapsed = now.getTime() - usage.lastActionAt.getTime();
    if (elapsed < LINKEDIN_LIMITS.minGapMs) {
      return { allowed: false, reason: "too_soon", retryAfterMs: LINKEDIN_LIMITS.minGapMs - elapsed };
    }
  }

  const untilTomorrow = msUntilNextLocalMidnight(now, usage.timezone);

  if (kind === "invite") {
    if (usage.invitesThisWeek >= LINKEDIN_LIMITS.invitesPerWeek) {
      return { allowed: false, reason: "weekly_invite_cap", retryAfterMs: untilTomorrow };
    }
    if (usage.invitesToday >= dailyInviteCap(usage.firstActionAt, now)) {
      return { allowed: false, reason: "daily_invite_cap", retryAfterMs: untilTomorrow };
    }
    return { allowed: true };
  }

  if (kind === "profile_view") {
    /*
     * Its own ceiling, and deliberately below the field consensus.
     *
     * A view is the cheapest action on LinkedIn and therefore the easiest to
     * do far too many of — which is exactly how an account that never sent a
     * single risky message ends up throttled. It gets no share of the
     * invitation ramp and grants none.
     */
    if (usage.profileViewsToday >= LINKEDIN_LIMITS.profileViewsPerDay) {
      return { allowed: false, reason: "daily_profile_view_cap", retryAfterMs: untilTomorrow };
    }
    return { allowed: true };
  }

  if (usage.messagesToday >= LINKEDIN_LIMITS.messagesPerDay) {
    return { allowed: false, reason: "daily_message_cap", retryAfterMs: untilTomorrow };
  }
  return { allowed: true };
}

