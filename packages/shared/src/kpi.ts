import {
  FUNNEL_STAGES,
  MIN_FOR_RATE,
  RATE_TARGETS,
  countFunnel,
  stagesFor,
  type FunnelRow,
  type FunnelStage,
} from "./funnel.js";
import type { CtaKind } from "./cta.js";

/**
 * What a dashboard is allowed to claim.
 *
 * Three rules, each of which this product got wrong on a screen somebody read:
 *
 *  1. A stage nobody in this workspace can reach is not shown. Rule 29 makes
 *     that true per campaign (`stagesFor`); a workspace runs several campaigns
 *     with different goals, so its stage list is the union of theirs. A
 *     workspace whose every campaign sends a link reported "Meetings 0" for
 *     ever, which reads as failure and is in fact the campaign working.
 *  2. A rate below `MIN_FOR_RATE` is not a rate. `funnelRates` has said so
 *     since the first week and the overview reimplemented it with
 *     `denominator === 0`, so three invitations and no acceptance rendered
 *     "0.0%" against a 30% target — a rep's first morning reported as a
 *     failing account.
 *  3. A total says nothing about now. Lifetime counts only ever go up, so a
 *     campaign that stopped sending a fortnight ago and one sending today are
 *     the same five numbers.
 */

/** The stages worth showing a workspace, given what its campaigns ask for. */
export function stagesForGoals(goals: readonly CtaKind[]): readonly FunnelStage[] {
  // No campaigns at all: show the full funnel. An empty dashboard is a preview
  // of what this will say, and cutting it to the stages of nothing would
  // rearrange itself the moment somebody built their first campaign.
  if (goals.length === 0) return FUNNEL_STAGES;
  const keys = new Set<FunnelStage["key"]>();
  for (const goal of goals) for (const stage of stagesFor(goal)) keys.add(stage.key);
  // Filtered from the canonical list rather than accumulated, so the order is
  // the funnel's own order however the goals arrived.
  return FUNNEL_STAGES.filter((stage) => keys.has(stage.key));
}

export type RateVerdict = "too-early" | "on-target" | "below";

export interface Rate {
  value: number | null;
  verdict: RateVerdict;
  numerator: number;
  denominator: number;
  target: number;
}

/**
 * One reading of "how is this rate doing", used by every rate on every screen.
 *
 * `too-early` is a third state and not a styling of `below`: a rep with four
 * invitations out has not failed, and the difference is the whole reason
 * `MIN_FOR_RATE` exists.
 */
export function rate(numerator: number, denominator: number, target: number): Rate {
  if (denominator < MIN_FOR_RATE) {
    return { value: null, verdict: "too-early", numerator, denominator, target };
  }
  const value = numerator / denominator;
  return {
    value,
    verdict: value >= target ? "on-target" : "below",
    numerator,
    denominator,
    target,
  };
}

/** A row with the timestamps needed to place it in time. */
export interface DatedFunnelRow extends FunnelRow {
  invited_at?: string | null;
}

/**
 * Invitations sent in a window, and in the window before it.
 *
 * Only invitations: an acceptance can land weeks after the invitation that
 * earned it, so attributing it to the week it arrived would credit a week that
 * sent nothing. "Did we send this week" is the question a silent system needs
 * answered, and it is answerable exactly.
 */
export interface Momentum {
  current: number;
  previous: number;
  /** Null when the previous window sent nothing: there is no change from zero. */
  change: number | null;
}

export function momentum(rows: readonly DatedFunnelRow[], now: number, windowMs: number): Momentum {
  const start = now - windowMs;
  const previousStart = start - windowMs;
  let current = 0;
  let previous = 0;

  for (const row of rows) {
    if (!row.invited_at) continue;
    const at = new Date(row.invited_at).getTime();
    if (!Number.isFinite(at)) continue;
    // Half-open on both ends, so a row on the boundary is counted once.
    if (at >= start && at <= now) current += 1;
    else if (at >= previousStart && at < start) previous += 1;
  }

  return { current, previous, change: previous === 0 ? null : (current - previous) / previous };
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Everything one funnel panel needs, computed once. */
export interface FunnelReport {
  stages: readonly FunnelStage[];
  counts: ReturnType<typeof countFunnel>;
  acceptance: Rate;
  reply: Rate;
  momentum: Momentum;
}

export function funnelReport(
  rows: readonly DatedFunnelRow[],
  goals: readonly CtaKind[],
  now: number = Date.now(),
): FunnelReport {
  const counts = countFunnel(rows);
  return {
    stages: stagesForGoals(goals),
    counts,
    // The targets live in one place; a screen that wrote its own would be a
    // second reading of the number the first one is judged against.
    acceptance: rate(counts.accepted, counts.invited, RATE_TARGETS.acceptance),
    reply: rate(counts.replied, counts.accepted, RATE_TARGETS.reply),
    momentum: momentum(rows, now, WEEK_MS),
  };
}
