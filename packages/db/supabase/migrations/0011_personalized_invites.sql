-- The connection note each prospect actually receives.
--
-- A campaign carries one `connection_note` with `{{first_name}}` in it, and
-- that was the only thing anyone got: every person in a campaign received
-- identical words. Their headline, title, company and about text were searched
-- for, scored against the customer profile, written to `prospects`, shown on
-- the prospects screen — and then dropped at the one moment they would have
-- mattered, because `renderTemplate` substitutes a first name and nothing else.
--
-- The note belongs on the join rather than on the prospect: the same person can
-- be in two campaigns with two different reasons for being written to, and the
-- note is about the reason, not the person.

alter table campaign_prospects
  add column invite_note text,
  -- Convention, and the reason it exists: every sent message records the prompt
  -- that produced it, so a regression traces back to the change that caused it.
  add column invite_note_prompt_version text,
  -- Which of the prospect's own details the note leaned on, quoted from what
  -- the model was given. This is what makes "personalised" checkable rather
  -- than a matter of opinion — an empty grounding means the note could have
  -- gone to anybody, and the campaign screen says so.
  add column invite_note_grounding jsonb not null default '[]'::jsonb,
  -- Set by the model when a prospect's details were too thin to say anything
  -- specific. Honest thinness beats invented familiarity.
  add column invite_note_thin boolean not null default false,
  -- A human edited it. Once true the agent must not overwrite it: a rep who
  -- rewrote a note and watched it revert would never trust the screen again.
  add column invite_note_edited boolean not null default false;

-- Read constantly while a campaign is being reviewed, and the review screen is
-- the one place a rep reads every row rather than a page of them.
create index campaign_prospects_campaign_idx on campaign_prospects (campaign_id);
