-- Two corrections from the October review.
--
-- 1. The pacing loop's per-campaign decisions and per-account queue counts
--    moved off the `campaign-tick` heartbeat, which every signed-in member can
--    read (migration 0056), onto `campaign-tick:detail`, which only platform
--    admins can. A member still needs their own account's count for the
--    campaign page's "up to N more today" (rule 21), so this hands back that
--    one entry and only to somebody in the account's workspace. The
--    membership check is the whole authorisation, as `platform_workspace_stats`
--    (rule 15) is.

create or replace function pacing_in_flight(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select h.detail -> 'inFlight' -> (p_account_id::text)
    from worker_heartbeats h
   where h.name = 'campaign-tick:detail'
     and exists (
       select 1
         from linkedin_accounts a
         join memberships m on m.workspace_id = a.workspace_id
        where a.id = p_account_id
          and m.user_id = auth.uid()
     );
$$;

revoke execute on function pacing_in_flight(uuid) from public, anon;
grant execute on function pacing_in_flight(uuid) to authenticated;

-- 2. Which prompt wrote a campaign step. A sent message recorded the build's
--    current campaign-writer version for every step, so copy written in
--    September, revised by the nightly repair or edited by a person was
--    traced to a prompt that never touched it. Null means a person wrote or
--    edited it, or it predates this column.

alter table campaign_steps add column if not exists prompt_version text;
