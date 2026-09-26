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

export async function flagForHuman(
  db: Db,
  conversationId: string,
  reason: string,
  kind: HoldKind = "reply",
): Promise<void> {
  await db
    .from("conversations")
    .update({ needs_human: true, needs_human_reason: reason, needs_human_kind: kind })
    .eq("id", conversationId);
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
