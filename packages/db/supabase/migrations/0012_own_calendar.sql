-- A calendar this product owns, because the alternative was a blocker nobody
-- could clear.
--
-- Booking meetings needed Google Calendar, and Google will not grant the
-- calendar scopes to an unverified app. Verification needs a verified domain
-- and a review that takes weeks — so on a test deployment the last stage of the
-- product, the one the whole thing exists for, could not be demonstrated at
-- all. A rep declaring their own hours needs no OAuth, no scopes and nobody's
-- approval.
--
-- What it gives up is the one thing an external calendar is for: it cannot see
-- a meeting the rep booked somewhere else. So `availability_blackouts` is not a
-- nicety, it is the whole defence against double-booking, and the app has to
-- make it easy to keep honest.

-- ---------------------------------------------------------------- availability

create table availability (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- One rep, one set of hours. The times offered to a prospect must be the
  -- hours of the person who will actually be in the meeting.
  user_id uuid not null references profiles (id) on delete cascade,
  timezone text not null default 'UTC',
  -- {start, end, days} — the same shape linkedin_accounts already uses for
  -- sending hours, and deliberately a separate setting: when someone is willing
  -- to send invitations and when they are willing to take a call are different
  -- questions, and conflating them books calls at 8am because that is when
  -- their outreach goes out.
  working_hours jsonb not null default '{"start": 9, "end": 17, "days": [1,2,3,4,5]}'::jsonb,
  meeting_minutes int not null default 30,
  -- Nothing is offered sooner than this. A slot two hours out is a slot the
  -- prospect books and the rep does not see in time.
  min_notice_hours int not null default 12,
  -- Clear either side of an existing meeting, so a day does not become a wall
  -- of back-to-back calls.
  buffer_minutes int not null default 15,
  max_per_day int not null default 3,
  -- What the prospect is told they are joining: a video link the rep pastes in,
  -- a phone number, an address. Free text because we are not hosting video.
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_one_per_rep unique (workspace_id, user_id),
  constraint availability_sane_meeting check (meeting_minutes between 10 and 240),
  constraint availability_sane_notice check (min_notice_hours between 0 and 336),
  constraint availability_sane_buffer check (buffer_minutes between 0 and 120),
  constraint availability_sane_per_day check (max_per_day between 1 and 20)
);

-- Time the rep is not available, whatever their hours say. Holiday, a meeting
-- booked elsewhere, a school run. Without an external calendar to read, this is
-- the only thing standing between a prospect and a double booking.
create table availability_blackouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint blackout_ends_after_start check (ends_at > starts_at)
);
create index on availability_blackouts (user_id, starts_at);

-- ---------------------------------------------------------------- booking links

-- One link, one prospect, one conversation.
--
-- A public "book time with me" page would let anyone fill a rep's week, and
-- would arrive at a booking with no idea who booked it. The Reply Agent sends
-- a link that already knows which conversation it belongs to, so a booking
-- lands against the right prospect without asking them to identify themselves.
create table booking_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  rep_user_id uuid not null references profiles (id) on delete cascade,
  prospect_id uuid not null references prospects (id) on delete cascade,
  conversation_id uuid references conversations (id) on delete set null,
  -- Long, random, and the entire authorisation for the page it opens. Generated
  -- application-side with a CSPRNG.
  token text not null unique,
  expires_at timestamptz not null,
  meeting_id uuid references meetings (id) on delete set null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on booking_links (workspace_id, prospect_id);

-- ---------------------------------------------------------------- meetings

alter table meetings
  -- Who booked it, in their own words, when they booked it themselves. The
  -- prospect row has a name from LinkedIn; this is the name and address they
  -- chose to give for a calendar invitation, which is often a different one.
  add column attendee_name text,
  add column attendee_email text,
  -- 'agent' when a reply accepted one of the times we offered, 'link' when the
  -- prospect picked from the booking page, 'manual' when a rep entered it.
  add column booked_via text not null default 'agent',
  add column cancelled_at timestamptz,
  add column cancel_reason text;

-- The guard that makes an own calendar safe to offer.
--
-- Two prospects can open the same slot seconds apart, and both requests read
-- the same free list before either writes. Checking availability in the
-- application and then inserting is precisely the read-then-write race that
-- puts two people in one half hour — and unlike a rate limiter, the person who
-- loses finds out by turning up. The database refuses the second write.
create unique index meetings_one_per_rep_slot
  on meetings (rep_user_id, starts_at)
  where cancelled_at is null and status <> 'cancelled';

-- ---------------------------------------------------------------- rls

do $$
declare t text;
begin
  foreach t in array array['availability','availability_blackouts','booking_links'] loop
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

-- Deliberately no policy granting a prospect anything. The booking page is not
-- signed in and does not read this schema directly: it hands its token to the
-- worker, which uses the service role and checks the token itself. A public
-- read policy on booking_links would let anyone holding one token enumerate
-- every prospect a workspace is talking to.
