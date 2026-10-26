-- Likes and comments on prospects' posts (rule 68).
--
-- Each is its own allowance, counted in the same one statement as every other
-- action (rule 2), and neither starts the invitation ramp (rule 3): engaging
-- with somebody's post is not a send.

alter table linkedin_accounts
  add column if not exists reactions_today int not null default 0,
  add column if not exists comments_today int not null default 0;

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
    reactions_today = reactions_today + case when p_kind = 'post_reaction' then 1 else 0 end,
    comments_today = comments_today + case when p_kind = 'post_comment' then 1 else 0 end,
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
    -- Only a send starts the invitation ramp. A view, a like or a comment is not a send.
    first_action_at = case
      when p_kind in ('profile_view', 'post_reaction', 'post_comment') then first_action_at
      else coalesce(first_action_at, now())
    end
  where id = p_account_id
  returning invites_today, invites_this_week, messages_today;
$$;

revoke execute on function record_linkedin_action(uuid, text) from public, anon, authenticated;

-- One row per like or comment, planned and then sent. The unique index is the
-- never-twice guarantee for a post: a second plan for the same post and kind
-- from the same account fails to insert.
create table if not exists engagement_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  linkedin_account_id uuid not null references linkedin_accounts(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete set null,
  post_id text not null,
  post_url text,
  post_excerpt text,
  post_at timestamptz,
  kind text not null check (kind in ('reaction', 'comment')),
  reaction_type text,
  body text,
  grounding text,
  prompt_version text,
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  reason text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists engagement_one_per_post
  on engagement_actions (linkedin_account_id, post_id, kind);
create index if not exists engagement_by_workspace
  on engagement_actions (workspace_id, created_at desc);

alter table engagement_actions enable row level security;

-- Read-only for members: rows are written by the worker.
create policy engagement_actions_read on engagement_actions
  for select using (workspace_id in (select current_workspace_ids()));

-- When this workspace last engaged with each person, so nobody is liked
-- twice in a week.
alter table prospects add column if not exists last_engaged_at timestamptz;

-- On by default: liking and commenting is part of what the agent does. A
-- workspace that does not want it turns it off on its profile.
alter table workspaces add column if not exists engage_posts boolean not null default true;
