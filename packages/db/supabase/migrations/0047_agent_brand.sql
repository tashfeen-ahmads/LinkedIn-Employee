-- An agent can speak for its own brand.
--
-- A workspace runs several agents, and an agent is often a separate brand or
-- product: its own openers, its own offer lines, its own knowledge documents
-- (migrations 0030 and 0031). But there is one business profile per workspace
-- (rule 37), and that profile is what every writer is handed as "the company".
-- So a reply on brand B's campaign introduced brand A, argued from A's proof
-- points, and named A's differentiators — to a person who had only ever heard
-- of B. The documents were already scoped per agent; the description of who is
-- speaking was not.
--
-- Two nullable columns rather than a second business profile. Strategies still
-- hang off the workspace's one business profile, which is what rule 37 is
-- about: a workspace with two has its list split across both. This is only the
-- part a writer reads about who it is writing for.
--
-- Null, or an empty description, keeps the meaning every agent has had until
-- now: the workspace's own business. The description is what switches the
-- brand on; a name alone would be brand B's name on brand A's offering, which
-- is worse than either. Overlaid in code (`apps/worker/src/brand.ts`).
set search_path = le, extensions, public;

alter table agents add column if not exists brand_name text;
alter table agents add column if not exists brand_description text;
