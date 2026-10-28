-- The picture published with a post shows what the post says (rule 69).
--
-- 0060 drew the post's headline on a block of brand colour. A picture earns
-- its room in a feed when it shows the idea, so the writer now describes the
-- picture as structure drawn from the post: steps, two sides compared, one
-- number, a checklist, a chain of cause and effect, or the key line framed.
-- `graphic_headline` stays as the picture's title; the rest is kept here.

alter table linkedin_posts
  add column if not exists graphic_spec jsonb,
  -- What kind of post it is (a how-to, the week's industry news, a myth
  -- corrected), so a week of posts reads as a mix rather than one shape.
  add column if not exists format text;

-- Changing the picture clears the approval, exactly as changing the words
-- does (rule 40): an approval is a statement about what will appear.
--
-- `search_path` is pinned again: 0060 replaced the function without it, and
-- `create or replace` replaces the settings too, undoing 0039.
create or replace function clear_post_approval()
returns trigger
language plpgsql
set search_path = le, pg_temp
as $$
begin
  if old.status <> 'published' and (
    new.body is distinct from old.body
    or new.graphic_enabled is distinct from old.graphic_enabled
    or new.graphic_headline is distinct from old.graphic_headline
    or new.graphic_style is distinct from old.graphic_style
    or new.graphic_spec is distinct from old.graphic_spec
  ) then
    new.approved_at := null;
    new.approved_by := null;
    new.status := 'draft';
  end if;
  return new;
end;
$$;
