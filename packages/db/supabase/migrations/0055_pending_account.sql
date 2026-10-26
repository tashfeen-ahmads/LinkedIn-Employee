-- The account a rep's own sign-in produced, remembered when it could not be
-- claimed on the spot (rule 8).
--
-- LinkedIn's hosted sign-in sends the rep back with the new account's id, on
-- a return this worker signed for that rep. That id is the only tie between a
-- finished sign-in and a person: the provider's account list carries no
-- reference to who started the flow, and its `name` is the LinkedIn display
-- name. When the claim on return is refused — the provider's list had not
-- caught up yet, or could not be asked — the id used to be logged and lost,
-- and the row sat `connecting` while the account worked at the provider.
--
-- Kept here instead, and retried by the Team/onboarding refresh and by nightly
-- recovery. It binds nothing by itself: a retry still asks the provider, never
-- takes an account another row holds, and only completes a row waiting for
-- one. Written only by the worker's service role.
alter table linkedin_accounts
  add column if not exists pending_provider_account_id text;

comment on column linkedin_accounts.pending_provider_account_id is
  'Account id from this rep''s own signed sign-in return that could not be claimed yet; retried by refresh and recovery. Never matched by display name.';

-- Members may write their workspace's account rows (the tenant policy in
-- 0001), and an id here is one the worker will try to claim. So only the
-- service role sets it: an id typed into a browser is not an id that arrived
-- on the rep's own signed return. Same pattern as the billing columns (0052).
create or replace function linkedin_accounts_pending_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
begin
  if v_role is null or v_role = 'service_role' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.pending_provider_account_id is not null)
    or (tg_op = 'UPDATE' and new.pending_provider_account_id is distinct from old.pending_provider_account_id)
  then
    raise exception 'pending_provider_account_id can only be set by the worker' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists linkedin_accounts_pending_guard on linkedin_accounts;
create trigger linkedin_accounts_pending_guard
  before insert or update on linkedin_accounts
  for each row execute function linkedin_accounts_pending_guard();
