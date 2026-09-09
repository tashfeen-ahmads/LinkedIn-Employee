-- Two policies were missing, each of which blocks a flow entirely.

-- 1. Nobody could create a workspace. `workspaces` had SELECT and UPDATE
--    policies but no INSERT, so RLS denied every signup: a new user has no
--    membership yet, so there is nothing to check them against.
--
--    Any authenticated user may create a workspace. They become its owner in
--    the same transaction; the membership policy below is what stops them
--    joining anyone else's.
create policy workspaces_insert on workspaces for insert
  to authenticated
  with check (true);

-- 2. Nobody could accept an invitation. `memberships_write` required
--    is_workspace_admin(), which an invitee is not — they are not a member at
--    all yet — so the insert that admits them was always denied.
--
--    Replace the blanket policy with one that keeps administration to admins
--    while allowing exactly two self-service cases: claiming a workspace you
--    just created, and accepting an invitation addressed to your own email.
drop policy memberships_write on memberships;

create policy memberships_admin_write on memberships for all
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

create policy memberships_self_insert on memberships for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and (
      -- Claiming a workspace that has no members yet, i.e. the one you just
      -- created during signup.
      not exists (select 1 from memberships existing where existing.workspace_id = memberships.workspace_id)
      -- Or redeeming a live invitation sent to your own address.
      or exists (
        select 1
        from invitations i
        where i.workspace_id = memberships.workspace_id
          and i.accepted_at is null
          and i.revoked_at is null
          and i.expires_at > now()
          and lower(i.email) = lower((select email from profiles where id = auth.uid()))
          and i.role = memberships.role
      )
    )
  );

-- 3. An invitee must be able to read the invitation addressed to them, and
--    mark it accepted. The member-only select policy excluded exactly the
--    person the row exists for.
create policy invitations_invitee_select on invitations for select
  to authenticated
  using (lower(email) = lower((select email from profiles where id = auth.uid())));

create policy invitations_invitee_accept on invitations for update
  to authenticated
  using (
    lower(email) = lower((select email from profiles where id = auth.uid()))
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  )
  with check (lower(email) = lower((select email from profiles where id = auth.uid())));
