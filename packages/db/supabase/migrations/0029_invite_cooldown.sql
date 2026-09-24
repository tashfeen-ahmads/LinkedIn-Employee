-- When LinkedIn asks for time, the account stops asking.
--
-- Every invitation LinkedIn refused was recorded as a permanent failure and the
-- loop kept going: seven refusals in twenty-five minutes on one morning, seven
-- real prospects burned, and seven more rejected invitations posted to an
-- account LinkedIn had already decided to slow down. The refusal's own words
-- were "please try again later".
--
-- So a throttle is held on the account rather than spent one prospect at a
-- time. `invites_paused_until` is what the pacing loop reads before it offers
-- any invitation for this account at all, and `invites_paused_reason` is what
-- the campaign screen says instead of a bare count of failures — "7 failed"
-- reads as seven bad prospects, which is the one thing it was not.
--
-- On the account rather than the campaign on purpose: the limit is LinkedIn's
-- opinion of the account, so a second campaign on the same account must not
-- walk straight into the same wall.

alter table linkedin_accounts
  add column if not exists invites_paused_until timestamptz,
  add column if not exists invites_paused_reason text;

-- Read on every pacing tick for every active account, and almost always null.
create index if not exists linkedin_accounts_invites_paused_until_idx
  on linkedin_accounts (invites_paused_until)
  where invites_paused_until is not null;

comment on column linkedin_accounts.invites_paused_until is
  'Set when the provider refuses with a retryable throttle. The pacing loop offers no invitations on this account until it passes. Cleared by time, never by a person.';
