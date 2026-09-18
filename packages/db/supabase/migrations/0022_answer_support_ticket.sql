-- Answering a ticket from inside the operator console.
--
-- 0021 left the answer to "the service role or a SQL console", which is the
-- same mistake this codebase has made before: a repair that depends on somebody
-- opening a terminal is a repair that does not happen. The support queue exists
-- precisely so a customer does not have to find a chat window; an operator who
-- has to find psql to reply has moved the chat window, not removed it.
--
-- But a plain update policy for admins would let an operator edit `subject` and
-- `body` — the customer's own account of what went wrong, which is the one
-- thing in the row that must not change after the fact. RLS cannot restrict
-- columns and the install script re-grants every table privilege after the
-- migrations run, so column grants would not survive a fresh install either.
--
-- So the same shape as platform_workspace_stats() in 0010: no update policy at
-- all, and one definer function that writes exactly the three columns an answer
-- consists of. `where is_platform_admin()` is the entire access check.
create function answer_support_ticket(p_ticket_id uuid, p_answer text, p_status text)
returns void
language plpgsql
security definer
-- Pinned, as every definer function here is: resolved through the caller's
-- path this would write to whatever `support_tickets` they can reach.
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
         -- Stamped only by an answer arriving. Re-opening a ticket keeps the
         -- time the reply was written, because that is when it was written.
         answered_at = case when p_answer is null then answered_at else now() end
   where id = p_ticket_id;
end;
$$;

grant execute on function answer_support_ticket(uuid, text, text) to authenticated;
