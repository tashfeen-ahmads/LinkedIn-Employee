-- Roles for the people who run the platform (rule 15, rule 59).
--
-- `platform_admins` was one flat list written from a SQL console. Running the
-- product is now several people doing different jobs, so each admin carries a
-- role, and an owner can add, change and remove admins from the console. The
-- table still has no insert, update or delete policy: every change goes
-- through the worker, which holds the service role and checks the caller is an
-- owner before it writes. Self-promotion through the API stays impossible.
--
-- Everybody already in the table set it up by hand and runs the platform, so
-- they become owners.

alter table platform_admins
  add column if not exists role text not null default 'owner',
  add column if not exists added_by uuid references profiles (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_admins_role_check') then
    alter table platform_admins
      add constraint platform_admins_role_check check (role in ('owner', 'admin', 'support', 'viewer'));
  end if;
end $$;

-- Somebody invited before they have an account. Claimed by the worker the
-- first time that person opens the console signed in with this address.
create table if not exists platform_admin_invites (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('owner', 'admin', 'support', 'viewer')),
  invited_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table platform_admin_invites enable row level security;

drop policy if exists platform_admin_invites_select on platform_admin_invites;
create policy platform_admin_invites_select on platform_admin_invites for select
  to authenticated using (is_platform_admin());

-- The caller's own role, for the console to decide what to show. The worker
-- decides what may be done; this only decides what is offered.
create or replace function platform_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from platform_admins where user_id = auth.uid();
$$;

grant execute on function platform_admin_role() to authenticated;

-- Answering a ticket is support's job and up; a viewer reads the console and
-- presses nothing. Otherwise unchanged from 0041.
create or replace function answer_support_ticket(p_ticket_id uuid, p_answer text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from platform_admins where user_id = auth.uid() and role in ('owner', 'admin', 'support')
  ) then
    raise exception 'not allowed to answer tickets';
  end if;

  if p_status not in ('open', 'answered', 'closed') then
    raise exception 'unknown ticket status: %', p_status;
  end if;

  update support_tickets
     set answer = p_answer,
         status = p_status,
         answered_by = case when p_answer is null then answered_by else 'operator' end,
         answered_at = case when p_answer is null then answered_at else now() end
   where id = p_ticket_id;
end;
$$;
