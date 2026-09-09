-- Shared exclusion lists: the workspace-wide "never contact these" list.
--
-- The Teams plan sells this, and the reason is not tidiness. When three reps
-- prospect one market, the account a colleague is already closing, the customer
-- who signed last week, and the competitor all look exactly like good targets
-- to a search. Inviting them is the mistake that gets an AI SDR switched off.
--
-- Deliberately not a column on prospects: an exclusion has to apply to people
-- the workspace has never seen, which is most of them.

create type exclusion_kind as enum ('company', 'person');

create table exclusions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kind exclusion_kind not null,
  -- The normalized form, and the only thing matching ever compares against.
  -- Written by the application (packages/shared/src/exclusions.ts) so that one
  -- definition of "the same company" governs both storage and matching.
  value text not null,
  -- What the person actually typed, kept for display: "Acme Corp." reads back
  -- as itself rather than as "acme".
  raw_value text not null,
  reason text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Adding the same company twice is a no-op, not a duplicate row.
create unique index exclusions_unique on exclusions (workspace_id, kind, value);
create index on exclusions (workspace_id, created_at desc);

alter table exclusions enable row level security;

-- Every member reads the list — that is what "shared" means, and a rep needs
-- to see why a name was skipped. Only admins and managers change it, because
-- removing an entry is what lets a message reach an off-limits account.
create policy exclusions_member_select on exclusions for select
  using (workspace_id in (select current_workspace_ids()));
create policy exclusions_admin_write on exclusions for all
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
