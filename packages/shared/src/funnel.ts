import type { CampaignProspectStatus } from "./schemas.js";

/**
 * The outreach funnel, as the campaign state machine actually records it.
 *
 * Status is a single current state, not a set of flags, so "accepted" counts
 * everyone who reached that stage *or went past it* — otherwise a prospect who
 * replied would silently drop out of the accepted count and every rate would
 * be wrong in the flattering direction.
 */
export interface FunnelStage {
  key: "invited" | "accepted" | "replied" | "positive" | "meetings";
  label: string;
  /** Every status that means this stage was reached. */
  statuses: readonly CampaignProspectStatus[];
}

const AT_LEAST_INVITED = [
  "invited",
  "accepted",
  "messaged_1",
  "messaged_2",
  "messaged_3",
  "replied",
  "positive",
  "negative",
  "meeting_booked",
] as const;

const AT_LEAST_ACCEPTED = [
  "accepted",
  "messaged_1",
  "messaged_2",
  "messaged_3",
  "replied",
  "positive",
  "negative",
  "meeting_booked",
] as const;

const AT_LEAST_REPLIED = ["replied", "positive", "negative", "meeting_booked"] as const;

export const FUNNEL_STAGES: readonly FunnelStage[] = [
  { key: "invited", label: "Invited", statuses: AT_LEAST_INVITED },
  { key: "accepted", label: "Accepted", statuses: AT_LEAST_ACCEPTED },
  { key: "replied", label: "Replied", statuses: AT_LEAST_REPLIED },
  { key: "positive", label: "Positive", statuses: ["positive", "meeting_booked"] },
  { key: "meetings", label: "Meetings", statuses: ["meeting_booked"] },
];

export type FunnelCounts = Record<FunnelStage["key"], number>;

export function countFunnel(statuses: readonly string[]): FunnelCounts {
  const counts = {} as FunnelCounts;
  for (const stage of FUNNEL_STAGES) {
    counts[stage.key] = statuses.filter((status) =>
      (stage.statuses as readonly string[]).includes(status),
    ).length;
  }
  return counts;
}

/**
 * The two rates a manager actually judges a rep by, with the targets from
 * docs/02-product-spec.md section 6. Returns null rather than 0 when the
 * denominator is empty: a rep with three invitations out has no acceptance
 * rate yet, and showing 0% would read as failure rather than as too early.
 */
export interface FunnelRates {
  acceptance: number | null;
  reply: number | null;
}

export const RATE_TARGETS = { acceptance: 0.3, reply: 0.15 } as const;

/** Below this, a percentage is noise rather than a signal about the rep. */
export const MIN_FOR_RATE = 10;

export function funnelRates(counts: FunnelCounts): FunnelRates {
  return {
    acceptance: counts.invited >= MIN_FOR_RATE ? counts.accepted / counts.invited : null,
    reply: counts.accepted >= MIN_FOR_RATE ? counts.replied / counts.accepted : null,
  };
}
