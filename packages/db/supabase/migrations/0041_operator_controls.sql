-- The operator console stops being a window and becomes a control panel.
--
-- Until now every fix an operator made went through a SQL editor: pausing a
-- campaign, clearing an account's hold, answering a ticket that had sat for
-- four days. Repair must never depend on somebody finding a terminal (rule 33),
-- so the controls move onto the console, and the worker — which holds the
-- service role — performs them after checking `platform_admins` itself.

-- ── Platform settings ──────────────────────────────────────────────────────
-- One row. `id boolean check (id)` is the idiom for "there is exactly one".
create table platform_settings (
  id boolean primary key default true check (id),
  -- The kill switch. Set, every invitation, profile view and follow-up on the
  -- platform waits; nothing is failed or dropped, and lifting it resumes the
  -- queue where it stood. Replies a person approved still go: those are a
  -- human answering a human, not outreach.
  outreach_paused_at timestamptz,
  outreach_paused_reason text,
  outreach_paused_by uuid references profiles (id) on delete set null,
  -- Whether the support agent answers a ticket itself when it is sure, or only
  -- drafts an answer for a person to send.
  support_autopilot boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into platform_settings default values;

alter table platform_settings enable row level security;

-- Readable by every signed-in person: a campaign screen has to be able to say
-- "outreach is paused" rather than show a loop that has silently stopped.
-- No write policy. Changes go through the worker, which checks the caller is a
-- platform admin before it uses the service role.
create policy platform_settings_read on platform_settings
  for select to authenticated using (true);

-- ── Support automation ─────────────────────────────────────────────────────
alter table support_tickets
  add column category text,
  -- Who wrote the answer the customer is reading. A customer is told when an
  -- answer came from the assistant, and an operator can see which ones did.
  add column answered_by text check (answered_by in ('agent', 'operator')),
  -- The assistant's answer when it was not sure enough to send it, or when
  -- autopilot is off. Prefilled in the operator's reply box.
  add column draft_answer text,
  add column draft_confidence real,
  -- Why the draft was held rather than sent, in the operator's words.
  add column draft_reason text,
  -- Stamped once the assistant has looked at the ticket, sent or not, so the
  -- hourly sweep does not pay for the same ticket twice.
  add column drafted_at timestamptz,
  add column reopened_at timestamptz,
  -- What the customer said when they pressed "Still stuck".
  add column followup text;

create index support_tickets_undrafted_idx on support_tickets (created_at)
  where status = 'open' and drafted_at is null;

-- An operator's answer is stamped as theirs.
create or replace function answer_support_ticket(p_ticket_id uuid, p_answer text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'not a platform admin';
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

-- "Still stuck": the customer reopens their own ticket and says what is still
-- wrong. A definer function rather than an update policy for rule 33's reason —
-- the subject and body they wrote first must survive. A reopened ticket is
-- never answered by the assistant again: somebody who said the automatic
-- answer did not help gets a person.
create function reopen_support_ticket(p_ticket_id uuid, p_followup text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_followup), '') = '' then
    raise exception 'say what is still wrong';
  end if;

  update support_tickets
     set status = 'open',
         followup = left(p_followup, 4000),
         reopened_at = now(),
         draft_answer = null,
         draft_confidence = null,
         draft_reason = null,
         drafted_at = null
   where id = p_ticket_id
     and status <> 'open'
     and workspace_id in (select current_workspace_ids());

  if not found then
    raise exception 'that ticket is not yours or is already open';
  end if;
end;
$$;

revoke execute on function reopen_support_ticket(uuid, text) from public;
grant execute on function reopen_support_ticket(uuid, text) to authenticated;

-- ── Operator reads ─────────────────────────────────────────────────────────
-- Every person on the platform, with when they last signed in. `auth.users` is
-- not reachable through the API, so a definer function reads the one column
-- needed; `where is_platform_admin()` is the whole access check (rule 15).
create function platform_users()
returns table (
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  marketing_opt_out_at timestamptz,
  is_admin boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         p.email::text,
         p.full_name,
         p.created_at,
         u.last_sign_in_at,
         p.marketing_opt_out_at,
         exists (select 1 from platform_admins a where a.user_id = p.id)
    from profiles p
    left join auth.users u on u.id = p.id
   where is_platform_admin();
$$;

revoke execute on function platform_users() from public;
grant execute on function platform_users() to authenticated;

-- Model spend by day and agent, summed in the database: `llm_calls` gains a
-- row per agent call and read row by row it stops at PostgREST's thousandth.
create function platform_spend_breakdown(p_days int default 30)
returns table (
  day date,
  agent text,
  model text,
  calls bigint,
  failed bigint,
  spend_usd numeric,
  unpriced bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select (c.created_at at time zone 'utc')::date,
         c.agent::text,
         c.model,
         count(*),
         count(*) filter (where c.error is not null),
         coalesce(sum(c.cost_usd), 0),
         count(*) filter (where c.cost_usd is null)
    from llm_calls c
   where is_platform_admin()
     and c.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
   group by 1, 2, 3
   order by 1 desc, 2, 3;
$$;

revoke execute on function platform_spend_breakdown(int) from public;
grant execute on function platform_spend_breakdown(int) to authenticated;

-- Campaign progress by status, for every campaign on the platform. Counts only:
-- `campaign_prospects` names the people in a campaign, and rule 15 keeps those
-- off the console.
create function platform_campaign_stats()
returns table (campaign_id uuid, status text, people bigint)
language sql
stable
security definer
set search_path = public
as $$
  select cp.campaign_id, cp.status::text, count(*)
    from campaign_prospects cp
   where is_platform_admin()
   group by 1, 2;
$$;

revoke execute on function platform_campaign_stats() from public;
grant execute on function platform_campaign_stats() to authenticated;
