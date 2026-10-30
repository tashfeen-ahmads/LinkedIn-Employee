-- The pile of invitations LinkedIn is holding for an account, and the switch
-- that lets Nora clear the old ones.
--
-- LinkedIn refuses new invitations from an account carrying a large backlog of
-- unanswered ones, and it counts every invitation the rep ever sent: by hand,
-- through another tool, years ago. On 30 October four of five sending
-- accounts were refused all day; one held 258 pending invitations of which
-- this product had sent nine. The number was sampled hourly into a heartbeat
-- only operators may read, so nobody it belonged to could see it.
--
-- `pending_invites` is that sample on the account's own row, where its owner
-- can read it. `withdraw_old_invites` lets an owner or admin have the nightly
-- sweep withdraw invitations older than three weeks that were sent outside
-- this product. Off by default: those are the rep's own, and withdrawing them
-- is theirs to choose.

alter table workspaces
  add column if not exists withdraw_old_invites boolean not null default false;

alter table linkedin_accounts
  add column if not exists pending_invites integer,
  add column if not exists pending_invites_at timestamptz;
