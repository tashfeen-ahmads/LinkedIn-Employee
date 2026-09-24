import {
  AgentPlaybookSchema,
  BusinessProfileSchema,
  CustomerProfileSchema,
  CustomFieldSchema,
  type Agent,
  type CustomField,
} from "@le/shared";
import { testAgentInvite, type AgentTestSubject } from "@le/agents";
import type { WorkerContext } from "../context.js";

/**
 * Runs an agent against one prospect and reports what it would send.
 *
 * Synchronous, like `/jobs/write-pitch`: the output is the entire point of the
 * click, and an answer that arrives in a background job is an answer nobody
 * waits for.
 *
 * It calls the real invite writer. A test area with its own copy of the logic
 * is a second reading of the same rule, and the two drift — the screen's
 * reading being the one somebody believes right up until a prospect gets
 * something else.
 *
 * Nothing it does can send. This is the one path where the agent writes and no
 * provider call follows, which is exactly what makes it worth having.
 */

export interface AgentTestRequest {
  workspaceId: string;
  userId: string;
  agentId: string;
  /** A prospect already in this workspace, or nothing when one is typed in. */
  prospectId?: string;
  subject?: AgentTestSubject;
}

export interface AgentTestResponse {
  ok: boolean;
  inviteNote: string | null;
  grounding: string[];
  fieldsUsed: string[];
  fieldsMissing: string[];
  model: string | null;
  /** Said in words rather than logged on a host the caller cannot reach. */
  reason: string | null;
}

function parseCustomFields(value: unknown): CustomField[] {
  if (!Array.isArray(value)) return [];
  const out: CustomField[] = [];
  for (const entry of value) {
    const parsed = CustomFieldSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function runAgentTest(
  ctx: WorkerContext,
  input: AgentTestRequest,
): Promise<AgentTestResponse> {
  const { db } = ctx;
  const refuse = (reason: string): AgentTestResponse => ({
    ok: false,
    inviteNote: null,
    grounding: [],
    fieldsUsed: [],
    fieldsMissing: [],
    model: null,
    reason,
  });

  const { data: row } = await db
    .from("agents")
    .select("id, name, model, system_prompt, from_name, playbook, custom_fields")
    .eq("id", input.agentId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!row) return refuse("That agent does not exist in this workspace.");

  const agent: Agent = {
    name: row.name,
    model: row.model,
    systemPrompt: row.system_prompt,
    fromName: row.from_name,
    playbook: AgentPlaybookSchema.safeParse(row.playbook ?? {}).data ?? AgentPlaybookSchema.parse({}),
    customFields: parseCustomFields(row.custom_fields),
  };

  // The subject: a real row from this workspace, or the one typed into the
  // form. A real one is worth preferring — the question a rep is answering is
  // "what would this agent write to *these* people", and a made-up prospect
  // with a tidy company name answers an easier question than the list does.
  let subject: AgentTestSubject | null = input.subject ?? null;
  if (input.prospectId) {
    const { data: prospect } = await db
      .from("prospects")
      .select("first_name, last_name, company, title, headline, location, linkedin_url")
      .eq("id", input.prospectId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (!prospect) return refuse("That prospect is not in this workspace.");
    subject = {
      firstName: prospect.first_name ?? "",
      lastName: prospect.last_name,
      company: prospect.company,
      title: prospect.title,
      headline: prospect.headline,
      location: prospect.location,
      linkedinUrl: prospect.linkedin_url,
    };
  }
  if (!subject?.firstName?.trim()) {
    return refuse("Pick a prospect, or type in a first name to test against.");
  }

  const [{ data: business }, { data: profiles }, { data: openerRows }, { data: profile }] =
    await Promise.all([
      db.from("business_profiles").select("spec").eq("workspace_id", input.workspaceId).maybeSingle(),
      db
        .from("customer_profiles")
        .select("spec, approved_at")
        .eq("workspace_id", input.workspaceId)
        .not("approved_at", "is", null)
        .limit(1),
      db.from("hooks").select("body, approved_at").eq("agent_id", input.agentId),
      db.from("profiles").select("full_name").eq("id", input.userId).maybeSingle(),
    ]);

  const businessSpec = BusinessProfileSchema.safeParse(business?.spec);
  if (!businessSpec.success) {
    return refuse("Add your business profile first — the agent writes from it.");
  }
  const profileSpec = CustomerProfileSchema.safeParse(profiles?.[0]?.spec);
  if (!profileSpec.success) {
    return refuse("Approve a strategy first, so the agent knows who it is writing to.");
  }

  // Approved only, exactly as a send resolves them. A test that leaned on an
  // unapproved line would show a rep copy the campaign will never produce.
  const openers = (openerRows ?? [])
    .filter((h) => h.approved_at && h.body?.trim())
    .map((h) => h.body.trim());

  const result = await testAgentInvite(ctx.agentsFor(input.workspaceId), {
    agent,
    business: businessSpec.data,
    profile: profileSpec.data,
    repName: profile?.full_name ?? "",
    openers,
    subject,
  });

  // Kept, because "did this get better after I changed the prompt" cannot be
  // answered from a screen that remembers nothing.
  await db.from("agent_test_runs").insert({
    workspace_id: input.workspaceId,
    agent_id: input.agentId,
    subject: subject as never,
    invite_note: result.inviteNote,
    fields_used: result.fieldsUsed as never,
    fields_missing: result.fieldsMissing as never,
    model: agent.model,
    error: result.error,
    created_by: input.userId,
  });

  return {
    ok: result.error === null,
    inviteNote: result.inviteNote,
    grounding: result.grounding,
    fieldsUsed: result.fieldsUsed,
    fieldsMissing: result.fieldsMissing,
    model: agent.model,
    reason: result.error,
  };
}
