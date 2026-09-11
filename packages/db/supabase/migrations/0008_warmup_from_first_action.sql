-- The warm-up ramp starts at the first action, not at connection.
--
-- dailyInviteCap measured from connected_at, which is the same day as the
-- first send only for someone who connects and launches together. Wire a
-- deployment up over a fortnight — Unipile on Monday, Resend's DNS on Tuesday,
-- Google on Thursday — and the account is three weeks "old" before it has ever
-- sent anything. The ramp would then allow 25 invitations on its first real
-- day, which is precisely the burst the ramp exists to prevent, and the only
-- sign would be a restricted account.
--
-- So the clock is stamped by the first recorded action instead. An account that
-- has sent nothing sits at the starting allowance however long ago it was
-- connected.

alter table linkedin_accounts add column first_action_at timestamptz;

-- Existing accounts that have already sent something: the best available
-- estimate of when they started is when they were connected, and it is the
-- conservative direction — never later than the truth, so never a larger
-- allowance than they have earned.
update linkedin_accounts
set first_action_at = connected_at
where last_action_at is not null;

-- Stamped in the same statement that moves the counters, so it cannot drift
-- from them and cannot be forgotten by a new caller. `coalesce` makes it
-- first-write-wins: the value never moves again.
create or replace function record_linkedin_action(p_account_id uuid, p_kind text)
returns table (invites_today int, invites_this_week int, messages_today int)
language sql
security definer
set search_path = le
as $$
  update linkedin_accounts
  set
    invites_today = invites_today + case when p_kind = 'invite' then 1 else 0 end,
    invites_this_week = invites_this_week + case when p_kind = 'invite' then 1 else 0 end,
    messages_today = messages_today + case when p_kind = 'message' then 1 else 0 end,
    last_action_at = now(),
    first_action_at = coalesce(first_action_at, now())
  where id = p_account_id
  returning invites_today, invites_this_week, messages_today;
$$;

revoke execute on function record_linkedin_action(uuid, text) from public, anon, authenticated;
