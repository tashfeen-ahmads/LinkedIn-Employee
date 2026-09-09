import type { Db } from "@le/db";

/**
 * A conversation waiting on a person, and what they have to do about it.
 *
 * The kind matters because the two are resolved by different acts. A reply hold
 * ends when the reply goes out. A booking hold ends when someone puts the
 * meeting in a diary — and sending a reply, which happens moments later on the
 * same conversation, must not be mistaken for that.
 */
export type HoldKind = "reply" | "booking";

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
