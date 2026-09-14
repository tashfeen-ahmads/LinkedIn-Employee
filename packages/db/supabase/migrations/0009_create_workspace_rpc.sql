-- Signup could create a workspace and then could not read it back.
--
-- `workspaces_select` makes a workspace visible to its members:
--
--   id in (select current_workspace_ids())   -- workspaces you have a membership in
--
-- Onboarding inserted the workspace and asked for the new id in the same
-- statement (`insert ... returning id`, which is what `.insert().select()` in
-- the client compiles to). At that instant the caller has no membership — the
-- membership row is inserted next — so the row they just wrote is invisible to
-- them and RETURNING is refused.
--
-- Postgres reports the refusal as "new row violates row-level security policy
-- for table \"workspaces\"", the same sentence a failed WITH CHECK produces. So
-- the error points at the INSERT policy, which is `with check (true)` and has
-- nothing to do with it. Every signup died here.
--
-- Widening the SELECT policy would fix the symptom and leave the real problem:
-- creating a workspace is two writes that must both happen. When the second one
-- failed, the first was already committed, leaving a workspace with no members
-- — invisible to everyone, deletable by no one, and counted by nothing.
--
-- So creation becomes one function. It runs as definer because it has to write
-- the membership that makes the workspace visible, and it acts only ever for
-- auth.uid(): it cannot name another user, cannot touch an existing workspace,
-- and creates exactly one owner membership for the caller.

create or replace function create_workspace(
  p_name text,
  p_slug text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  -- Definer rights with no caller is an anonymous workspace nobody owns.
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'workspace name is required' using errcode = '22023';
  end if;

  insert into workspaces (name, slug, plan, trial_ends_at)
  values (btrim(p_name), p_slug, 'trial', now() + interval '7 days')
  returning id into v_id;

  -- Same statement block as the insert above: either both land or neither
  -- does, so the orphan case cannot happen.
  insert into memberships (workspace_id, user_id, role)
  values (v_id, v_user, 'owner');

  -- Collected on the same form. Optional, and never overwrites with blank.
  if coalesce(btrim(p_full_name), '') <> '' then
    update profiles set full_name = btrim(p_full_name) where id = v_user;
  end if;

  return v_id;
end;
$$;

revoke execute on function create_workspace(text, text, text) from public, anon;
grant execute on function create_workspace(text, text, text) to authenticated;

-- With creation behind the function, a direct insert is no longer a path
-- anyone needs, and `with check (true)` is exactly the permission that let a
-- memberless workspace be written in the first place. The worker uses the
-- service role and is unaffected; the seed script does too.
drop policy if exists workspaces_insert on workspaces;
