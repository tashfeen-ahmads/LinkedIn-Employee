-- The sending engine's own bookkeeping, for three rules it could not keep
-- without somewhere to write them down.

-- ── The weekly ceiling is a rolling seven days ──────────────────────────────
--
-- `invites_this_week` was zeroed on the ISO Monday, while LinkedIn's weekly
-- limit is a rolling window (docs/06-research.md section 2). A campaign
-- launched on a Wednesday could send its hundred Wednesday to Friday and
-- another hundred Monday to Wednesday: a hundred and seventy inside seven
-- consecutive days, from an account the ceiling said was within its week.
--
-- So each invitation is also counted against the rep's own day it went out on,
-- and the week is the sum of the last seven of those. Counted in the same one
-- statement as every other counter (rule 2): a per-day tally read and written
-- back by the worker would lose one of two concurrent sends exactly as the
-- totals would. Days older than the window are dropped as the next one is
-- written, so the object never holds more than eight keys.
--
-- The day is `counters_reset_on`, the rep's local date, which the worker rolls
-- over before every send. Not `current_date`: that is the database's UTC day,
-- and a Pacific rep's afternoon would be counted against tomorrow.
alter table linkedin_accounts
  add column invites_by_day jsonb not null default '{}'::jsonb;

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
    invites_by_day = case
      when p_kind = 'invite' then
        coalesce(
          (
            select jsonb_object_agg(d.key, d.value)
            from jsonb_each(coalesce(invites_by_day, '{}'::jsonb)) d
            where d.key >= to_char(coalesce(counters_reset_on, current_date) - 7, 'YYYY-MM-DD')
          ),
          '{}'::jsonb
        )
        || jsonb_build_object(
          to_char(coalesce(counters_reset_on, current_date), 'YYYY-MM-DD'),
          coalesce((invites_by_day ->> to_char(coalesce(counters_reset_on, current_date), 'YYYY-MM-DD'))::int, 0) + 1
        )
      else invites_by_day
    end,
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

-- Filled from what was actually sent, so the first week after this ships is
-- not a week with no history. Each invitation is counted on the rep's own
-- date; a zone Postgres does not know is read as UTC rather than failing the
-- migration.
update linkedin_accounts a
set invites_by_day = coalesce(
  (
    select jsonb_object_agg(t.day, t.n)
    from (
      select
        to_char(
          (cp.invited_at at time zone coalesce(
            (select tz.name from pg_timezone_names tz join profiles p on p.timezone = tz.name where p.id = a.user_id limit 1),
            'UTC'
          ))::date,
          'YYYY-MM-DD'
        ) as day,
        count(*)::int as n
      from campaign_prospects cp
      join campaigns c on c.id = cp.campaign_id
      where c.linkedin_account_id = a.id
        and cp.invited_at >= now() - interval '8 days'
      group by 1
    ) t
  ),
  '{}'::jsonb
);

-- ── One invitation per person, however many presses ─────────────────────────
--
-- Send one now and the queued job for the same row both read `queued`, both
-- passed every check, and both asked LinkedIn — one person, two invitations,
-- under a real rep's name. A send now claims the row in one conditional
-- statement before the provider is called; a second claimant matches nothing
-- and stops. The claim is a lease rather than a flag, so a process that dies
-- between the claim and the call does not strand the person for ever.
alter table campaign_prospects
  add column invite_claimed_at timestamptz;

-- ── A recipient LinkedIn keeps refusing is let go ───────────────────────────
--
-- "An invitation has already been sent recently to this recipient" put the
-- row back in the queue for a day, every day, for as long as the campaign ran:
-- each attempt another rejected request logged against the account. Counted
-- per person, and the second refusal closes the row with LinkedIn's reason.
alter table campaign_prospects
  add column invite_refusals int not null default 0;
