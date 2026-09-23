import type { Db } from "@le/db";

/**
 * Puts the sequence back on the rails for anybody who fell off it.
 *
 * A campaign prospect moves forward because `next_action_at` says when. Every
 * path that sets it is correct today, but a row can still end up with no next
 * action and no way back: a job that threw between the send and the reschedule,
 * a status written by a version of the code that computed the delay wrongly, a
 * step deleted from under a prospect mid-sequence. The first live acceptance
 * landed in exactly that state.
 *
 * Nothing noticed. The prospect sits in `accepted` or `messaged_1` for ever,
 * the campaign reports `running`, and the funnel reads zero — which the person
 * who launched it correctly reads as "the agent is doing nothing".
 *
 * So the agent repairs its own queue rather than waiting for somebody to spot
 * it and write an update by hand. Repair must never depend on a person finding
 * a button, and it must never depend on one opening psql either.
 *
 * Two things it deliberately does not do. It never *brings forward* a schedule
 * somebody is waiting out — only a missing or long-overdue one is re-armed, or
 * this would collapse every configured delay to now. And it never invents a
 * step: a prospect whose sequence has genuinely ended is left alone, because
 * the end of a sequence is an answer.
 */
export async function unstickProspects(db: Db, now: Date = new Date(), limit = 200): Promise<number> {
  // The statuses that mean "mid-sequence, waiting for the next message". A
  // queued prospect has not been invited; a closed, failed or opted-out one is
  // finished and must never be restarted.
  const LIVE = ["accepted", "messaged_1", "messaged_2", "messaged_3"] as const;

  const { data: rows } = await db
    .from("campaign_prospects")
    .select("id, campaign_id, variant_id, status, last_step_sent, next_action_at, accepted_at")
    .in("status", LIVE)
    .limit(limit);

  // An hour of slack: a row whose time has just passed is not stuck, it is
  // waiting for the next tick, and re-arming it would move it backwards.
  const overdueBefore = now.getTime() - 60 * 60_000;

  let repaired = 0;
  for (const row of rows ?? []) {
    const due = row.next_action_at ? Date.parse(row.next_action_at) : null;
    const stuck = due === null || (Number.isFinite(due) && (due as number) < overdueBefore);
    if (!stuck) continue;

    const nextNumber = (row.last_step_sent ?? 0) + 1;
    const step = await stepFor(db, row.campaign_id, row.variant_id ?? null, nextNumber);
    // No step left. The sequence is over for this person, which is an outcome
    // rather than a fault, and inventing one would message somebody twice.
    if (!step) continue;

    await db
      .from("campaign_prospects")
      // Due now rather than `now + delay_days`: the delay was already served
      // while the row sat here. The limiter still decides the actual minute,
      // so this schedules the work rather than performing it.
      .update({ next_action_at: now.toISOString() })
      .eq("id", row.id);
    repaired += 1;
  }
  return repaired;
}

/** This angle's step, falling back to the campaign-wide one. Rule 28. */
async function stepFor(
  db: Db,
  campaignId: string,
  variantId: string | null,
  stepNumber: number,
): Promise<{ delay_days: number } | null> {
  if (variantId) {
    const { data } = await db
      .from("campaign_steps")
      .select("delay_days")
      .eq("campaign_id", campaignId)
      .eq("variant_id", variantId)
      .eq("step_number", stepNumber)
      .limit(1);
    if (data?.[0]) return data[0];
  }
  const { data } = await db
    .from("campaign_steps")
    .select("delay_days")
    .eq("campaign_id", campaignId)
    .is("variant_id", null)
    .eq("step_number", stepNumber)
    .limit(1);
  return data?.[0] ?? null;
}
