/**
 * Database values as words a person reads.
 *
 * `messaged_1`, `reauth_required` and `owner` were reaching screens as they
 * are stored. One map, so the same status reads the same everywhere.
 */
const LABELS: Record<string, string> = {
  // campaign_prospects.status
  queued: "Waiting to invite",
  invited: "Invited",
  accepted: "Accepted",
  messaged_1: "First message sent",
  messaged_2: "Second message sent",
  messaged_3: "Third message sent",
  replied: "Replied",
  positive: "Interested",
  negative: "Not interested",
  meeting_booked: "Meeting booked",
  closed: "Closed",
  opted_out: "Opted out",
  failed: "Failed",
  // campaigns.status
  draft: "Draft",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
  // linkedin_accounts.status
  connecting: "Connecting",
  active: "Connected",
  warning: "Warning",
  restricted: "Restricted",
  reauth_required: "Needs reconnecting",
  disconnected: "Disconnected",
  // memberships.role
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  rep: "Rep",
  // support tickets
  open: "Open",
  answered: "Answered",
  // exclusions
  company: "Company",
  person: "Person",
};

export function label(value: string | null | undefined): string {
  if (!value) return "—";
  return LABELS[value] ?? value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
