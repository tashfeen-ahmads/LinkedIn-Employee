-- Atomic increment for the counters the rate limiter reads.
--
-- These were incremented by reading the row and writing back read + 1. Two
-- actions in flight at once both read 9 and both write 10, so one send is never
-- counted and the account goes past its cap. The worker avoided this by running
-- the LinkedIn queue at concurrency 1 and the deployment notes said not to run a
-- second instance — a correct rule that one `scale count 2` silently breaks,
-- and the thing it breaks is the only guard between a campaign and a restricted
-- account.
--
-- Postgres can do this correctly in one statement, so it should.

create or replace function record_linkedin_action(p_account_id uuid, p_kind text)
returns table (invites_today int, invites_this_week int, messages_today int)
language sql
security definer
set search_path = public
as $$
  update linkedin_accounts
  set
    invites_today = invites_today + case when p_kind = 'invite' then 1 else 0 end,
    invites_this_week = invites_this_week + case when p_kind = 'invite' then 1 else 0 end,
    messages_today = messages_today + case when p_kind = 'message' then 1 else 0 end,
    last_action_at = now()
  where id = p_account_id
  returning invites_today, invites_this_week, messages_today;
$$;

-- Callable by the service role only: the web tier has no business moving these.
revoke execute on function record_linkedin_action(uuid, text) from public, anon, authenticated;
