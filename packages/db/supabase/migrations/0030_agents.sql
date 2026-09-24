-- One agent owns everything a prospect reads.
--
-- The product had grown three separate screens for what is one decision. The
-- opener lived under "Opener & pitch", the offer beside it, the product facts
-- under "Knowledge base", and the voice that used all three was a prompt
-- constant in the repo that nobody outside it could see, let alone change.
-- A rep who wanted the messages to sound different had no single place to go
-- and no way to find out what the change would produce before a stranger read
-- it.
--
-- An agent is that place. It carries the model, the voice, the openers, the
-- offer lines, the playbook it works to, and the facts it may use — and a
-- campaign points at one. The parts it gathers are not new tables: `hooks` and
-- `pitches` already carry approval, retirement, defaults and every rule that
-- keeps an unapproved line away from a real person (rule 40). Those rules are
-- the expensive part and they are kept exactly as they are. What changes is
-- that a line can now belong to an agent instead of only to a workspace.
--
-- Every link added here is nullable, and that is the whole migration strategy.
-- A workspace with no agents behaves precisely as it did yesterday: the
-- workspace-level default hook and pitch are still what resolves, the running
-- campaigns still send, and nothing already queued changes what it is about.

create table agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,

  -- What a rep calls it in a picker. "Chapter leaders — warm intro", not
  -- "agent 2".
  name text not null,

  -- The model this agent runs on.
  --
  -- Stored per agent rather than read from the deployment's env, because the
  -- choice is a product decision a rep makes about tone and cost, and it is one
  -- of the few things about an agent that is worth changing without rewriting
  -- a single line of copy. Validated in code against the price table
  -- (`packages/shared/src/pricing.ts`) so a model nobody can price cannot be
  -- selected — a model missing from that table costs null, never zero.
  model text,

  -- How it writes. The rep's own words about voice, audience and what to avoid.
  system_prompt text,

  -- Who the message appears to come from, which is not always the account
  -- holder's full name: "Tashfeen" reads like a person, "Tashfeen Ahmad Khan"
  -- reads like a signature block.
  from_name text,

  /*
   * What the agent is working towards once somebody replies.
   *
   * jsonb rather than columns because this is the half of an agent that
   * genuinely differs between businesses — one runs three qualification
   * questions, another hands over the moment a price is mentioned — and a
   * column per idea would be a migration every time somebody has one.
   *
   * Shape is enforced in code (`AgentPlaybookSchema`), never here: a check
   * constraint on jsonb fails an insert at the database with a message no
   * screen can render usefully.
   */
  playbook jsonb not null default '{}'::jsonb,

  /*
   * The merge fields this agent may use, beyond the ones every agent has.
   *
   * `first_name` and `company` are universal and live in code. This is for the
   * ones a particular business pulls out of its own prospect data, and it is
   * stored so the test area can offer them and the editor can warn about a
   * field the data cannot actually fill — a placeholder that reaches a prospect
   * unresolved is the failure this exists to prevent.
   */
  custom_fields jsonb not null default '[]'::jsonb,

  -- The one a new campaign starts with. Same reason `pitches_one_default`
  -- exists: "which agent" answered by row order is answered differently on
  -- different days.
  is_default boolean not null default false,

  -- Retired rather than deleted, exactly as a CTA is (rule 36): a campaign that
  -- ran on this agent still has to be able to say what it was.
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index agents_one_default on agents (workspace_id) where is_default and archived_at is null;
create index agents_workspace_idx on agents (workspace_id) where archived_at is null;

-- An opener, an offer line and a document can each belong to one agent.
--
-- Null keeps its existing meaning — workspace-wide, available to everything —
-- so this is additive in the only sense that matters: no row changes, and
-- every resolution that worked yesterday still finds what it found.
alter table hooks add column if not exists agent_id uuid references agents (id) on delete set null;
alter table pitches add column if not exists agent_id uuid references agents (id) on delete set null;
alter table knowledge_documents add column if not exists agent_id uuid references agents (id) on delete set null;

create index if not exists hooks_agent_idx on hooks (agent_id) where agent_id is not null;
create index if not exists pitches_agent_idx on pitches (agent_id) where agent_id is not null;
create index if not exists knowledge_documents_agent_idx on knowledge_documents (agent_id) where agent_id is not null;

-- `set null` and never cascade, for rule 36's reason: deleting an agent must
-- not delete the campaign that ran on it, and the campaign's results are the
-- record of what that agent actually produced.
alter table campaigns add column if not exists agent_id uuid references agents (id) on delete set null;
create index if not exists campaigns_agent_idx on campaigns (agent_id) where agent_id is not null;

/*
 * What the agent said when somebody tested it.
 *
 * Kept rather than rendered and thrown away, because the question a rep asks on
 * the second day is "did this get better or worse after I changed the prompt",
 * and that question cannot be answered from a screen that remembers nothing.
 * It also makes a bad run reportable: the exact input, the exact output.
 *
 * Nothing here ever reaches a prospect. It is the one place in this product
 * where the agent writes and no send can follow.
 */
create table agent_test_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  -- The prospect it was run against: a real row from this workspace, or a
  -- typed-in one. Stored as jsonb because a typed-in prospect has no id.
  subject jsonb not null default '{}'::jsonb,
  -- What was asked of it, and what came back.
  invite_note text,
  first_message text,
  sample_question text,
  sample_reply text,
  -- Which merge fields resolved and which had nothing to fill them. The second
  -- list is the useful one.
  fields_used jsonb not null default '[]'::jsonb,
  fields_missing jsonb not null default '[]'::jsonb,
  model text,
  prompt_version text,
  error text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index agent_test_runs_agent_idx on agent_test_runs (agent_id, created_at desc);

alter table agents enable row level security;
alter table agent_test_runs enable row level security;

create policy agents_rw on agents
  for all using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

create policy agent_test_runs_rw on agent_test_runs
  for all using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

create trigger agents_touch before update on agents
  for each row execute function touch_updated_at();
