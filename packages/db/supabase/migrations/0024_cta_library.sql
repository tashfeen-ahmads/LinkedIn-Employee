-- A workspace keeps several calls to action, and a campaign picks one.
--
-- The goal arrived on the strategy and the campaign as three loose columns —
-- `cta_kind`, `cta_label`, `cta_url` — which works for a business with one
-- ask. Nobody has one ask. The same company runs a free-audit link, a
-- newsletter sign-up, a book-a-call and a product page, and under the old
-- shape each campaign retyped its destination: a URL changed in one place and
-- stayed wrong in four, with no screen able to say which campaigns pointed
-- where.
--
-- So a destination becomes a row somebody names once. `campaigns.cta_id` and
-- `customer_profiles.cta_id` point at it, and rule 29's `{{cta_link}}`
-- substitution reads through the pointer at send time — so correcting a typo
-- in a URL fixes every campaign using it, without rewriting a single message
-- or re-reviewing copy a human already approved.
create table ctas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- What a rep calls it in the picker: "Free teardown", not "link".
  name text not null,
  -- The same three goals as before. A CTA's kind decides which funnel stages
  -- a campaign using it can reach (rule 29), so it is not free text.
  kind text not null check (kind in ('meeting', 'link', 'reply')),
  -- The words that appear in the message: "grab a slot", "take a look".
  label text,
  -- The destination, for a link. Stored plainly and never rewritten to count
  -- clicks: a redirect through a domain of ours breaks the affiliate and
  -- tracking parameters on the Amazon and Shopify links people actually send.
  url text,
  -- Kept out of the picker without being deleted, because a campaign that
  -- already used it still has to be able to say what it pointed at.
  archived_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ctas_workspace_idx on ctas (workspace_id, archived_at, name);

-- `set null`, never cascade. Deleting a destination must not delete the
-- campaign that used it, or its record of who was contacted — rule 24 depends
-- on those rows outliving everything else. A campaign whose CTA is gone falls
-- back to the columns it already carries.
alter table campaigns add column cta_id uuid references ctas (id) on delete set null;
alter table customer_profiles add column cta_id uuid references ctas (id) on delete set null;

alter table ctas enable row level security;

create policy ctas_member_read on ctas
  for select to authenticated
  using (workspace_id in (select current_workspace_ids()));

create policy ctas_member_write on ctas
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));
