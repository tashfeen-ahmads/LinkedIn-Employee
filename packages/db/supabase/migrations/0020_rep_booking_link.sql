-- The rep's own scheduling link.
--
-- The product already owns a booking page (rule 18) and it works, but it is
-- not what most people want. A rep who has used Calendly for three years has
-- their availability, their buffers, their round-robin and their reminder
-- emails there, and asking them to keep a second calendar in this product so
-- that a LinkedIn reply can offer a time is asking them to maintain two.
--
-- Requiring Google Calendar instead is the thing that cannot be built: Google
-- will not grant calendar scopes to an app that has not been through brand
-- verification, which needs a verified domain and a review measured in weeks.
-- One pasted URL is a field, works on the day somebody signs up, and needs
-- nobody's approval.

alter table profiles
  -- Checked with `checkCtaUrl` before it is stored, because it is typed by a
  -- person and then sent to a stranger under their own name.
  add column booking_url text;

-- WHAT THIS COSTS, AND WHY IT IS STILL RIGHT
--
-- A booking made on Calendly happens on Calendly. This product never learns
-- about it: there is no webhook we are entitled to, and polling somebody
-- else's scheduling page is not a thing. So a campaign whose meetings are
-- booked through a rep's own link cannot report those meetings automatically,
-- and the screens say so rather than showing a zero that reads as failure —
-- the same honesty `CLICKS_ARE_INVISIBLE` states for a link campaign.
--
-- The alternative — refusing external links so the funnel stays complete — is
-- optimising the dashboard at the cost of the product. A rep who cannot send
-- the link they actually use does not book fewer meetings through this
-- product; they stop using this product.
