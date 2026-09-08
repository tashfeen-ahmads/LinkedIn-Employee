-- Billing state, kept on the workspace so the campaign scheduler can answer
-- "may this tenant send right now?" with one lookup.

create type subscription_status as enum ('active', 'trialing', 'past_due', 'canceled', 'unpaid');

alter table workspaces
  add column subscription_status subscription_status,
  add column seats int not null default 1,
  add column current_period_end timestamptz;

-- Stripe delivers the same event more than once, and delivery order is not
-- guaranteed. Recording every processed event id makes the handler idempotent,
-- and keeping the created timestamp lets a later event win over an earlier one.
create table billing_events (
  id text primary key,
  workspace_id uuid references workspaces (id) on delete cascade,
  type text not null,
  stripe_created_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now()
);
create index on billing_events (workspace_id, processed_at desc);

alter table billing_events enable row level security;
create policy billing_events_member_select on billing_events for select
  using (workspace_id in (select current_workspace_ids()));
