-- One switch per LinkedIn activity (rule 68).
--
-- Liking and commenting shared `engage_posts`, so somebody happy for Nora to
-- like a post but not to write under it had to turn both off. Commenting is
-- the action LinkedIn's 2026 policy watches most closely, which makes it the
-- one people most want to switch separately. Publishing approved posts had no
-- switch at all. Each is now its own column, on by default as before;
-- `engage_posts` keeps meaning likes.

alter table workspaces
  add column if not exists engage_comments boolean not null default true,
  add column if not exists publish_posts boolean not null default true;

-- A workspace that turned "likes and comments" off meant both. Its new
-- comment switch starts where its old one was, never back on.
update workspaces set engage_comments = engage_posts where engage_posts = false;
