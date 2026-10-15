set search_path = le, extensions, public;
-- Which LinkedIn plan an account is on, and the invitation notes a free one
-- has left this month.
--
-- LinkedIn lets a free (Basic) account attach a personal note to only a few
-- invitations a month. Its own help pages currently disagree between three and
-- five. Every invitation this product sent carried a note, so a free account
-- spent its allowance on its first three invitations of the month and LinkedIn
-- refused the fourth with the same "temporary provider limit" it uses for a
-- real invitation throttle. Read as a throttle, the whole account was held for
-- six to seventy-two hours, probed, refused again, and held again: all three
-- accounts that sent in October stopped exactly after their third note.
--
-- A free account can still send invitations without a note. That is what it
-- now does once its notes are spent, and the refusal is told apart by asking
-- once more without the note.

-- A paid LinkedIn plan (Premium or Sales Navigator) has no monthly note limit.
-- Sales Navigator is still `has_sales_navigator`, which also decides the search.
alter table linkedin_accounts
  add column has_premium boolean not null default false;

-- What the provider itself reported, kept apart from what the rep told us, so
-- a screen can say when the two disagree. Null means nobody could tell.
alter table linkedin_accounts
  add column plan_detected text
    check (plan_detected in ('basic', 'premium', 'sales_navigator')),
  add column plan_checked_at timestamptz;

-- The rep's local month (YYYY-MM) in which LinkedIn refused a note. For the
-- rest of that month invitations go without one, whatever the count says: the
-- count is ours, the refusal is LinkedIn's, and LinkedIn's wins.
alter table linkedin_accounts
  add column notes_exhausted_month text;

-- Whether the invitation that went out carried a note. Null for invitations
-- sent before this was recorded; those are counted as having had one, because
-- until now every invitation did unless its note was empty.
alter table campaign_prospects
  add column invite_note_sent boolean;
