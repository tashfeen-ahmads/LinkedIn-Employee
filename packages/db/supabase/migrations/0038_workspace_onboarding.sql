-- What onboarding was told that nothing could hold yet.
--
-- The sending window and the Sales Navigator tick belong to the LinkedIn
-- account, and at signup nobody has connected one. Asking for them again after
-- connecting is the thing onboarding exists to stop, so the answers wait here
-- and the account row takes them the moment it is made.
--
-- jsonb rather than three columns because it is a holding area, not a source
-- of truth: once the account exists, `linkedin_accounts.working_hours` is the
-- answer and this is only how it got there.
alter table workspaces add column if not exists onboarding jsonb;

comment on column workspaces.onboarding is
  'Answers from onboarding that had nowhere to live yet (sending hours, Sales Navigator, autonomy). Applied to linkedin_accounts and campaigns when those rows are created; not read afterwards.';
