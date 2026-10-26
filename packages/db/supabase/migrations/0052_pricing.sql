-- Pricing (rule 67).
--
-- Everybody who signed up while the product was free keeps it: their
-- workspaces move to the `free` plan, which no trial clock and no plan check
-- ever touches. Everybody who signs up from now on starts a fourteen-day trial
-- of Autopilot with no card, and chooses Pro or Autopilot by day fifteen.

alter table workspaces
  add column if not exists billing_interval text,
  add column if not exists cancel_at_period_end boolean not null default false,
  -- When the newest Stripe event applied to this row was created, so an older
  -- event arriving late never overwrites a newer one.
  add column if not exists last_billing_event_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspaces_billing_interval_check') then
    alter table workspaces
      add constraint workspaces_billing_interval_check check (billing_interval is null or billing_interval in ('month', 'year'));
  end if;
end $$;

-- Bounded by date so a re-run of this file (schema-install re-emits every
-- migration) can never turn a trial that started after pricing into free.
update workspaces
set plan = 'free', trial_ends_at = null
where plan = 'trial' and stripe_subscription_id is null
  and created_at < '2026-10-26T18:00:00Z';

create or replace function create_workspace(
  p_name text,
  p_slug text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  -- Definer rights with no caller is an anonymous workspace nobody owns.
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'workspace name is required' using errcode = '22023';
  end if;

  insert into workspaces (name, slug, plan, trial_ends_at)
  values (btrim(p_name), p_slug, 'trial', now() + interval '14 days')
  returning id into v_id;

  -- A membership references profiles, and a profile is created by a trigger on
  -- `auth.users` — which fires on INSERT, so it only ever ran for accounts
  -- created after this schema was installed. This deployment shares its
  -- Supabase project with another product, so its users already existed: they
  -- sign in rather than sign up, no trigger fires, and the membership below
  -- fails its foreign key with nothing explaining why.
  --
  -- Provisioning it here covers every such user and costs nothing for the ones
  -- the trigger already handled.
  insert into profiles (id, email, full_name)
  select v_user, u.email, coalesce(nullif(btrim(p_full_name), ''), u.raw_user_meta_data ->> 'full_name')
  from auth.users u
  where u.id = v_user
  on conflict (id) do nothing;

  -- Same statement block as the insert above: either both land or neither
  -- does, so the orphan case cannot happen.
  insert into memberships (workspace_id, user_id, role)
  values (v_id, v_user, 'owner');

  -- Collected on the same form. Optional, and never overwrites with blank.
  if coalesce(btrim(p_full_name), '') <> '' then
    update profiles set full_name = btrim(p_full_name) where id = v_user;
  end if;

  return v_id;
end;
$$;

-- The time a prospect accepted, kept on the conversation while a person
-- confirms it. On Pro every booking is confirmed by hand (rule 67), and "Mark
-- booked" only moved a status: no meetings row, so the half hour stayed free,
-- the next prospect could be offered and booked into it, and two people
-- turned up to one call (rule 18). Confirming now writes the meeting with the
-- time it was held for, through `meetings_one_per_rep_slot` like every other
-- booking, and is refused when somebody else has it.
alter table conversations
  add column if not exists held_slot_starts_at timestamptz,
  add column if not exists held_slot_ends_at timestamptz,
  add column if not exists held_slot_rep_user_id uuid references profiles (id) on delete set null;

-- The billing columns are written by the billing service and nothing else.
--
-- `workspaces_update` lets an owner or admin update their own row, and RLS
-- cannot restrict columns, so without this an owner could set `plan` to
-- 'autopilot' or push `trial_ends_at` out a year from the browser console.
-- The worker writes these with the service role (Stripe's webhook, checkout),
-- and a migration or the SQL console runs with no JWT at all; both pass.
-- Every other caller is refused, rather than silently ignored, so a screen
-- that tried would say so instead of showing a change that never happened.
--
-- An UPDATE trigger only: `create_workspace` INSERTs the trial row under the
-- caller's JWT and is untouched by it.
create or replace function workspaces_billing_columns_guard()
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
  if new.plan is distinct from old.plan
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.subscription_status is distinct from old.subscription_status
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.seats is distinct from old.seats
    or new.current_period_end is distinct from old.current_period_end
    or new.billing_interval is distinct from old.billing_interval
    or new.cancel_at_period_end is distinct from old.cancel_at_period_end
    or new.last_billing_event_at is distinct from old.last_billing_event_at
  then
    raise exception 'billing columns can only be changed by the billing service' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_billing_columns_guard on workspaces;
create trigger workspaces_billing_columns_guard
  before update on workspaces
  for each row execute function workspaces_billing_columns_guard();
