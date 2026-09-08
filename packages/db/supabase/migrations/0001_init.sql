-- LinkedIn Employee: core schema.
-- Every tenant-scoped table carries workspace_id and is protected by RLS.
-- The worker uses the service role and therefore MUST filter by workspace_id itself.

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------- enums

create type membership_role as enum ('owner', 'admin', 'manager', 'rep');
create type linkedin_account_status as enum ('connecting', 'active', 'paused', 'warning', 'restricted', 'reauth_required', 'disconnected');
create type campaign_status as enum ('draft', 'running', 'paused', 'completed', 'archived');
create type campaign_prospect_status as enum (
  'queued', 'invited', 'accepted', 'messaged_1', 'messaged_2', 'messaged_3',
  'replied', 'positive', 'negative', 'meeting_booked', 'closed', 'opted_out', 'failed'
);
create type message_direction as enum ('outbound', 'inbound');
create type message_source as enum ('human', 'agent');
create type reply_mode as enum ('approval', 'autopilot');
create type integration_kind as enum ('hubspot', 'salesforce', 'google_calendar', 'microsoft_calendar', 'slack', 'webhook');

-- ---------------------------------------------------------------- tenancy

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'trial',
  trial_ends_at timestamptz,
  data_retention_days int not null default 365,
  created_at timestamptz not null default now()
);

-- Mirrors auth.users. Row is created by a trigger on signup.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext not null,
  full_name text,
  avatar_url text,
  bio text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role membership_role not null default 'rep',
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index on memberships (user_id);

-- ---------------------------------------------------------------- linkedin accounts

create table linkedin_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  provider text not null default 'unipile',
  provider_account_id text,
  linkedin_member_id text,
  display_name text,
  profile_url text,
  has_sales_navigator boolean not null default false,
  status linkedin_account_status not null default 'connecting',
  status_detail text,
  -- Warm-up: day 0 is connected_at; daily invite cap ramps from start to max.
  connected_at timestamptz,
  paused_at timestamptz,
  invites_today int not null default 0,
  invites_this_week int not null default 0,
  messages_today int not null default 0,
  counters_reset_on date,
  last_action_at timestamptz,
  working_hours jsonb not null default '{"start":8,"end":18,"days":[1,2,3,4,5]}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index on linkedin_accounts (workspace_id, status);

-- ---------------------------------------------------------------- strategy agent output

create table business_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  website_url text,
  linkedin_company_url text,
  spec jsonb not null,
  approved_at timestamptz,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on business_profiles (workspace_id);

create table customer_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  business_profile_id uuid not null references business_profiles (id) on delete cascade,
  name text not null,
  spec jsonb not null,
  priority int not null default 3,
  do_not_pursue boolean not null default false,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on customer_profiles (workspace_id, do_not_pursue);

-- ---------------------------------------------------------------- prospects

create table prospects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  linkedin_url text not null,
  provider_id text,
  first_name text,
  last_name text,
  headline text,
  title text,
  company text,
  company_size text,
  industry text,
  location text,
  about text,
  fit_score int,
  fit_reasons jsonb not null default '[]'::jsonb,
  intent_score int,
  signals jsonb not null default '[]'::jsonb,
  -- Team-wide dedupe: who owns this prospect and when they were last touched.
  owner_user_id uuid references profiles (id),
  last_contacted_at timestamptz,
  do_not_contact boolean not null default false,
  do_not_contact_reason text,
  crm_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One row per person per workspace. This is what prevents two reps from
  -- messaging the same prospect (docs/02-product-spec.md section 4).
  unique (workspace_id, linkedin_url)
);
create index on prospects (workspace_id, do_not_contact);
create index on prospects (workspace_id, last_contacted_at);

-- ---------------------------------------------------------------- campaigns

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  customer_profile_id uuid references customer_profiles (id) on delete set null,
  linkedin_account_id uuid not null references linkedin_accounts (id) on delete cascade,
  owner_user_id uuid not null references profiles (id),
  name text not null,
  status campaign_status not null default 'draft',
  connection_note text not null,
  daily_invite_cap int not null default 20,
  reply_mode reply_mode not null default 'approval',
  rules jsonb not null default '{}'::jsonb,
  stop_conditions jsonb not null default '[]'::jsonb,
  launched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on campaigns (workspace_id, status);

create table campaign_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  campaign_id uuid not null references campaigns (id) on delete cascade,
  step_number int not null,
  delay_days int not null,
  message text not null,
  unique (campaign_id, step_number)
);

create table campaign_prospects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  campaign_id uuid not null references campaigns (id) on delete cascade,
  prospect_id uuid not null references prospects (id) on delete cascade,
  status campaign_prospect_status not null default 'queued',
  status_reason text,
  invitation_id text,
  invited_at timestamptz,
  accepted_at timestamptz,
  last_step_sent int not null default 0,
  next_action_at timestamptz,
  replied_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, prospect_id)
);
create index on campaign_prospects (workspace_id, status, next_action_at);
create index on campaign_prospects (campaign_id, status);

