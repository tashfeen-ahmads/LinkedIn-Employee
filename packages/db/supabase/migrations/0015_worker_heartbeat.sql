-- Proof that the sending loop is running.
--
-- A campaign launched into a dead worker and a campaign waiting out the gap
-- between two invitations look identical from every screen this product has:
-- status "running", nobody invited, nothing on the page. The first live launch
-- was spent not knowing which one it was, and the answer was only reachable by
-- reading the deployment's logs — which is not a thing the person who pressed
-- Launch can do.
--
-- The loop is deliberately quiet: it wakes every five minutes and spaces
-- invitations two to eleven minutes apart, so a quarter of an hour of nothing
-- happening is the normal, correct behaviour. That is precisely why its
-- silence has to be distinguishable from its absence.

create table worker_heartbeats (
  -- One row per loop, upserted. A log would grow without bound to answer a
  -- question that only ever concerns the most recent run.
  name text primary key,
  beat_at timestamptz not null default now(),
  -- What that run did: how many campaigns it looked at, how many actions it
  -- enqueued. Enough to tell a loop that ran and declined from one that ran
  -- and worked.
  detail jsonb not null default '{}'::jsonb
);

-- Deployment-wide rather than tenanted: it holds no customer data, and every
-- member needs to be able to see whether the thing that sends their messages
-- is alive. Writing is the service role's, which is why there is no insert or
-- update policy here.
alter table worker_heartbeats enable row level security;

create policy worker_heartbeats_read on worker_heartbeats
  for select to authenticated using (true);
