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

update workspaces
set plan = 'free', trial_ends_at = null
where plan = 'trial' and stripe_subscription_id is null;

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
