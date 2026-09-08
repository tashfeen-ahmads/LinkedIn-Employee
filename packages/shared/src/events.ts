/** Append-only audit event names written to the `events` table and emitted to webhooks. */
export const EVENT_NAMES = [
  "linkedin.account.connected",
  "linkedin.account.paused",
  "linkedin.account.reauth_required",
  "strategy.profile.created",
  "campaign.created",
  "campaign.launched",
  "campaign.paused",
  "invite.sent",
  "invite.accepted",
  "invite.withdrawn",
  "message.sent",
  "message.received",
  "reply.drafted",
  "reply.needs_human",
  "reply.sent",
  "prospect.opted_out",
  "meeting.proposed",
  "meeting.booked",
  "crm.synced",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
