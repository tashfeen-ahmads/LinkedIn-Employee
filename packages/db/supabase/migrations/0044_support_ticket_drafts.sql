-- The support assistant's held draft, moved off the customer's own row.
--
-- 0041 put `draft_answer`, `draft_confidence` and `draft_reason` on
-- `support_tickets`, and `support_tickets_member_select` lets a member read
-- every column of their own workspace's tickets. So a customer could ask the
-- API for the answer the assistant was not sure enough to send, and for the
-- operator's note on why it was held ("names our suppliers", "billing waits
-- for a person"): an unreviewed answer, and our reasoning about them, read
-- straight out of a column the screen never shows.
--
-- RLS cannot restrict columns, and the install script re-grants every table
-- privilege after the migrations run, so a column revoke would not survive a
-- fresh install either (the reason 0022 gave for `answer_support_ticket`). The
-- draft therefore gets a table of its own that only a platform admin may read,
-- by the same additive-policy pattern as rule 15. The worker writes it with the
-- service role; there is no member policy of any kind.
--
-- `drafted_at` and `category` stay on the ticket. The first is when the
-- assistant looked, which the sweep and the operator's counts both key on and
-- which tells a customer nothing; the second is the kind of ticket it is.
create table support_ticket_drafts (
  ticket_id uuid primary key references support_tickets (id) on delete cascade,
  -- Carried so the row is a tenant row like every other, and so the worker can
  -- filter by it (rule: the service role must filter by workspace itself).
  workspace_id uuid not null references workspaces (id) on delete cascade,
  draft_answer text,
  draft_confidence real,
  draft_reason text,
  updated_at timestamptz not null default now()
);

alter table support_ticket_drafts enable row level security;

-- The operator console reads drafts. Nobody else does, through any role the
-- browser can hold.
create policy support_ticket_drafts_platform_select on support_ticket_drafts
  for select to authenticated
  using (is_platform_admin());

-- Every draft already written moves with its ticket.
insert into support_ticket_drafts (ticket_id, workspace_id, draft_answer, draft_confidence, draft_reason)
select id, workspace_id, draft_answer, draft_confidence, draft_reason
  from support_tickets
 where draft_answer is not null
    or draft_confidence is not null
    or draft_reason is not null;

-- "Still stuck" clears the assistant's last draft, as it did in 0041, now from
-- the table the draft lives in. Replaced before the columns go so the function
-- never refers to a column that does not exist.
create or replace function reopen_support_ticket(p_ticket_id uuid, p_followup text)
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
         drafted_at = null
   where id = p_ticket_id
     and status <> 'open'
     and workspace_id in (select current_workspace_ids());

  if not found then
    raise exception 'that ticket is not yours or is already open';
  end if;

  delete from support_ticket_drafts where ticket_id = p_ticket_id;
end;
$$;

revoke execute on function reopen_support_ticket(uuid, text) from public;
grant execute on function reopen_support_ticket(uuid, text) to authenticated;

alter table support_tickets
  drop column draft_answer,
  drop column draft_confidence,
  drop column draft_reason;
