-- The pitch is written once, approved by a person, and used by every campaign.
--
-- The invitation may not pitch and the first message after an acceptance may
-- not either — both are enforced in the Targeting Agent's prompt, and both are
-- right: a paragraph arriving seconds after somebody accepts reads as a
-- sequence, and the reply rate of a sequence is the reply rate of an advert.
-- So the product already said, in as many words, that "the pitch is sent when
-- they reply, not before".
--
-- The pitch itself was nowhere. The Reply Agent improvised the offer from the
-- business profile every time it answered, which means every prospect who ever
-- said "sure, what is it?" received a differently-worded offer, none of which
-- anybody had read. The one piece of copy in the whole product that actually
-- argues for the thing being sold was the only piece nobody approved.
--
-- One row per workspace, hence `unique`. A pitch is universal by construction:
-- the campaign varies the angle it opens with (rule 28) and the person it is
-- addressed to, never what is being offered. Several pitches would be several
-- offers, and a business that made two different offers to two halves of the
-- same market could no longer read its own reply rate.
create table pitches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces (id) on delete cascade,
  -- What the agent says when somebody asks what this is. Plain text, because
  -- it is spoken into a LinkedIn message and not rendered anywhere.
  body text not null,
  -- Who wrote this draft: the agent, or the person who edited it afterwards.
  -- Kept so the screen can say "the agent wrote this, you have not read it".
  written_by text not null default 'agent' check (written_by in ('agent', 'human')),
  -- The facts the agent leaned on, so "is this true" is a checkable question
  -- rather than a matter of opinion. Same purpose as rule 16's `grounding`.
  facts_used jsonb not null default '[]'::jsonb,
  -- Nothing unapproved is ever sent. This is rule 9's shape applied to copy:
  -- the agent writes the pitch and does not approve it, exactly as the
  -- Strategy Agent writes customer profiles and does not approve those.
  approved_at timestamptz,
  approved_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Editing the words un-approves them. An approval is a statement about a
-- particular piece of text, not a permanent property of the row: without this,
-- one approval in September authorises every rewrite afterwards, and the
-- review that this table exists for happens exactly once.
create or replace function pitch_edit_needs_reapproval()
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

create trigger pitches_reapprove
  before update on pitches
  for each row execute function pitch_edit_needs_reapproval();

alter table pitches enable row level security;

create policy pitches_member_read on pitches
  for select to authenticated
  using (workspace_id in (select current_workspace_ids()));

create policy pitches_member_write on pitches
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

-- Rule 15: the operator console may see that a workspace has a pitch, never
-- what it says — it is the customer's own sales copy.
-- (No platform-admin policy here, deliberately.)

-- Least privilege for this table and its trigger function is applied by
-- `scripts/schema-install.mjs`, in the block that runs *after* the blanket
-- `grant all` that makes the schema addressable at all. A revoke written here
-- would be handed straight back three hundred lines further down, which is the
-- kind of security control that reads correctly and does nothing.
