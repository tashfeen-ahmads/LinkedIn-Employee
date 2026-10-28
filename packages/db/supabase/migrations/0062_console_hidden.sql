-- A workspace the operator console leaves out of every list (rule 15).
--
-- The platform's own accounts (an owner's test workspace, a demo) sat in the
-- console beside paying customers, in every count, list and total. An owner
-- can now hide one from every admin, and show it again from Settings.
--
-- Only the service role writes it, which is the worker acting for a platform
-- owner. RLS lets a workspace's own owner update their row and cannot restrict
-- columns, so without the guard a customer could hide themselves from the
-- people who support them.

alter table workspaces
  add column if not exists console_hidden boolean not null default false;

create or replace function workspaces_console_hidden_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
begin
  if v_role is null or v_role = 'service_role' then
    return new;
  end if;
  if new.console_hidden is distinct from old.console_hidden then
    raise exception 'console visibility can only be changed by a platform owner' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_console_hidden_guard on workspaces;
create trigger workspaces_console_hidden_guard
  before update on workspaces
  for each row execute function workspaces_console_hidden_guard();
