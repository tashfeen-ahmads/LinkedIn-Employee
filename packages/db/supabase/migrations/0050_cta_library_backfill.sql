-- Every call to action a workspace already uses, listed on Calls to action.
--
-- Onboarding wrote the chosen ask onto each strategy's own columns and never
-- into the library (migration 0024), and a campaign built from a strategy
-- never pointed at one. So a customer who had just picked their call to
-- action opened that page to "No calls to action yet". Onboarding now writes
-- the entry; this does the same for every workspace that already has one in
-- use, and points those strategies and campaigns at it.
--
-- Nothing a prospect receives changes: a campaign reads the entry's values at
-- send time, and the entry is made from that campaign's own values. A link
-- with no destination is left alone, because an entry for it would be a link
-- that goes nowhere.
--
-- Only workspaces whose library is empty. One that keeps its own entries has
-- worded them by hand, and pointing its campaigns at the nearest match would
-- change what those campaigns say.

with wanted as (
  select workspace_id, cta_kind::text as kind, nullif(btrim(cta_label), '') as label,
         case when cta_kind = 'link' then cta_url end as url
    from campaigns
   where cta_id is null and cta_kind is not null and not (cta_kind = 'link' and cta_url is null)
  union
  select workspace_id, cta_kind::text, nullif(btrim(cta_label), ''),
         case when cta_kind = 'link' then cta_url end
    from customer_profiles
   where cta_id is null and cta_kind is not null and not (cta_kind = 'link' and cta_url is null)
)
insert into ctas (workspace_id, name, kind, label, url)
select w.workspace_id,
       coalesce(w.label, case w.kind when 'meeting' then 'Book a meeting'
                                     when 'link' then 'Send them a link'
                                     else 'Start a conversation' end),
       w.kind, w.label, w.url
  from wanted w
 where not exists (select 1 from ctas e where e.workspace_id = w.workspace_id)
   and not exists (
   select 1 from ctas c
    where c.workspace_id = w.workspace_id and c.kind = w.kind and c.archived_at is null
      and c.url is not distinct from w.url and c.label is not distinct from w.label
 );

update campaigns k
   set cta_id = (
     select c.id from ctas c
      where c.workspace_id = k.workspace_id and c.kind = k.cta_kind::text and c.archived_at is null
        and c.url is not distinct from (case when k.cta_kind = 'link' then k.cta_url end)
        and c.label is not distinct from nullif(btrim(k.cta_label), '')
      order by c.created_at limit 1)
 where k.cta_id is null and k.cta_kind is not null and not (k.cta_kind = 'link' and k.cta_url is null)
   and not exists (select 1 from ctas e where e.workspace_id = k.workspace_id and e.created_by is not null);

update customer_profiles p
   set cta_id = (
     select c.id from ctas c
      where c.workspace_id = p.workspace_id and c.kind = p.cta_kind::text and c.archived_at is null
        and c.url is not distinct from (case when p.cta_kind = 'link' then p.cta_url end)
        and c.label is not distinct from nullif(btrim(p.cta_label), '')
      order by c.created_at limit 1)
 where p.cta_id is null and p.cta_kind is not null and not (p.cta_kind = 'link' and p.cta_url is null)
   and not exists (select 1 from ctas e where e.workspace_id = p.workspace_id and e.created_by is not null);
