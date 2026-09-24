-- One default opener and one default offer per agent, not per workspace.
--
-- `hooks_one_default` and `pitches_one_default` were written when a workspace
-- held one set of copy, and they say `unique (workspace_id) where is_default`.
-- Once a line can belong to an agent that is the wrong shape twice over.
--
-- It is wrong on the way in: seeding an agent with a default opener violates
-- the index the moment a second agent is seeded, and the first time that
-- happened the insert error went unchecked and the agent shipped with no copy
-- at all.
--
-- And it is wrong on the way out. `pitchFor` and the campaign builder both read
-- an agent's lines ordered by `is_default` — with no default among them the
-- order is whatever the rows came back in, which is "which line does this agent
-- lead with" answered differently on different days. That is exactly what the
-- index exists to prevent, moved down one level.
--
-- `coalesce` rather than a plain two-column index, because a unique index
-- treats two NULLs as distinct: `unique (workspace_id, agent_id)` would let a
-- workspace hold any number of workspace-level defaults, which is the rule
-- these indexes were added for.

drop index if exists hooks_one_default;
drop index if exists pitches_one_default;

create unique index hooks_one_default
  on hooks (workspace_id, coalesce(agent_id, workspace_id))
  where is_default;

create unique index pitches_one_default
  on pitches (workspace_id, coalesce(agent_id, workspace_id))
  where is_default;
