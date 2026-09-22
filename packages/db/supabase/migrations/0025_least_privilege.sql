-- Least privilege for the two roles a browser can ever be.
--
-- `scripts/schema-install.mjs` grants `all on all tables` to anon,
-- authenticated and service_role, and the comment above it is right about why:
-- without a grant PostgREST answers 404 for the whole schema, which reads
-- exactly like a failed migration. But `all` is not what that needs. It handed
-- `anon` — an unauthenticated request carrying the publishable key that ships
-- in the browser bundle — INSERT, UPDATE, DELETE and TRUNCATE on all thirty
-- tables, including `platform_admins`, `messages` and `prospects`.
--
-- Nothing is exploitable today: every table has RLS, every policy resolves
-- through `current_workspace_ids()`, and that is empty for an anonymous
-- caller, so each of those writes is refused row by row. That is the whole
-- defence, and it is one forgotten `enable row level security` away from not
-- being there. The grant is the thing that makes a missed policy fatal instead
-- of merely wrong, and a schema this product will keep adding tables to should
-- not be one migration away from an open door.
--
-- So anon keeps SELECT and loses every write. SELECT stays because RLS already
-- refuses it and removing it changes the shape of the error rather than the
-- access — and because a read I have not found breaking is a worse outcome
-- than a read RLS was already denying.
--
-- Nothing in this product writes as anon. The one public page, `/book/[token]`,
-- posts to the worker, which holds the service role; the token in the URL is
-- its whole authorisation and never touches the browser's client.

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema le from anon;

-- The same, for tables that do not exist yet. Without this the next migration
-- to add a table silently restores what this one just took away.
alter default privileges in schema le
  revoke insert, update, delete, truncate, references, trigger on tables from anon;

-- ---------------------------------------------------------------- functions

-- The counters the rate limiter reads, incremented in one statement.
--
-- `security definer`, `search_path` pinned, and no authorisation check of any
-- kind — by design, because the only caller is the worker holding the service
-- role. But `grant all on all functions` made it callable by `anon` over
-- `/rest/v1/rpc/record_linkedin_action` with any account id, and what that buys
-- is not read access, it is the safety rules themselves: increment another
-- workspace's `invites_today` and their sending stops for the day; set
-- `first_action_at` and rule 3's warm-up ramp starts early, which hands a cold
-- account its full allowance and is precisely the account restriction this
-- product exists to prevent.
--
-- schema-install.mjs already revokes this. The live schema predates that line,
-- which is exactly why it belongs in a migration as well: an install script is
-- what a new deployment runs, not what an existing one has.
revoke execute on function le.record_linkedin_action(uuid, text)
  from public, anon, authenticated;

-- Trigger functions. Postgres runs these from the triggers that own them and
-- refuses them as ordinary calls, so this removes surface rather than a hole —
-- but a `security definer` function reachable at a public URL is not something
-- to leave lying around on the argument that the error message is good.
revoke execute on function le.handle_new_user() from public, anon, authenticated;
revoke execute on function le.touch_updated_at() from public, anon, authenticated;

-- `touch_updated_at` is the one function in this schema with a mutable
-- search_path. It is `security invoker`, so this is not the privilege
-- escalation the pinned ones guard against — but "the rule holds except for
-- the one that predates it" is how the rule stops being checkable.
alter function le.touch_updated_at() set search_path = le, pg_temp;

-- These five are called from the browser, by a signed-in user, and each has its
-- own check inside: `create_workspace` raises without an `auth.uid()`,
-- `answer_support_ticket` and the two platform readers turn entirely on
-- `is_platform_admin()`. Their checks are sound; being reachable without a
-- session is simply surface nobody asked for.
revoke execute on function le.create_workspace(text, text, text) from anon;
revoke execute on function le.platform_workspace_stats() from anon;
revoke execute on function le.platform_workspace_spend() from anon;

-- These two need `public`, not `anon`, and finding that out took a second pass.
-- Postgres grants EXECUTE to PUBLIC on every CREATE FUNCTION, PUBLIC includes
-- anon, and `has_function_privilege('anon', ...)` resolves through it — so
-- revoking from `anon` alone left both still callable without a session and
-- reported as still callable. Each carries its own `to authenticated` grant
-- (0010 and 0022), so the signed-in path is untouched.
revoke execute on function le.is_platform_admin() from public;
revoke execute on function le.answer_support_ticket(uuid, text, text) from public;

-- `current_workspace_ids()` and `is_workspace_admin()` deliberately keep
-- EXECUTE for both roles. Every RLS policy in this schema is `to public` and
-- resolves through them, and a policy expression runs with the caller's own
-- privileges — revoke these from anon and every table stops answering with a
-- permission error instead of an empty result, for logged-out and logged-in
-- callers alike. They also leak nothing: each reports on whoever is asking.

-- And for functions added later.
alter default privileges in schema le revoke execute on functions from anon;
