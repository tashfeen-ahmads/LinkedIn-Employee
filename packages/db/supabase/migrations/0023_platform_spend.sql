-- Model spend per workspace, summed in the database.
--
-- The operator console read every row of `llm_calls` and added them up in the
-- browser tier. PostgREST answers at most a thousand rows and says so nowhere,
-- and `llm_calls` gains a row per agent call — one campaign build is dozens —
-- so it is the fastest-growing table on the platform and the first to cross
-- that line. The number it produced was a bill that had quietly stopped
-- counting, on the screen an operator uses to decide what a customer costs.
--
-- Summing a stored column is not a second definition of anything: `cost_usd` is
-- computed once at write time from packages/shared/src/pricing.ts, and a model
-- missing from that table stores null rather than zero. `sum` skips nulls, so
-- "not priced" stays out of the total rather than being counted as free — and
-- `priced_calls` against `calls` is what says how much of the total is real.
create or replace function platform_workspace_spend()
returns table (
  workspace_id uuid,
  spend_usd numeric,
  calls bigint,
  priced_calls bigint
)
language sql
stable
security definer
-- Pinned, as every definer function here is.
set search_path = public
as $$
  select
    l.workspace_id,
    coalesce(sum(l.cost_usd), 0),
    count(*),
    count(l.cost_usd)
  from llm_calls l
  -- The entire access check, exactly as platform_workspace_stats(). One line
  -- away from this function handing every workspace's spend to anybody.
  where is_platform_admin() and l.workspace_id is not null
  group by l.workspace_id;
$$;

revoke execute on function platform_workspace_spend() from public, anon;
grant execute on function platform_workspace_spend() to authenticated;
