-- The angles a campaign is testing against each other.
--
-- WHAT A VARIANT IS, AND WHY IT IS NOT A MESSAGE
--
-- Every prospect already receives a note written from their own headline,
-- title, company and about text (`personalizeInvites`, rule 16). No two people
-- get the same words, so an A/B test of literal message text would be
-- comparing two sets of one-off sentences and measuring the writer's mood.
--
-- What a campaign can genuinely hold constant and vary is the *angle*: the pain
-- named, the reason for reaching out, the hook the writer is told to lean on.
-- That is the one input `personalizeInvites` takes and the one thing every note
-- in a group shares. So that is what a variant holds.

create table campaign_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  campaign_id uuid not null references campaigns (id) on delete cascade,
  -- Short, for a column header on the results table: "Referral overload".
  name text not null,
  -- What the writer leans on. This is the variable under test.
  angle text not null,
  -- The specific pain this angle names, when it names one. Separate from the
  -- angle because a business owner's pain is reusable across campaigns and the
  -- angle is not.
  pain_point text,
  -- The fallback this variant sends when the writer produced no note for
  -- somebody. Per variant rather than per campaign, because falling back to
  -- the campaign's generic line would quietly move that person into a third,
  -- unnamed angle and count them under this one.
  connection_note text not null,
  -- Retiring an angle stops it being assigned to anybody new. It is never
  -- deleted while it holds results: those results are the reason the test was
  -- run, and a comparison that loses its loser is not a comparison.
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campaign_id, name)
);
create index campaign_variants_campaign_idx on campaign_variants (campaign_id);

alter table campaign_prospects
  -- Which angle this person was written for, fixed at the moment the list was
  -- built and never reassigned afterwards. Reassignment would attribute an
  -- outcome to an angle that did not produce it, which is the one way a test
  -- can be worse than no test.
  --
  -- `on delete set null` rather than cascade: deleting a variant must not
  -- delete the people it was sent to. The note they actually received is
  -- already stored on this row, so the record of what was said survives the
  -- angle being retired.
  add column variant_id uuid references campaign_variants (id) on delete set null;

create index campaign_prospects_variant_idx on campaign_prospects (variant_id);

-- Row-level security, matching every other tenant table: the worker uses the
-- service role and filters by workspace itself; the browser gets these rows
-- only through a workspace it belongs to.
alter table campaign_variants enable row level security;

create policy campaign_variants_read on campaign_variants
  for select to authenticated
  using (workspace_id in (select current_workspace_ids()));

create policy campaign_variants_write on campaign_variants
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));
