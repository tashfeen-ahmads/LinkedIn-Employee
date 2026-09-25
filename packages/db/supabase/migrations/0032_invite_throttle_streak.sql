-- How many times running LinkedIn has refused this account's invitations.
--
-- The cooldown after a provider throttle was a flat six hours, which is right
-- the first time and wrong every time after it. An account LinkedIn keeps
-- refusing was probed again every six hours, indefinitely — a constant knock
-- on a door that has been shut, which is precisely how a temporary limit
-- becomes a permanent restriction, and a restriction is the one failure this
-- product cannot come back from.
--
-- So the wait doubles: 6 hours, 12, 24, 48, capped at three days. The account
-- is still probed, because a throttle that has lifted has to be discovered
-- somehow and nobody should have to find a button (rule 8) — but the knocking
-- gets quieter instead of staying exactly as loud for ever.
--
-- Reset by a successful invitation and by nothing else. Not by time, not by a
-- refusal that turned out to be about one recipient: the only evidence that
-- LinkedIn is accepting invitations from this account again is LinkedIn
-- accepting one.

alter table linkedin_accounts
  add column if not exists invite_throttle_streak integer not null default 0;

comment on column linkedin_accounts.invite_throttle_streak is
  'Consecutive account-wide invitation refusals since the last accepted invitation. Doubles the cooldown; reset only by a send that succeeds.';
