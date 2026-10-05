import type { Db } from "@le/db";

/**
 * A conversation waiting on a person, and what they have to do about it.
 *
 * The kind matters because each is resolved by a different act. A reply hold
 * ends when the reply goes out. A booking hold ends when someone puts the
 * meeting in a diary — and sending a reply, which happens moments later on the
 * same conversation, must not be mistaken for that.
 *
 * `copy` is the third, and it is not about this conversation at all. A follow-up
 * built from `{{pitch}}` with no approved pitch behind it is held rather than
 * failed (rule 40), and it used to be flagged as a *reply* — so it appeared in
 * the inbox as a conversation needing an answer, with no draft in it, because
 * the message was never rendered. The only useful action was on another screen
 * and nothing said so. Worse, `clearHold(id, "reply")` matched it: sending a
 * manual reply cleared a hold that was never about replying, and every screen
 * then reported the conversation dealt with until the next tick re-held it.
 */
export type HoldKind = "reply" | "booking" | "copy";

/**
 * Which hold wins when two land on one conversation. A conversation carries one
 * kind at a time, so a second flag either replaces the first or leaves it.
 *
 * `booking` is first: somebody accepted a time and it is in nobody's diary, so
 * a real person may turn up to a call nobody else knows about. The inbound job
 * books first and drafts second, in the same run, so a reply hold arrives
 * moments after a booking hold as a matter of course — and it used to overwrite
 * it, which erased the only record that the meeting needed booking by hand.
 *
 * `reply` beats `copy`. A copy hold is a follow-up waiting for a pitch to be
 * approved, and a prospect who has replied has stopped the sequence that
 * follow-up belonged to: what is waiting now is their message, not our copy.
 * The other way round, a follow-up being held must not hide a reply somebody
 * still has to answer.
 */
const HOLD_RANK: Record<HoldKind, number> = { booking: 3, reply: 2, copy: 1 };

/** The kinds a new hold of this kind may replace: itself and anything below it. */
function replaceable(kind: HoldKind): HoldKind[] {
  return (Object.keys(HOLD_RANK) as HoldKind[]).filter((k) => HOLD_RANK[k] <= HOLD_RANK[kind]);
}

/**
 * Flags a conversation for a person, never downgrading a more important hold.
 *
 * Three conditional statements rather than a read and a write: reading the kind
 * and writing back over it is a race between two jobs on one conversation, and
 * the one that loses is the booking. Each statement only touches a row it is
 * allowed to replace, so whichever order they land in, a booking hold stands.
 */
export async function flagForHuman(
  db: Db,
  conversationId: string,
  reason: string,
  kind: HoldKind = "reply",
): Promise<void> {
  const patch = { needs_human: true, needs_human_reason: reason, needs_human_kind: kind };
  // Not held at all. A row cleared by hand may still carry a stale kind, and
  // that kind is not a hold.
  await db.from("conversations").update(patch).eq("id", conversationId).eq("needs_human", false);
  // Held with no kind recorded: rows from before kinds existed.
  await db.from("conversations").update(patch).eq("id", conversationId).is("needs_human_kind", null);
  // Held for something this hold outranks or equals.
  await db.from("conversations").update(patch).eq("id", conversationId).in("needs_human_kind", replaceable(kind));
}

/**
 * Clears a hold of one kind only. Called with "reply" after a reply is sent:
 * a conversation also waiting for a manual booking stays flagged, because that
 * meeting is still in nobody's diary.
 */
export async function clearHold(db: Db, conversationId: string, kind: HoldKind): Promise<void> {
  await db
    .from("conversations")
    .update({ needs_human: false, needs_human_reason: null, needs_human_kind: null })
    .eq("id", conversationId)
    .eq("needs_human_kind", kind);
}
