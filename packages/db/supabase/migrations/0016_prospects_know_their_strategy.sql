-- Which strategy found this person.
--
-- A customer profile IS a strategy: one business runs fifteen or twenty of
-- them, each a different market, a different pain, a different angle. The
-- campaigns already carry `customer_profile_id`, so the strategy a campaign
-- belongs to was always recorded. The prospects were not, and that is the
-- missing edge: the Prospects screen was one undifferentiated list of every
-- person the workspace had ever found, with no way to ask "who did the agency
-- strategy turn up" or "is the chamber-leaders angle producing anybody".
--
-- WHY THIS IS A COLUMN AND NOT A JOIN TABLE
--
-- It is tempting to model this as many-to-many — a person could plausibly match
-- several strategies. They cannot, and the reason is the rule that matters most
-- in this product. `prospects` is unique on (workspace_id, linkedin_url), and
-- targeting excludes everyone the workspace already knows before it scores
-- anybody (`loadKnownUrls`). So the first strategy whose search reaches a person
-- is the only strategy that ever can: every later search sees them as already
-- known and skips them. Discovery is single-valued by construction, not by
-- simplification.
--
-- Modelling it as many-to-many would therefore be inventing a relationship the
-- system cannot produce — and worse, it would invite code that puts one person
-- on two strategies' lists, which is exactly the duplicate contact rule 24
-- exists to prevent. The column says what is true: one person, found once, by
-- one strategy.
--
-- WHAT THIS MAKES HONEST
--
-- `fit_score` is a single column, and a fit score is only meaningful against
-- the customer profile it was scored for. "87" on its own is not a fact about a
-- person, it is a fact about a person *and a strategy* — and until now the
-- screen showed the number without the half that gives it meaning. With this
-- column the score can finally be labelled with what it was scored against,
-- which is the difference between a ranking somebody can act on and a number
-- they have to take on trust.

alter table prospects
  -- Null is a real state and not a gap to be backfilled away: a prospect
  -- imported by hand, or one whose strategy was deleted, genuinely has no
  -- strategy. `on delete set null` rather than cascade, because deleting a
  -- strategy must never delete the people it found — they are the record of who
  -- has been contacted, and rule 24 depends on them outliving everything else.
  add column customer_profile_id uuid references customer_profiles (id) on delete set null;

-- The screens filter by strategy constantly and the list is the whole page.
create index prospects_strategy_idx on prospects (workspace_id, customer_profile_id);

-- Everyone found before this column existed. Their strategy is recoverable
-- because the campaign they were queued into records it, and a prospect
-- reaches a campaign only through the targeting run that found them.
--
-- `min(c.created_at)` picks the earliest campaign when somebody sits in more
-- than one: the earliest is the run that discovered them, and every later
-- campaign received them from a list that already existed.
update prospects p
set customer_profile_id = first_campaign.customer_profile_id
from (
  select distinct on (cp.prospect_id)
    cp.prospect_id,
    c.customer_profile_id
  from campaign_prospects cp
  join campaigns c on c.id = cp.campaign_id
  where c.customer_profile_id is not null
  order by cp.prospect_id, c.created_at asc
) as first_campaign
where p.id = first_campaign.prospect_id
  and p.customer_profile_id is null;
