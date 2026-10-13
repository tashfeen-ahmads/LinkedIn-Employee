import { LINKEDIN_LIMITS } from "@le/shared";

/** Room left before a warm-up stops counting, for the send path's own gap and retries. */
export const WARM_MARGIN_MS = 15 * 60_000;

/** How often the pacing loop runs (queues.ts schedules it every five minutes). */
export const PACING_TICK_MS = 5 * 60_000;

/**
 * Working time an invitation needs after the wait behind a view has ended: a
 * tick to notice it is due, the longest gap the loop can place it behind, and
 * the margin the send path keeps for its own gap and retries.
 */
export const INVITE_FOLLOW_MS = 2 * PACING_TICK_MS + LINKEDIN_LIMITS.maxGapMs + WARM_MARGIN_MS;

/**
 * How long after a profile view the invitation becomes due — or null when no
 * invitation could follow it inside today's working hours.
 *
 * The loop places a warmed invitation no later than the window minus
 * WARM_MARGIN_MS, and it only notices a due prospect on its next tick. A wait
 * drawn right up to the end of the window therefore left nothing to place: the
 * prospect was skipped, the view went stale, and the loop viewed them again,
 * spending a second view and pushing the invitation back by hours. About one
 * warmed prospect in fourteen took that path. So the draw stops early enough
 * that the first tick after it is due can still place the invitation.
 *
 * And it stops before the rep's day ends. A view at four with an hour of the
 * working day left drew its wait out to three hours just as often as one at
 * nine: the invitation then fell due after hours, nothing could place it, the
 * view went stale overnight and the person was viewed a second time the next
 * morning. Capped by the working time left, less what the invitation needs to
 * follow; when even the shortest wait does not fit, there is no wait to give,
 * and the view belongs to tomorrow.
 */
export function warmUpWaitMs(
  random: () => number = Math.random,
  workingMsLeft: number = Number.POSITIVE_INFINITY,
): number | null {
  const min = LINKEDIN_LIMITS.warmUpToInviteMinMs;
  const max = LINKEDIN_LIMITS.warmUpToInviteMaxMs - WARM_MARGIN_MS - 2 * PACING_TICK_MS;
  const room = workingMsLeft - INVITE_FOLLOW_MS;
  if (!(room >= min)) return null;
  return Math.min(min + random() * (max - min), room);
}

/** Whether a view taken now still leaves today room for its invitation. */
export function viewFitsToday(workingMsLeft: number): boolean {
  return warmUpWaitMs(() => 0, workingMsLeft) !== null;
}
