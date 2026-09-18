-- The follow-ups belong to the angle, not only to the campaign.
--
-- Migration 0017 gave a campaign several angles and varied the connection note.
-- That tests half of an angle. A prospect accepts the invitation *because of*
-- the angle it was written from, and then the first message arrives in the
-- campaign's generic voice — so the acceptance is attributed to the angle and
-- the reply is not, and the two halves of the funnel are measuring different
-- things. An angle that stops at the connection request is not a worse test
-- than no test, but it is a misleading one, which is the same problem.
--
-- So a step may belong to a variant. `variant_id` null keeps its old meaning:
-- the campaign-wide step, used by every prospect who was assigned no angle —
-- which is every campaign built before angles existed, and every campaign whose
-- angles could not be stored.

alter table campaign_steps
  add column variant_id uuid references campaign_variants (id) on delete cascade;

-- `on delete cascade` here and `set null` on `campaign_prospects.variant_id`,
-- deliberately differently. A step is copy that belongs to an angle and has no
-- meaning without it; a prospect is a person, and deleting an angle must never
-- delete the people it was sent to.

-- The old unique (campaign_id, step_number) is now wrong: three angles each
-- have their own step 1. Uniqueness is per angle, with the campaign-wide steps
-- forming their own set.
alter table campaign_steps drop constraint if exists campaign_steps_campaign_id_step_number_key;

-- Two indexes rather than one, because null is not distinct from null in a
-- unique constraint: a single index over (campaign_id, variant_id, step_number)
-- would let a campaign hold two campaign-wide step 1s, which is exactly the
-- duplicate the old constraint existed to stop.
create unique index campaign_steps_variant_step
  on campaign_steps (campaign_id, variant_id, step_number)
  where variant_id is not null;

create unique index campaign_steps_campaign_step
  on campaign_steps (campaign_id, step_number)
  where variant_id is null;

create index campaign_steps_variant_idx on campaign_steps (variant_id);
