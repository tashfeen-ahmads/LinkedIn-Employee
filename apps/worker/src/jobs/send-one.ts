import { runLinkedInAction, RescheduleError } from "./linkedin-action.js";
import type { WorkerContext } from "../context.js";

/**
 * Sends the next queued invitation on a campaign, now, and says what happened.
 *
 * Eight days of this product went into not knowing whether a single real
 * invitation could leave the building. Every path to finding out ran through
 * the pacing loop: press Launch, wait five minutes for a tick, then two to
 * eleven more for the jittered gap, then read a screen that says nothing if
 * anything went wrong in between. One attempt per quarter of an hour, and a
 * blank page for an answer.
 *
 * This is the same send, taken off that conveyor belt. It runs
 * `runLinkedInAction` directly — the one path everything goes through, so the
 * limiter, the health check, the exclusion list, the do-not-contact flag, the
 * never-twice rule and the audit log all still apply — and it returns the
 * outcome to the caller instead of into a log nobody can reach. What it skips
 * is the waiting, which is the only part that was never a safety rule.
 *
 * A refusal is an answer, and often the answer: "outside working hours" and
 * "the provider said the account is not connected" are two completely
 * different afternoons, and neither of them was legible before.
 */
export interface SendOneResult {
  ok: boolean;
  /** What happened, in a sentence for the person who pressed the button. */
  detail: string;
  /** The campaign_prospect that was attempted, when there was one. */
  campaignProspectId?: string;
  status?: string;
  statusReason?: string | null;
}

export async function sendOneNow(
  ctx: WorkerContext,
  input: { workspaceId: string; campaignId: string },
): Promise<SendOneResult> {
  const { db } = ctx;

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, status")
    .eq("id", input.campaignId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!campaign) return { ok: false, detail: "That campaign no longer exists." };
  if (campaign.status !== "running") {
    // Not loosened for a manual send. A campaign nobody has launched has not
    // been reviewed, and this button would become a way around the review.
    return { ok: false, detail: `The campaign is ${campaign.status}. Launch it first.` };
  }

  const { data: next } = await db
    .from("campaign_prospects")
    .select("id")
    .eq("campaign_id", input.campaignId)
    .eq("workspace_id", input.workspaceId)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!next) return { ok: false, detail: "Nobody on this campaign is waiting to be invited." };

  try {
    await runLinkedInAction(ctx, {
      kind: "invite",
      workspaceId: input.workspaceId,
      campaignProspectId: next.id,
    });
  } catch (err) {
    if (err instanceof RescheduleError) {
      // The limiter declining is the system working. Said as such, with its own
      // word for it, rather than as a failure.
      return {
        ok: false,
        campaignProspectId: next.id,
        detail: `The rate limiter is holding this send: ${err.reason}. It is not an error — sending resumes on its own.`,
      };
    }
    // Everything else is the provider, the database, or us. The message is the
    // most valuable sentence in this whole flow and it used to go to a log.
    return {
      ok: false,
      campaignProspectId: next.id,
      detail: `The send failed: ${(err as { message?: string })?.message ?? "unknown"}`,
    };
  }

  // `runLinkedInAction` returns without throwing in several cases that are not
  // a send — a prospect on the exclusion list, somebody already contacted, a
  // transition it refused. The row is what actually happened, so the row is
  // what gets reported.
  const { data: after } = await db
    .from("campaign_prospects")
    .select("status, status_reason")
    .eq("id", next.id)
    .maybeSingle();

  if (after?.status === "invited") {
    return {
      ok: true,
      campaignProspectId: next.id,
      status: after.status,
      detail: "Invitation sent. It should be visible in LinkedIn's sent invitations within a minute.",
    };
  }

  return {
    ok: false,
    campaignProspectId: next.id,
    status: after?.status,
    statusReason: after?.status_reason ?? null,
    detail: after?.status_reason
      ? `Not sent — ${after.status_reason}`
      : `Not sent. The row is now "${after?.status ?? "gone"}" and nothing said why, which is itself worth reporting.`,
  };
}
