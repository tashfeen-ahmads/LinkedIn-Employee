-- Posts published to a rep's own LinkedIn profile.
--
-- Everything else this product sends goes to one named person: an invitation,
-- a follow-up, a reply. A post is different in kind — it goes to everybody who
-- follows the rep, it stays on their profile, and it is the first thing a
-- prospect reads when they look the sender up after an invitation arrives.
--
-- So the rule is stricter than the reply gate's, not looser. The reply gate
-- has an autonomy setting (rule 41) because a prospect who asks "how much is
-- it?" on a Friday and is never answered is a lead lost. There is no
-- equivalent cost here: a post that waits until Monday for a person to read it
-- has lost nothing, and a post that goes out unread is on a real professional's
-- public profile under their own name, where the only remedy is deleting it
-- after people have seen it.
--
-- Nothing in this table reaches LinkedIn without `approved_at`, and the
-- trigger below clears that the moment the words change.
create table linkedin_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Whose profile it appears on. A post is published by one rep's account and
  -- carries their name, so this is not optional and not the workspace's.
  user_id uuid not null references profiles (id) on delete cascade,
  -- Which business it speaks for. A workspace running a cleaning company and
  -- an estate agency must not post one's copy from the other's voice
  -- (migration 0001 has always allowed several; `loadBusinessProfile` is how
  -- the code finally picks one deliberately).
  business_profile_id uuid references business_profiles (id) on delete set null,

  body text not null,
  -- What the agent leaned on, so "is this true" is checkable rather than a
  -- matter of opinion — the same reason `factsUsed` exists on a pitch
  -- (rule 40). An empty one is reported on the screen, never hidden.
  facts_used jsonb not null default '[]'::jsonb,

  status text not null default 'draft'
    check (status in ('draft', 'approved', 'published', 'failed')),
  approved_at timestamptz,
  approved_by uuid references profiles (id),

  -- When it should go out. Null means "when somebody approves it and the next
  -- sweep runs"; a time means hold until then.
  scheduled_for timestamptz,
  published_at timestamptz,
  provider_post_id text,
  -- The provider's own words when it refuses, kept verbatim. "422: ..." is the
  -- single most useful sentence in a failure and it used to go to a log on a
  -- host the person who pressed the button cannot reach (rule 25).
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on linkedin_posts (workspace_id, status);
-- The publish sweep's query: approved, due, not yet sent.
create index on linkedin_posts (status, scheduled_for) where status = 'approved';

-- Editing the words clears the approval.
--
-- In a trigger rather than in whichever action happened to save them, for the
-- reason rule 40 gives for pitches: an approval is a statement about
-- particular text, and without this one approval in September authorises every
-- rewrite after it. A published post is left alone — its body is a record of
-- what went out, not a draft, and rewriting history here would make the table
-- disagree with LinkedIn.
create or replace function clear_post_approval()
returns trigger
language plpgsql
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

create trigger linkedin_posts_clear_approval
before update on linkedin_posts
for each row execute function clear_post_approval();

create trigger linkedin_posts_touch before update on linkedin_posts
  for each row execute function touch_updated_at();

alter table linkedin_posts enable row level security;

create policy linkedin_posts_rw on linkedin_posts
  for all using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));
