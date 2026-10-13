-- Where a strategy's own search had got to, for the search that builds no
-- campaign.
--
-- 0014 put the position on the campaign, because a campaign is a list somebody
-- is building. But a first search can build no campaign at all — everybody on
-- the page was already known, or nobody cleared the fit bar — and then there
-- was nowhere to write the position. The next press of the same button re-read
-- (and re-paid for) the same first page, found the same people, and said the
-- same thing, for ever: a strategy that could never get past its first page
-- unless that page happened to produce a campaign.
--
-- One opaque jsonb rather than three columns, because nothing but the
-- targeting job reads it and it travels as a unit: the provider's cursor,
-- whether LinkedIn has run out, when it was read, and the search it belongs to
-- (`key` — the filters, the tier and the account). A position is only
-- meaningful for the search that produced it; once somebody edits the filters
-- the old cursor points into a different result set, so a key that no longer
-- matches is read as "start from the beginning".
alter table customer_profiles
  add column search_position jsonb;
