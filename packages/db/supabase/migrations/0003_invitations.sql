-- Team invitations. Without these a workspace can only ever have the person who
-- signed it up, which makes the Teams plan unsellable.

create table invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  email citext not null,
  role membership_role not null default 'rep',
  -- Random, single-use, and never derived from the email: possession of the
  -- token is what grants access, so it must not be guessable from anything a
  -- would-be joiner already knows.
  token text not null unique,
  invited_by uuid references profiles (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references profiles (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- One live invitation per email per workspace; re-inviting replaces the old one.
create unique index invitations_pending_unique
  on invitations (workspace_id, email)
  where accepted_at is null and revoked_at is null;

create index on invitations (workspace_id, created_at desc);

alter table invitations enable row level security;

-- Members can see their workspace's invitations; only admins can create or
-- revoke them. The token column is readable by members, which is acceptable:
-- they are already inside the workspace the token grants access to.
create policy invitations_member_select on invitations for select
  using (workspace_id in (select current_workspace_ids()));
create policy invitations_admin_write on invitations for all
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
