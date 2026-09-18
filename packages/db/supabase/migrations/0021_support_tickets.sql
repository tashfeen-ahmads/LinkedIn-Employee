-- Somewhere to say "this is broken" without leaving the product.
--
-- Every failure this deployment hit was reported by a person typing into a chat
-- window and pasting a screenshot, and every one of them needed the same three
-- facts to diagnose: which workspace, what they were doing, and what the
-- product thought was true at that moment. The first two were always in the
-- message somewhere; the third never was.

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Who raised it. `set null` rather than cascade: a ticket outlives the
  -- account of somebody who has left, and the operator answering it still needs
  -- to know what happened.
  raised_by uuid references profiles (id) on delete set null,
  subject text not null,
  body text not null,
  -- open → answered → closed. Deliberately three and not a workflow: this is a
  -- way to reach somebody, not a helpdesk.
  status text not null default 'open',
  -- What the product believed when the ticket was raised: which onboarding step
  -- they were on, whether LinkedIn was connected, whether the sending loop had
  -- run. Captured here rather than asked for, because the person raising a
  -- ticket does not know which of those facts matters and should not have to.
  context jsonb not null default '{}'::jsonb,
  answered_at timestamptz,
  answer text,
  created_at timestamptz not null default now()
);
create index support_tickets_workspace_idx on support_tickets (workspace_id, created_at desc);
create index support_tickets_open_idx on support_tickets (status, created_at desc);

alter table support_tickets enable row level security;

-- A member reads and raises their own workspace's tickets, and nothing else.
create policy support_tickets_member_select on support_tickets
  for select to authenticated
  using (workspace_id in (select current_workspace_ids()));

create policy support_tickets_member_insert on support_tickets
  for insert to authenticated
  with check (workspace_id in (select current_workspace_ids()));

-- Deliberately no member update policy. A ticket is a record of what somebody
-- said at the time; letting them rewrite it after an answer turns the log into
-- an argument. The operator answers through the service role.

-- The operator console reads every ticket, by the same additive-policy pattern
-- as rule 15 — and a ticket is one of the few things a platform admin SHOULD
-- see, because somebody asked them to look at it.
create policy support_tickets_platform_select on support_tickets
  for select to authenticated
  using (is_platform_admin());
