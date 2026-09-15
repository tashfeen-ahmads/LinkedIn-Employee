-- The operator's view across every workspace.
--
-- Every table here carries RLS scoped to workspace membership, which is the
-- point: one customer must never see another's. That also means whoever runs
-- this product cannot see anything either — they can support a customer only by
-- asking them what their screen says.
--
-- So: a named set of platform administrators, and additive SELECT policies for
-- them. Additive because permissive policies are OR'd — the existing membership
-- policies are untouched, and a normal user's access is exactly what it was.

create table platform_admins (
  user_id uuid primary key references profiles (id) on delete cascade,
  -- Why this person has it, for whoever reads this table in a year.
  note text,
  created_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

-- Definer, because a policy that reads this table to decide who may read this
-- table does not terminate.
create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

grant execute on function is_platform_admin() to authenticated;
grant select on platform_admins to authenticated;

-- Admins can see who else is an admin. Nobody can write this table through the
-- API at all: there is no insert, update or delete policy, so the only way to
-- grant this is with the service role or a SQL console. Self-promotion through
-- a bug in the app is then not a thing that can happen.
create policy platform_admins_select on platform_admins for select
  to authenticated
  using (is_platform_admin());

-- What an operator can see.
--
-- Deliberately not everything. Supporting a workspace means knowing who is in
-- it, whether their LinkedIn account is healthy, what their campaigns are doing
-- and what they are spending. It does not mean reading their prospects' names
-- or the contents of their conversations — `messages`, `conversations`,
-- `reply_drafts` and `prospects` are left alone, and the console gets counts
-- from the function below instead of rows.
create policy workspaces_platform_select on workspaces for select
  to authenticated using (is_platform_admin());

create policy memberships_platform_select on memberships for select
  to authenticated using (is_platform_admin());

create policy profiles_platform_select on profiles for select
  to authenticated using (is_platform_admin());

create policy linkedin_accounts_platform_select on linkedin_accounts for select
  to authenticated using (is_platform_admin());

create policy campaigns_platform_select on campaigns for select
  to authenticated using (is_platform_admin());

create policy events_platform_select on events for select
  to authenticated using (is_platform_admin());

create policy llm_calls_platform_select on llm_calls for select
  to authenticated using (is_platform_admin());

create policy invitations_platform_select on invitations for select
  to authenticated using (is_platform_admin());

create policy meetings_platform_select on meetings for select
  to authenticated using (is_platform_admin());

/**
 * Counts from the tables an operator may not read row by row.
 *
 * The guard inside matters: without `where is_platform_admin()` this is a
 * definer function that hands every workspace's totals to anyone who can call
 * it. It is the whole access check, and it is one line away from not being
 * there.
 */
create or replace function platform_workspace_stats()
returns table (
  workspace_id uuid,
  prospects bigint,
  conversations bigint,
  pending_drafts bigint,
  messages_sent bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id,
    (select count(*) from prospects p where p.workspace_id = w.id),
    (select count(*) from conversations c where c.workspace_id = w.id),
    (select count(*) from reply_drafts d where d.workspace_id = w.id and d.status = 'pending'),
    (select count(*) from messages m where m.workspace_id = w.id and m.direction = 'outbound')
  from workspaces w
  where is_platform_admin();
$$;

revoke execute on function platform_workspace_stats() from public, anon;
grant execute on function platform_workspace_stats() to authenticated;


-- Verified against the live database before this was relied on, in a rolled
-- back transaction, using a second workspace the admin is not a member of —
-- because an admin who is also a member of the only workspace reads it through
-- the ordinary membership policy, and a test set up that way passes without
-- proving anything.
--
--   other workspace visible   1   ← its existence
--   their messages            0
--   their prospects           0
--   their conversations       0
--   their prospects counted   1   ← through platform_workspace_stats()
