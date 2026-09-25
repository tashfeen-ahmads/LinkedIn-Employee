-- Look at somebody's profile before asking to connect.
--
-- A connection request that arrives cold is a stranger's name in a list of
-- thirty. The same request, to somebody who saw you view their profile two
-- hours earlier, arrives to a name they half recognise — and the published
-- benchmarks put that difference at around a third more acceptances, with
-- multi-touch sequences several times better than a single cold ask.
--
-- Three columns, because a view is its own kind of action and must not borrow
-- anything from the invitation:
--
-- `profile_views_today` is its own counter. A view is not a connection
-- request: it has its own daily allowance, it does not come off the invite
-- ramp, and LinkedIn throttling invitations does not stop one. Sharing a
-- counter would mean warming a prospect cost us the ability to write to them —
-- and it is precisely while invitations are held that a campaign most needs
-- something useful to do.
--
-- `warm_up` is per campaign rather than per workspace, because it is a
-- decision about a list: a campaign built from people who already know the rep
-- does not need it, and it spends real allowance.
--
-- `warmed_at` is on the prospect's row and not inferred from a timestamp
-- elsewhere. "Has this person been looked at" is the question the sender asks
-- immediately before deciding whether to invite them, and an answer computed
-- from three other columns is an answer that drifts.

alter table linkedin_accounts
  add column if not exists profile_views_today integer not null default 0;

alter table campaigns
  add column if not exists warm_up boolean not null default false;

alter table campaign_prospects
  add column if not exists warmed_at timestamptz;

comment on column linkedin_accounts.profile_views_today is
  'Profile views spent today. Its own allowance: never drawn from the invitation ramp, and never stopped by an invitation throttle.';
comment on column campaigns.warm_up is
  'Look at each prospect''s profile before inviting them, so the request reaches a name they have already seen.';
comment on column campaign_prospects.warmed_at is
  'When this prospect''s profile was viewed. Null means the invitation has not been warmed.';
