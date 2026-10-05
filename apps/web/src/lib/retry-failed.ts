import type { CampaignProspectStatus } from "@le/shared";

/**
 * Where a failed prospect goes back to when somebody presses Retry failed.
 *
 * `failed` is written from two different places in a sequence, and a retry
 * has to undo the right one. An invitation that never went out failed from
 * `queued`, and putting that person back in the queue is the whole point. A
 * follow-up that never went out failed from `accepted` or `messaged_N` — the
 * invitation was sent, they accepted it — and putting *that* person back in
 * the queue was worse than leaving them failed: the never-twice check (rule
 * 24) correctly finds their invitation on record, closes them as "already
 * contacted", and the one person on the campaign who said yes is never written
 * to again.
 *
 * So the row goes back to the state it failed from, read off what is still
 * stamped on it: no `invited_at` means the invitation never left; an
 * `accepted_at` means they accepted, and `last_step_sent` says how far the
 * sequence got. A follow-up is made due now, so the step that failed is the
 * step that is tried — the pacing loop and the limiter still decide the
 * minute. An invitation sent and never accepted has nothing to retry until
 * acceptance is noticed, so it waits for that, with no schedule of its own.
 */
export function restoreFromFailure(
  row: { invited_at: string | null; accepted_at: string | null; last_step_sent: number | null },
  now: Date,
): { status: CampaignProspectStatus; next_action_at: string | null } {
  if (!row.invited_at && !row.accepted_at) return { status: "queued", next_action_at: null };
  if (!row.accepted_at) return { status: "invited", next_action_at: null };
  const sent = Math.max(0, Math.floor(row.last_step_sent ?? 0));
  // The state machine has three message states. A row past the third has
  // nothing left to send, and the nightly sweep closes it from there.
  const status = sent === 0 ? "accepted" : (`messaged_${Math.min(sent, 3)}` as CampaignProspectStatus);
  return { status, next_action_at: now.toISOString() };
}
