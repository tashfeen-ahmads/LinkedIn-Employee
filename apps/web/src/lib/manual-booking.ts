import type { Db } from "@le/db";

/**
 * "I have booked it" on a booking hold, recorded the way a booking is.
 *
 * The button only cleared the hold, so a meeting the rep booked by hand —
 * exactly the meetings the automatic path could not — counted nowhere: the
 * funnel reads `meeting_booked` on the campaign prospect and the reports count
 * `meeting.booked` events, and neither was written. The worker's booking path
 * (`apps/worker/src/jobs/booking.ts`) writes both, and so does this.
 *
 * No `meetings` row: the time was agreed off-product and this button does not
 * ask for it, and a row with an invented start time would block a real slot on
 * the rep's own calendar (rule 18). The event says it was marked by hand.
 *
 * Counted once. The status moves only out of `replied` or `positive`, the same
 * states the worker books from, and the event is written only when it moved —
 * so a second press, or a stale tab, does not count a second meeting.
 */
export async function recordManualBooking(
  db: Db,
  input: { workspaceId: string; conversationId: string; userId: string },
): Promise<{ ok: true; counted: boolean } | { ok: false; reason: string }> {
  const { data: conversation, error: readError } = await db
    .from("conversations")
    .select("id, prospect_id, campaign_id")
    .eq("id", input.conversationId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (readError) return { ok: false, reason: readError.message };
  if (!conversation) return { ok: false, reason: "conversation not found" };

  let update = db
    .from("campaign_prospects")
    .update({ status: "meeting_booked", closed_at: new Date().toISOString(), next_action_at: null })
    .eq("workspace_id", input.workspaceId)
    .eq("prospect_id", conversation.prospect_id as string)
    .in("status", ["replied", "positive"]);
  if (conversation.campaign_id) update = update.eq("campaign_id", conversation.campaign_id as string);
  const { data: moved, error: updateError } = await update.select("id");
  if (updateError) return { ok: false, reason: updateError.message };

  const counted = (moved ?? []).length > 0;
  if (counted) {
    const { error: eventError } = await db.from("events").insert({
      workspace_id: input.workspaceId,
      name: "meeting.booked",
      actor_user_id: input.userId,
      subject_type: "conversation",
      subject_id: input.conversationId,
      payload: { manual: true } as never,
    });
    if (eventError) console.error(`[inbox] meeting.booked event: ${eventError.message}`);
  }

  return { ok: true, counted };
}
