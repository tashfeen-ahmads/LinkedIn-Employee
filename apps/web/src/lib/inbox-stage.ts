/**
 * Where one prospect actually got to, for the inbox's stage tabs.
 *
 * The status says where somebody is now, and an ended row says only that it
 * ended: `closed`, `failed` and `opted_out` were read as "no stage", so a
 * person invited, accepted, messaged twice and then closed vanished from every
 * tab, and a `negative` reply was not counted as a reply at all. A rep who has
 * written to forty people and is shown thirty cannot tell a quiet week from a
 * product that lost ten of them.
 *
 * So an ended row is placed by the furthest thing that really happened to it,
 * read from its timestamps: a reply, a follow-up sent, an acceptance, an
 * invitation. Somebody never invited stays out of every tab, because nobody
 * wrote to them.
 */
export type InboxStage = "invited" | "accepted" | "messaged" | "replied" | "booked";

export interface InboxStageRow {
  status: string;
  invited_at?: string | null;
  accepted_at?: string | null;
  replied_at?: string | null;
  last_step_sent?: number | null;
}

export function inboxStageOf(row: InboxStageRow): InboxStage | null {
  const status = row.status;
  if (status === "meeting_booked") return "booked";
  if (status === "replied" || status === "positive" || status === "negative") return "replied";
  if (status.startsWith("messaged")) return "messaged";
  if (status === "accepted") return "accepted";
  if (status === "invited") return "invited";
  if (status === "queued") return null;
  // closed, failed, opted_out, or anything newer: where they got to before it ended.
  if (row.replied_at) return "replied";
  if ((row.last_step_sent ?? 0) > 0) return "messaged";
  if (row.accepted_at) return "accepted";
  if (row.invited_at) return "invited";
  return null;
}
