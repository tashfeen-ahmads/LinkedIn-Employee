-- Count a profile view, in the same one statement as everything else.
--
-- Rule 2: reading a counter and writing back read + 1 loses one of two
-- concurrent actions, which is an account quietly passing its cap. Views are
-- the highest-volume action this product takes, so they are the ones most
-- likely to race.
--
-- Two deliberate asymmetries.
--
-- A view moves `last_action_at`, because the minimum gap is between any two
-- actions on an account and two of *any* kind back to back is the pattern
-- LinkedIn's heuristics watch for. A warm-up that ignored the gap would be a
-- burst of forty profile views in a minute, which is worse than the cold
-- invitation it was meant to replace.
--
-- A view does **not** set `first_action_at`. That column is day zero of the
-- invitation ramp (rule 3), and the ramp exists to stop a never-used account
-- being handed its full allowance on the first day it ever invites anybody.
-- An account that spent a week warming prospects has still never sent an
-- invitation, so it starts the ramp at the beginning — which is the
-- conservative reading and the one that matches what the ramp is for.

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
    profile_views_today = profile_views_today + case when p_kind = 'profile_view' then 1 else 0 end,
    last_action_at = now(),
    -- Only a send starts the invitation ramp. A view is not a send.
    first_action_at = case
      when p_kind = 'profile_view' then first_action_at
      else coalesce(first_action_at, now())
    end
  where id = p_account_id
  returning invites_today, invites_this_week, messages_today;
$$;

revoke execute on function record_linkedin_action(uuid, text) from public, anon, authenticated;
