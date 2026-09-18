-- What the campaign is asking for.
--
-- "Book a meeting" was the only goal this product had, and it was wired in
-- everywhere: the copy asked for a call, the Reply Agent proposed times, and
-- the funnel's last stage counted bookings. Most outreach is not asking for a
-- meeting. Somebody wants sign-ups, somebody wants their product looked at,
-- somebody wants a collaboration, somebody wants a reply and nothing more.
--
-- This is a goal and not a link field. Bolting a URL onto a meeting-shaped
-- campaign would leave the copy asking for a call, the Reply Agent offering
-- times nobody wants, and the dashboard reporting zero meetings for a campaign
-- that did exactly what was asked of it.

create type cta_kind as enum ('meeting', 'link', 'reply');

alter table campaigns
  -- 'meeting' by default, which is every campaign that already exists. Their
  -- behaviour is unchanged by this migration.
  add column cta_kind cta_kind not null default 'meeting',
  -- What the button would say, if this were a page: "Try it free", "See the
  -- comparison". Used in the copy so the ask is concrete rather than "have a
  -- look".
  add column cta_label text,
  -- The destination, for a link campaign. Checked for shape before it is
  -- stored (`checkCtaUrl`), because it is typed by a user and then sent to a
  -- stranger under a real rep's name.
  --
  -- Stored plainly and never rewritten. Measuring clicks would mean wrapping
  -- it in a redirect we own, which breaks the affiliate and tracking
  -- parameters on the Amazon and Shopify links people actually send, and puts
  -- an unfamiliar domain in a LinkedIn message — spam to the recipient and to
  -- LinkedIn's own heuristics, on an account this product exists to protect.
  add column cta_url text;

-- The CTA belongs to the campaign and not to its variants, deliberately.
--
-- A variant tests the ANGLE: the pain named, the reason for reaching out. If
-- variants also differed in what they asked for, a campaign would be varying
-- two things at once and could attribute the result to neither. Somebody who
-- wants to test "a meeting" against "a link" runs two campaigns, where the
-- comparison is between two things that each hold everything else still.

-- A link campaign with no destination sends a message with a hole in it. The
-- database is the one place this cannot be forgotten.
alter table campaigns
  add constraint campaigns_link_needs_url
  check (cta_kind <> 'link' or (cta_url is not null and length(trim(cta_url)) > 0));

-- The strategy carries the default, and the campaign inherits it.
--
-- The CTA has to be known BEFORE the copy is written. A sequence written toward
-- a call and then switched to a link is a sequence whose first two messages
-- were building to something else — the ask changes and the argument leading to
-- it does not. So the goal is set once on the strategy, where a rep decides
-- what that market is for, and every campaign built from it starts with the
-- right ask rather than being corrected afterwards.
alter table customer_profiles
  add column cta_kind cta_kind not null default 'meeting',
  add column cta_label text,
  add column cta_url text;

alter table customer_profiles
  add constraint customer_profiles_link_needs_url
  check (cta_kind <> 'link' or (cta_url is not null and length(trim(cta_url)) > 0));