-- ---------------------------------------------------------------- conversations

create table conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  prospect_id uuid not null references prospects (id) on delete cascade,
  linkedin_account_id uuid not null references linkedin_accounts (id) on delete cascade,
  campaign_id uuid references campaigns (id) on delete set null,
  provider_chat_id text,
  last_message_at timestamptz,
  needs_human boolean not null default false,
  needs_human_reason text,
  created_at timestamptz not null default now(),
  unique (workspace_id, prospect_id, linkedin_account_id)
);
create index on conversations (workspace_id, needs_human);

create table messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  direction message_direction not null,
  source message_source not null default 'agent',
  body text not null,
  provider_message_id text,
  -- Populated for inbound messages by the Reply Agent classifier.
  classification jsonb,
  -- Populated for agent-authored outbound messages, so any sent message can be
  -- traced back to the exact prompt that produced it.
  prompt_version text,
  approved_by uuid references profiles (id),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on messages (conversation_id, created_at);
create unique index on messages (workspace_id, provider_message_id) where provider_message_id is not null;

-- Drafts awaiting human approval. One open draft per conversation.
create table reply_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  in_reply_to uuid references messages (id) on delete cascade,
  body text not null,
  proposes_meeting boolean not null default false,
  proposed_slots jsonb not null default '[]'::jsonb,
  unanswered_questions jsonb not null default '[]'::jsonb,
  prompt_version text not null,
  status text not null default 'pending',
  resolved_by uuid references profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index on reply_drafts (workspace_id, status);
create unique index on reply_drafts (conversation_id) where status = 'pending';

-- ---------------------------------------------------------------- meetings

create table meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  prospect_id uuid not null references prospects (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  rep_user_id uuid not null references profiles (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  calendar_event_id text,
  meeting_url text,
  brief jsonb,
  crm_event_id text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);
create index on meetings (workspace_id, starts_at);

-- ---------------------------------------------------------------- integrations, audit, knowledge

create table integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  kind integration_kind not null,
  user_id uuid references profiles (id) on delete cascade,
  external_account_id text,
  -- Ciphertext only. Encrypted application-side before insert; never a raw token.
  credentials_encrypted text,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, user_id)
);

create table knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  title text not null,
  content text not null,
  source text,
  created_at timestamptz not null default now()
);
create index on knowledge_documents (workspace_id);

create table events (
  id bigserial primary key,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  actor_user_id uuid references profiles (id),
  subject_type text,
  subject_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on events (workspace_id, created_at desc);
create index on events (workspace_id, name);

create table llm_calls (
  id bigserial primary key,
  workspace_id uuid references workspaces (id) on delete cascade,
  agent text not null,
  model text not null,
  prompt_version text,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  latency_ms int,
  cost_usd numeric(10, 6),
  subject_type text,
  subject_id uuid,
  error text,
  created_at timestamptz not null default now()
);
create index on llm_calls (workspace_id, created_at desc);

-- ---------------------------------------------------------------- helpers

create or replace function current_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from memberships where user_id = auth.uid();
$$;

create or replace function is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and workspace_id = ws and role in ('owner', 'admin', 'manager')
  );
$$;

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'business_profiles','customer_profiles','prospects','campaigns','campaign_prospects'
  ] loop
    execute format(
      'create trigger %I_touch before update on %I for each row execute function touch_updated_at()',
      t, t
    );
  end loop;
end $$;

-- Create a profile row whenever a user signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- ---------------------------------------------------------------- row level security

alter table workspaces enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;

create policy workspaces_select on workspaces for select
  using (id in (select current_workspace_ids()));
create policy workspaces_update on workspaces for update
  using (is_workspace_admin(id));

create policy profiles_select_self on profiles for select
  using (
    id = auth.uid()
    or id in (select user_id from memberships where workspace_id in (select current_workspace_ids()))
  );
create policy profiles_update_self on profiles for update using (id = auth.uid());

create policy memberships_select on memberships for select
  using (workspace_id in (select current_workspace_ids()));
create policy memberships_write on memberships for all
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

-- Every remaining tenant table gets the same read/write pair: members of the
-- workspace may read and write their own workspace's rows, nobody else can.
do $$
declare t text;
begin
  foreach t in array array[
    'linkedin_accounts','business_profiles','customer_profiles','prospects','campaigns',
    'campaign_steps','campaign_prospects','conversations','messages','reply_drafts',
    'meetings','integrations','knowledge_documents','events','llm_calls'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I_member_select on %I for select using (workspace_id in (select current_workspace_ids()))',
      t, t
    );
    execute format(
      'create policy %I_member_write on %I for all using (workspace_id in (select current_workspace_ids())) with check (workspace_id in (select current_workspace_ids()))',
      t, t
    );
  end loop;
end $$;
