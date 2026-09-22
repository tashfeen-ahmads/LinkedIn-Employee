-- A pitch is a line, and a campaign tests several of them.
--
-- 0026 stored one pitch per workspace, as a paragraph. Both were wrong, and
-- for the same reason rule 28 gives about connection notes: the thing a
-- campaign can hold constant and vary is the *angle*, and an angle that owns
-- the opener but not the offer is an angle that changes voice halfway through
-- the conversation. A prospect accepts because of one pain being named and
-- then hears a pitch arguing something else.
--
-- And a pitch is spoken into a chat window, not read on a landing page. Ninety
-- characters is what somebody takes in on a phone, two seconds after asking
-- "what is this?". A paragraph there is skimmed and then ignored, which looks
-- identical to a paragraph that was never read.

-- One workspace now keeps several. Named, approved one at a time, and pointed
-- at — the shape rule 36 gives destinations, for the same reason: a line
-- retyped into each campaign has four versions of itself inside a month and no
-- screen able to say which prospect heard which.
alter table pitches drop constraint pitches_workspace_id_key;

alter table pitches
  -- What a rep calls it in a picker: "Referral leakage", not "pitch 3".
  add column name text not null default 'Pitch',
  -- What somebody with no angle hears. Not a leftover: campaign-wide steps
  -- (`variant_id` null) are already the whole sequence for anybody assigned no
  -- angle, and this is the same rule applied to the offer.
  add column is_default boolean not null default false,
  -- Which bet this line is placing, written to the rep and not to the prospect.
  -- The agent already explains this; storing it is what stops the set reading
  -- as one sentence written five ways, and stops somebody approving two lines
  -- that turn out to be the same bet.
  add column angle text;

-- Exactly one default per workspace. A second would make "which pitch does an
-- unassigned prospect get" a question answered by row order, which is to say
-- answered differently on different days.
create unique index pitches_one_default
  on pitches (workspace_id)
  where is_default;

create index pitches_workspace_idx on pitches (workspace_id, approved_at);

alter table campaign_variants
  -- This angle's offer. `set null`, never cascade: retiring a pitch must not
  -- delete the angle that used it, because the angle still holds the results
  -- that were the reason for running the test.
  add column pitch_id uuid references pitches (id) on delete set null,
  -- The opening line this angle leans on.
  --
  -- The Strategy Agent has written three of these per strategy since the first
  -- week — `spec.hooks`, rendered on /app/strategy under "Opening angles" —
  -- and nothing has ever consumed one. They were written, stored, approved by
  -- a person, displayed, and then dropped at the single moment they mattered,
  -- which is exactly what rule 16 says happened to the prospect research
  -- before `personalizeInvites` existed.
  add column hook text;
