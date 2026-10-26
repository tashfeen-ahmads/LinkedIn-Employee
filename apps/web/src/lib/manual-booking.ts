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
 * A `meetings` row when the hold kept the time it was for: on Pro every
 * accepted time is held for a person to confirm (rule 67), and without the row
 * that half hour stayed free for the next prospect to be offered and booked
 * into (rule 18). The row goes through `meetings_one_per_rep_slot`, exactly as
 * the worker's does, and a time somebody else has taken since is refused in
 * words rather than double-booked. A hold that kept no time — the time was
 * agreed off-product — writes no row: an invented start time would block a
 * real slot on the rep's own calendar.
 *
 * Counted once. The status moves only out of `replied` or `positive`, the same
 * states the worker books from, and the event is written only when it moved —
 * so a second press, or a stale tab, does not count a second meeting.
 */
export async function recordManualBooking(
  db: Db,
  input: { workspaceId: string; conversationId: string; userId: string },
): Promise<{ ok: true; counted: boolean } | { ok: false; reason: string; message?: string }> {
  const { data: conversation, error: readError } = await db
    .from("conversations")
    .select("id, prospect_id, campaign_id, held_slot_starts_at, held_slot_ends_at, held_slot_rep_user_id")
    .eq("id", input.conversationId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (readError) return { ok: false, reason: readError.message };
  if (!conversation) return { ok: false, reason: "conversation not found" };

  const eligible = () => {
    let query = db
      .from("campaign_prospects")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("prospect_id", conversation.prospect_id as string)
      .in("status", ["replied", "positive"]);
    if (conversation.campaign_id) query = query.eq("campaign_id", conversation.campaign_id as string);
    return query;
  };

  const startsAt = (conversation.held_slot_starts_at as string | null) ?? null;
  const endsAt = (conversation.held_slot_ends_at as string | null) ?? null;
  const repUserId = (conversation.held_slot_rep_user_id as string | null) ?? input.userId;
  if (startsAt && endsAt) {
    // Only for somebody the booking may still move: an opt-out or a closed
    // prospect is never put in anybody's diary.
    const { data: open, error: openError } = await eligible();
    if (openError) return { ok: false, reason: openError.message };
    if ((open ?? []).length > 0) {
      const { error: insertError } = await db.from("meetings").insert({
        workspace_id: input.workspaceId,
        prospect_id: conversation.prospect_id as string,
        conversation_id: input.conversationId,
        rep_user_id: repUserId,
        starts_at: startsAt,
        ends_at: endsAt,
        status: "scheduled",
      });
      if (insertError) {
        const taken = /duplicate|unique|23505|meetings_one_per_rep_slot/i.test(insertError.message);
        if (!taken) return { ok: false, reason: insertError.message };
        // Their own meeting at that time is a second press, not a clash.
        const { data: own } = await db
          .from("meetings")
          .select("id, starts_at")
          .eq("workspace_id", input.workspaceId)
          .eq("prospect_id", conversation.prospect_id as string)
          .eq("rep_user_id", repUserId)
          .neq("status", "cancelled");
        const mine = (own ?? []).some((row) => Date.parse(row.starts_at as string) === Date.parse(startsAt));
        if (!mine) {
          // Taken since it was held. The hold stays, says so, and forgets the
          // time, so a second press cannot try it again.
          await db
            .from("conversations")
            .update({
              needs_human_reason: "The time they accepted has since been taken by another meeting. Offer them another time.",
              held_slot_starts_at: null,
              held_slot_ends_at: null,
              held_slot_rep_user_id: null,
            })
            .eq("id", input.conversationId)
            .eq("workspace_id", input.workspaceId);
          return {
            ok: false,
            reason: "slot taken",
            message: "That time has been taken by another meeting since they accepted it. Offer them another time.",
          };
        }
      }
    }
  }

  let update = db
    .from("campaign_prospects")
    .update({ status: "meeting_booked", closed_at: new Date().toISOString(), next_action_at: null })
    .eq("workspace_id", input.workspaceId)
    .eq("prospect_id", conversation.prospect_id as string)
    .in("status", ["replied", "positive"]);
  if (conversation.campaign_id) update = update.eq("campaign_id", conversation.campaign_id as string);
  const { data: moved, error: updateError } = await update.select("id");
  if (updateError) return { ok: false, reason: updateError.message };

  if (startsAt) {
    // Used: the meeting row now holds the time, and the hold is about to clear.
    await db
      .from("conversations")
      .update({ held_slot_starts_at: null, held_slot_ends_at: null, held_slot_rep_user_id: null })
      .eq("id", input.conversationId)
      .eq("workspace_id", input.workspaceId);
  }

  const counted = (moved ?? []).length > 0;
  if (counted) {
    const { error: eventError } = await db.from("events").insert({
      workspace_id: input.workspaceId,
      name: "meeting.booked",
      actor_user_id: input.userId,
      subject_type: "conversation",
      subject_id: input.conversationId,
      payload: (startsAt ? { manual: true, startsAt } : { manual: true }) as never,
    });
    if (eventError) console.error(`[inbox] meeting.booked event: ${eventError.message}`);
  }

  return { ok: true, counted };
}
