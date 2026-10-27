-- A graphic published with a post.
--
-- A post with an image takes several times the room in the feed that a post
-- of text does, and on this product it is the first thing a prospect sees when
-- they look the sender up. So a post carries one designed graphic: its own
-- headline, set in one of a few styles, approved together with the words.
--
-- Drawn rather than generated. A picture from an image model puts invented
-- text, a made-up logo or a stranger's face on a real professional's profile
-- under their own name, and it can only be generated on a deployment whose
-- model provider makes pictures at all. A designed card says exactly what the
-- rep approved and looks the same on every deployment.

alter table linkedin_posts
  add column if not exists graphic_enabled boolean not null default true,
  -- The line on the image. Short, so it is read at a glance on a phone.
  add column if not exists graphic_headline text,
  add column if not exists graphic_style text not null default 'brand';

alter table linkedin_posts drop constraint if exists linkedin_posts_graphic_style_check;
alter table linkedin_posts
  add constraint linkedin_posts_graphic_style_check check (graphic_style in ('brand', 'light', 'dark'));

-- The company's own colours, as hex codes, so every graphic is in its brand
-- rather than ours. Read from the website when Sage reads it, and editable on
-- Profile → Company. Null until either happens, and the graphic then uses a
-- plain neutral palette rather than guessing.
alter table workspaces
  add column if not exists brand_primary text,
  add column if not exists brand_accent text;

alter table workspaces drop constraint if exists workspaces_brand_primary_hex;
alter table workspaces add constraint workspaces_brand_primary_hex
  check (brand_primary is null or brand_primary ~ '^#[0-9A-Fa-f]{6}$');
alter table workspaces drop constraint if exists workspaces_brand_accent_hex;
alter table workspaces add constraint workspaces_brand_accent_hex
  check (brand_accent is null or brand_accent ~ '^#[0-9A-Fa-f]{6}$');

-- The image exactly as it was approved, kept beside the post rather than on
-- it so a list of posts never reads the picture. Written at the moment of
-- approval and read by the publish sweep: what goes out is the picture the
-- rep saw, not a fresh drawing by whatever code is deployed by then.
create table if not exists linkedin_post_graphics (
  post_id uuid primary key references linkedin_posts (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  png_base64 text not null,
  created_at timestamptz not null default now()
);

alter table linkedin_post_graphics enable row level security;

drop policy if exists linkedin_post_graphics_rw on linkedin_post_graphics;
create policy linkedin_post_graphics_rw on linkedin_post_graphics
  for all using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

-- An approval is a statement about what will appear, so changing the picture
-- clears it exactly as changing the words does (rule 40).
create or replace function clear_post_approval()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'published' and (
    new.body is distinct from old.body
    or new.graphic_enabled is distinct from old.graphic_enabled
    or new.graphic_headline is distinct from old.graphic_headline
    or new.graphic_style is distinct from old.graphic_style
  ) then
    new.approved_at := null;
    new.approved_by := null;
    new.status := 'draft';
  end if;
  return new;
end;
$$;
