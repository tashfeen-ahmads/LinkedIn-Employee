-- The opener gets the same treatment as the offer.
--
-- The Strategy Agent has written three openers per strategy since the first
-- week — `spec.hooks`, rendered on /app/strategy under "Opening angles" — and
-- until 0027 nothing consumed one. They were written, stored, approved by a
-- person, displayed, and then dropped at the single moment they mattered.
--
-- Handing them to the invite writer fixed the dropping. It did not fix the
-- other half: they lived inside a strategy's jsonb, so nobody could approve one
-- without approving the whole strategy, nobody could retire a line that was not
-- working, and an angle could not be given its own. A line that reaches real
-- people deserves the same row a pitch gets.
create table hooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- What a rep calls it in a picker: "Measurement question", not "hook 2".
  name text not null,
  -- The opening line itself.
  body text not null,
  -- Which bet it places, written to the rep and not to the prospect. Stored
  -- because five lines without it read as one question asked five ways, and
  -- somebody approves two that turn out to be the same bet.
  angle text,
  written_by text not null default 'agent' check (written_by in ('agent', 'human')),
  -- Nothing unapproved opens a conversation. Rule 9's division, applied to the
  -- first thing a stranger ever reads from this workspace.
  approved_at timestamptz,
  approved_by uuid references profiles (id) on delete set null,
  -- What an angle with no opener of its own leans on.
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One default, for the reason `pitches_one_default` exists: "which opener"
-- answered by row order is answered differently on different days.
create unique index hooks_one_default on hooks (workspace_id) where is_default;
create index hooks_workspace_idx on hooks (workspace_id, approved_at);

-- Editing the words un-approves them, exactly as a pitch's edit does. An
-- approval is a statement about particular text; without this, one approval
-- authorises every rewrite that follows it.
create or replace function hook_edit_needs_reapproval()
returns trigger
language plpgsql
security invoker
set search_path = le, pg_temp
as $$
begin
  if new.body is distinct from old.body then
    new.approved_at := null;
    new.approved_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger hooks_reapprove
  before update on hooks
  for each row execute function hook_edit_needs_reapproval();

alter table hooks enable row level security;

create policy hooks_member_read on hooks
  for select to authenticated
  using (workspace_id in (select current_workspace_ids()));

create policy hooks_member_write on hooks
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

-- 0027 added `hook text` here and nothing ever wrote to it. Replaced by a
-- pointer, for rule 36's reason: a line retyped into each angle has four
-- versions of itself inside a month and no screen able to say which prospect
-- read which. `set null`, never cascade — retiring an opener must not delete
-- the angle that used it, because the angle still holds the results that were
-- the reason for running the test.
alter table campaign_variants drop column if exists hook;
alter table campaign_variants add column hook_id uuid references hooks (id) on delete set null;
