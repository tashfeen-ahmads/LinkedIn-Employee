-- Where a campaign's prospect search had got to, so it can be continued.
--
-- A campaign was one search: press the button, get about fifty people, and the
-- only way to reach anyone else was to press it again — which ran the identical
-- search, returned the identical fifty, and reported every one of them as
-- already known. Everybody past the first page was unreachable by design, and
-- the product's answer to "we need a thousand prospects" was that there was no
-- answer.
--
-- The position lives on the campaign rather than on the customer profile
-- because it describes a list somebody is building. Two campaigns aimed at the
-- same customer profile are two lists, launched on different days with
-- different copy, and they have no business sharing a page number.

alter table campaigns
  -- Opaque here on purpose. For Sales Navigator it is the provider's own
  -- cursor; for classic search it is the position of each of the several
  -- separate searches a single customer profile becomes. Nothing in the
  -- database or the browser reads it — it is stored and handed back.
  add column search_cursor text,
  -- Set when a search has run out of people entirely, which is a different
  -- thing from a run that found nobody new. Without it the screen has to
  -- choose between offering a button that can only disappoint and hiding one
  -- that would have worked.
  add column search_exhausted boolean not null default false,
  -- Every run's contribution, so "find more" can say what the last press
  -- actually did rather than leaving someone to count rows.
  add column searched_at timestamptz;
