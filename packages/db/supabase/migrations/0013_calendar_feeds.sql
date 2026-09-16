-- Reading the rep's real calendar, without asking Google for anything.
--
-- The own calendar (0012) knows only what this product put in it, which makes
-- double-booking a question of whether the rep remembered to block something
-- out. Google and Outlook both publish a secret .ics address from their own
-- settings — no OAuth, no scopes, no brand verification, just an HTTP GET. It
-- closes most of that gap for the cost of a nightly fetch.

create table calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  -- Ciphertext. This address is a bearer credential: anyone holding it can read
  -- every event in the rep's calendar, including ones that have nothing to do
  -- with work. It is encrypted before insert like an OAuth token, never
  -- returned to the browser, and never logged.
  url_encrypted text not null,
  -- The host alone, in the clear, so the rep can tell which calendar this is
  -- without the app ever showing the secret back to them.
  url_host text not null,
  -- pending | ok | failing. A feed that has stopped working is the dangerous
  -- state: we carry on offering slots against a snapshot that is quietly going
  -- stale, so it has to be visible rather than inferred from a null timestamp.
  status text not null default 'pending',
  last_synced_at timestamptz,
  last_error text,
  event_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_feeds_one_per_rep unique (workspace_id, user_id)
);

-- The busy intervals the last successful fetch produced.
--
-- Stored expanded rather than re-parsed on demand: a booking page that fetched
-- and parsed a remote calendar on every render would be slow, would leak the
-- rep's availability timing to whoever hosts the feed, and would fail the
-- booking outright whenever that host had a bad minute.
create table calendar_feed_busy (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  feed_id uuid not null references calendar_feeds (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  constraint feed_busy_ends_after_start check (ends_at > starts_at)
);
create index on calendar_feed_busy (user_id, starts_at);
create index on calendar_feed_busy (feed_id);

do $$
declare t text;
begin
  foreach t in array array['calendar_feeds','calendar_feed_busy'] loop
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

-- The ciphertext column is readable by any member of the workspace under the
-- policy above, which is the same trade the integrations table already makes:
-- the key never leaves the worker, so a member reading the column gets a blob.
-- The web app must never select url_encrypted.
