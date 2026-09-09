import type { CampaignProspectStatus } from "./schemas.js";

/**
 * The outreach funnel.
 *
 * A stage is counted from the fact that it happened, not from where the
 * prospect stands now. Status is a single current state and terminal states
 * overwrite it: someone invited who later opts out, is excluded, or has their
 * invitation withdrawn ends up `opted_out` or `closed`, and reading status
 * alone drops them out of "Invited" entirely. A manager watching their invited
 * count fall week after week is watching a bug, not their team.
 *
 * So each stage is reached when any of three things is true:
 *  - its timestamp is set — the fact, and nothing erases it;
 *  - the current status is at or past that stage — for rows written before
 *    those timestamps existed, and for the two late stages that have none;
 *  - a later stage was reached — you cannot have replied without accepting.
 *
 * The third rule is what makes the funnel monotonic by construction rather
 * than by hoping the data agrees.
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

/** What the funnel needs from one campaign_prospects row. */
export interface FunnelRow {
  status: string;
  invited_at?: string | null;
  accepted_at?: string | null;
  replied_at?: string | null;
}

export type FunnelCounts = Record<FunnelStage["key"], number>;

/** The stages one prospect reached, latest first so earlier ones can inherit. */
function stagesReached(row: FunnelRow): FunnelCounts {
  const at = (stage: FunnelStage["key"]) =>
    (FUNNEL_STAGES.find((s) => s.key === stage)!.statuses as readonly string[]).includes(row.status);

  const meetings = at("meetings") ? 1 : 0;
  const positive = meetings || (at("positive") ? 1 : 0);
  const replied = positive || (row.replied_at || at("replied") ? 1 : 0);
  const accepted = replied || (row.accepted_at || at("accepted") ? 1 : 0);
  const invited = accepted || (row.invited_at || at("invited") ? 1 : 0);

  return { invited, accepted, replied, positive, meetings };
}

export function countFunnel(rows: readonly FunnelRow[]): FunnelCounts {
  const counts: FunnelCounts = { invited: 0, accepted: 0, replied: 0, positive: 0, meetings: 0 };
  for (const row of rows) {
    const reached = stagesReached(row);
    for (const stage of FUNNEL_STAGES) counts[stage.key] += reached[stage.key];
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
