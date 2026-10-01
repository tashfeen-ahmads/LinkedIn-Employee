-- The approval-clearing trigger resolves its names the way its siblings do.
--
-- `clear_post_approval` is the third of three triggers doing one job: editing
-- the words clears the approval, so an approval is a statement about
-- particular text rather than a standing permission (rule 40).
-- `pitch_edit_needs_reapproval` and `hook_edit_needs_reapproval` are the other
-- two, and both pin `search_path = le, pg_temp`. The newest one was written
-- without it, which is the whole of this change.
--
-- It is the mildest form of the problem — the function is SECURITY INVOKER and
-- touches only NEW and OLD, so there is no name for a caller's search_path to
-- capture today. But that is a fact about the body, not about the function, and
-- it stops being true the first time somebody adds a lookup to it. The setting
-- costs nothing, the inconsistency is what a reader has to stop and work out,
-- and it was the only function on the deployment the linter still named.
--
-- `create or replace` keeps the trigger that calls it: the trigger binds to the
-- function by oid, which replacing does not change.
create or replace function le.clear_post_approval()
returns trigger
language plpgsql
set search_path = le, pg_temp
as $$
begin
  if new.body is distinct from old.body and old.status <> 'published' then
    new.approved_at := null;
    new.approved_by := null;
    new.status := 'draft';
  end if;
  return new;
end;
$$;
