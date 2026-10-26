-- Meeting hours whose timezone the runtime cannot read.
--
-- The Meetings page took free text, and one live row says "Eastern". Every
-- reply that offered times threw on it. The page now takes only real zones
-- (TimezoneSelect, `availabilityProblem`), so this repairs the rows written
-- before that: the person's own profile zone where it is real, otherwise UTC.

update availability a
   set timezone = coalesce(
     (select p.timezone from profiles p
       where p.id = a.user_id
         and p.timezone in (select name from pg_timezone_names)),
     'UTC')
 where a.timezone is null
    or a.timezone not in (select name from pg_timezone_names);
