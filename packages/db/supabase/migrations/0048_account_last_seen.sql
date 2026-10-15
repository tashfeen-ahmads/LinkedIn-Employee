-- When each rep was last in the product, for the idle-account release (rule 63).
--
-- A connected LinkedIn account is paid for every month whether it sends or
-- not, so one with no running campaign and no activity for fourteen days is
-- released. "No activity" includes the rep themselves: somebody signing in to
-- build a campaign is using the account even before it sends.
--
-- `last_sign_in_at` alone is not that. A session that stays signed in for
-- weeks refreshes its token and never signs in again, so the newest session
-- refresh counts as well — read here because `auth` is not exposed through the
-- API.
--
-- The worker's service role is the only caller. It names the reps it is asking
-- about, and the answer is a timestamp per rep and nothing else.
create function account_last_seen(p_user_ids uuid[])
returns table (user_id uuid, last_seen_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select u.id,
         greatest(
           u.last_sign_in_at,
           (select max(coalesce(s.refreshed_at, s.updated_at, s.created_at))
              from auth.sessions s
             where s.user_id = u.id)
         )
    from auth.users u
   where u.id = any(p_user_ids);
$$;

revoke execute on function account_last_seen(uuid[]) from public;
revoke execute on function account_last_seen(uuid[]) from anon, authenticated;
grant execute on function account_last_seen(uuid[]) to service_role;
