-- The email this product sends to its own users, written down.
--
-- Until now the record of "did we already send this" was an `events` row keyed
-- by workspace — one per onboarding nudge, one for the welcome. That works for
-- a handful of emails and stops working the moment an email is about a person
-- rather than a workspace: the signup welcome arrives before a workspace
-- exists, an announcement goes to every user, and an invited rep's onboarding
-- is not their owner's.
--
-- So one table, keyed by (user, step). The unique index is the whole of the
-- never-twice guarantee: the worker inserts the row *before* it sends, so two
-- runs racing for the same step cannot both win, and a step somebody has
-- already had is a conflict rather than a second email. A send that fails
-- deletes its claim so the next run may try again inside the step's window.
create table email_sends (
  id uuid primary key default gen_random_uuid(),
  -- Whom the email is *about*. For a user's own emails that is also who it was
  -- sent to; for an operator notification it is the person who signed up.
  user_id uuid not null references profiles (id) on delete cascade,
  -- `welcome`, `onboarding.connect_linkedin`, `admin.signup`,
  -- `announcement.<uuid>` — the unit that must never repeat.
  step text not null,
  -- transactional | lifecycle | announcement | admin. Lifecycle and
  -- announcement mail is marketing and honours the opt-out; the other two are
  -- not and do not.
  kind text not null check (kind in ('transactional', 'lifecycle', 'announcement', 'admin')),
  -- Who actually received it. For an admin notification, a comma list.
  recipient text not null,
  -- claimed → sent. A claim older than a few minutes with no send is a run
  -- that died between the two, and is visible as exactly that.
  status text not null default 'claimed' check (status in ('claimed', 'sent')),
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint email_sends_once unique (user_id, step)
);
create index email_sends_step_idx on email_sends (step, created_at desc);

alter table email_sends enable row level security;

-- No member policy at all: a user has no business reading the operator's
-- notifications about them, and nothing in the app needs this table from the
-- browser. The worker writes it with the service role; an operator reads it.
create policy email_sends_platform_select on email_sends
  for select to authenticated
  using (is_platform_admin());

-- The marketing opt-out. One column rather than per-kind preferences, because
-- what somebody means when they click "unsubscribe" is "stop", and a page of
-- checkboxes in response is a second chore. Transactional mail — the welcome,
-- an invitation, a paused account — is not affected: those are the product
-- telling somebody something they need in order to use it.
alter table profiles add column if not exists marketing_opt_out_at timestamptz;

comment on column profiles.marketing_opt_out_at is
  'Set by the one-click unsubscribe link. While set, no lifecycle or announcement email is sent; transactional email is unaffected.';

-- Product updates an operator writes in the console and sends to everyone.
--
-- `send_requested_at` is the double-send guard at the level of the button: the
-- worker sets it with `where send_requested_at is null`, so a second press, a
-- second tab or a retried request finds it taken and sends nothing. The
-- per-recipient rows in `email_sends` are the guard underneath that one — a
-- send that dies half way resumes with the people it has not reached yet, and
-- never reaches anybody twice.
create table announcements (
  id uuid primary key default gen_random_uuid(),
  subject text not null check (char_length(subject) between 1 and 200),
  -- Plain text: blank lines separate paragraphs. Escaped on render, never
  -- interpreted as HTML — this is the one email a person types by hand.
  body text not null check (char_length(body) between 1 and 10000),
  cta_label text check (cta_label is null or char_length(cta_label) between 1 and 60),
  cta_url text check (cta_url is null or cta_url ~ '^https://'),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  send_requested_at timestamptz,
  send_requested_by uuid references profiles (id) on delete set null,
  sent_at timestamptz,
  recipients integer
);
create index announcements_created_idx on announcements (created_at desc);

alter table announcements enable row level security;

-- Read in the console. Every write goes through the worker, which checks the
-- caller is a platform admin and refuses to edit one that has been sent.
create policy announcements_platform_select on announcements
  for select to authenticated
  using (is_platform_admin());
