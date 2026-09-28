-- Who somebody is, collected at signup rather than asked for later.
--
-- The product had magic-link and Google sign-in, which are real authentication
-- and gave a real session — but they produce an account that knows an email
-- address and nothing else. Everything a person is then had to be asked for
-- again on a settings page they had to find, which is the disease the profile
-- rebuild was already about: a product that keeps asking for things it could
-- have gathered once.
--
-- `username` is citext and unique because it is an identity people type and
-- compare: "Sam" and "sam" being two accounts is a support ticket, not a
-- feature. It is nullable because every account that exists today has none,
-- and a not-null column would have to invent one for them — a generated
-- handle nobody chose is worse than an empty field somebody can fill.
alter table profiles add column if not exists username citext;
alter table profiles add column if not exists address text;

-- Partial, so the several existing rows with no username do not collide with
-- each other on null. Postgres treats nulls as distinct in a plain unique
-- index, but saying it explicitly is what stops a later "not null" default
-- from silently making every blank row a duplicate.
create unique index if not exists profiles_username_unique
  on profiles (username) where username is not null;

-- The trigger carries what signup collected.
--
-- Supabase writes the form's extra fields into `raw_user_meta_data`, and this
-- is the only moment they can reach `profiles` without the browser being
-- trusted to write its own row. It stays `on conflict do nothing`: a second
-- insert for the same id is a retry, not a correction, and letting it
-- overwrite would mean a replayed signup could blank a profile somebody has
-- since edited.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, username, address)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    -- Blank strings are not usernames. A form that posts an empty field would
    -- otherwise take the one free slot in the unique index.
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'address'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
