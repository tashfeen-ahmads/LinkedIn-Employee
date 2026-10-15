-- A fit score is a whole number out of 100, and the table now says so.
--
-- The scorer is a model and its answer is cast rather than parsed, so the
-- bounds on its schema enforced nothing: a score on a ten-point scale, a 140
-- or a negative number reached `prospects.fit_score` as written. Every screen
-- prints that number beside "out of 100" and the queue cut-off compares
-- against it, so a 7 that meant "very good" read as a person nobody should
-- write to, and a 140 sorted above everybody. A fractional score was worse:
-- the column is an int, so PostgREST refused the whole batch insert and a page
-- of real people was lost over one decimal point.
--
-- The worker now clamps and rounds before it writes (`clampFitScore` in
-- packages/shared/src/fit-score.ts). This is the second half: rows already
-- stored are brought inside the range, and the range becomes a constraint so
-- a later writer that forgets cannot put one outside it again.
set search_path = le, extensions, public;

update prospects set fit_score = 100 where fit_score > 100;
update prospects set fit_score = 0 where fit_score < 0;

-- NOT VALID then VALIDATE: the check is enforced on new writes at once, and
-- the scan of existing rows takes a lighter lock than adding it validated.
alter table prospects
  add constraint prospects_fit_score_range check (fit_score between 0 and 100) not valid;
alter table prospects validate constraint prospects_fit_score_range;
