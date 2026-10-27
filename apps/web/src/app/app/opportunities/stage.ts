import { effectiveIntent, ReplyIntentSchema } from "@le/shared";
import { inboxStageOf, type InboxStageRow } from "@/lib/inbox-stage";

/**
 * Which column of the opportunities board a conversation sits in.
 *
 * Built on the inbox's reading of where somebody got to (`inboxStageOf`),
 * never beside it: only somebody the inbox counts as replied or booked is an
 * opportunity at all, so the board and the inbox's stage tabs cannot disagree
 * about who has answered. What the board adds is the one distinction the
 * inbox's "Replied" does not draw — whether the answer was a yes, a not-yet or
 * an end — and it reads that from what is already recorded rather than
 * deciding it again:
 *
 * - `meeting_booked` is booked, however the meeting was made.
 * - An ended row (`negative`, `closed`, `failed`, `opted_out`) is closed. A
 *   reply that stopped the sequence is recorded as `negative` by the worker,
 *   and an opt-out is never shown as anything but finished (rule 7).
 * - Their latest reply, read through `effectiveIntent` exactly as the reply
 *   agent reads it (rule 66), saying not yet is "not now". It wins over an
 *   earlier `positive`: "send it over" followed a week later by "after the
 *   board meets in spring" is a not-yet today, and pitching it again is the
 *   mistake the playbook exists to stop.
 * - `positive` is interested: the worker writes it when it acted on a yes
 *   (rule 66's `interested`), and a latest reply read as interested counts
 *   the same way.
 * - Anybody else who answered is "replied": a question, an objection, a
 *   referral — a conversation, not yet a direction.
 */
export type OpportunityStage = "replied" | "interested" | "booked" | "not_now" | "closed";

/** The board's columns in order, open ones first. */
export const OPPORTUNITY_STAGES: { key: OpportunityStage; label: string; collapsed: boolean }[] = [
  { key: "replied", label: "Replied", collapsed: false },
  { key: "interested", label: "Interested", collapsed: false },
  { key: "booked", label: "Meeting booked", collapsed: false },
  { key: "not_now", label: "Not now", collapsed: true },
  { key: "closed", label: "Closed", collapsed: true },
];

const ENDED = new Set(["negative", "closed", "failed", "opted_out"]);

/** Their latest inbound message: what the classifier recorded, and the words. */
export interface LatestReply {
  classification?: unknown;
  body?: string | null;
}

/** The intent the reply agent would act on for this message, or null when none was recorded. */
export function replyIntentOf(reply: LatestReply | null | undefined) {
  if (!reply) return null;
  const raw = (reply.classification as { intent?: unknown } | null | undefined)?.intent;
  const parsed = ReplyIntentSchema.safeParse(raw);
  if (!parsed.success) return null;
  return effectiveIntent(parsed.data, reply.body ?? "");
}

export function opportunityStageOf(
  row: InboxStageRow,
  latestReply?: LatestReply | null,
): OpportunityStage | null {
  const reached = inboxStageOf(row);
  if (reached === "booked") return "booked";
  if (reached !== "replied") return null;
  if (ENDED.has(row.status)) return "closed";
  const intent = replyIntentOf(latestReply);
  if (intent === "not_now") return "not_now";
  if (row.status === "positive" || intent === "interested") return "interested";
  return "replied";
}
