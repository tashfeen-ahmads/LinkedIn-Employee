import {
  AgentPlaybookSchema,
  CustomFieldSchema,
  modelToUse,
  type AgentPlaybook,
  type CustomField,
} from "@le/shared";
import type { Db } from "@le/db";

/**
 * The agent a campaign sends through, resolved once.
 *
 * Every screen that decides what a prospect reads now points at one row, so
 * every path that *sends* has to read that row as well — otherwise the agent is
 * a settings page that changes nothing, which is the single worst outcome for a
 * feature like this. A rep who edits the voice, sees nothing change, and
 * concludes the product is lying to them is not coming back to the screen.
 *
 * Resolved here rather than at each call site for the reason two readings are
 * always wrong: they drift, and the one somebody believes is whichever screen
 * they happened to look at. The invite writer, the offer, the merge values and
 * the reply all ask this function.
 *
 * Null is a real answer and not a failure. A campaign built before agents
 * existed has no `agent_id`, and it must keep behaving exactly as it did — the
 * workspace-level opener and pitch, the deployment's own model. Every caller
 * treats null as "carry on as before", which is what makes this additive.
 */

export interface CampaignAgent {
  id: string;
  name: string;
  /** Null falls through to the deployment's configured model. */
  model: string | null;
  /** Extra voice guidance, in the rep's own words. */
  systemPrompt: string | null;
  /** The name a prospect reads, which is not always the account holder's. */
  fromName: string | null;
  playbook: AgentPlaybook;
  customFields: CustomField[];
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

/** The agent on this campaign, or null when it predates them. */
export async function agentForCampaign(db: Db, campaignId: string): Promise<CampaignAgent | null> {
  const { data: campaign } = await db
    .from("campaigns")
    .select("agent_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign?.agent_id) return null;
  return agentById(db, campaign.agent_id);
}

export async function agentById(db: Db, agentId: string): Promise<CampaignAgent | null> {
  const { data } = await db
    .from("agents")
    .select("id, name, model, system_prompt, from_name, playbook, custom_fields, archived_at")
    .eq("id", agentId)
    .maybeSingle();
  if (!data) return null;

  // A retired agent still writes for the campaigns already running on it.
  // Retiring one stops it being *chosen*; stopping it mid-campaign would leave
  // a launched sequence without the voice its first message was written in,
  // which is worse than either.
  return {
    id: data.id,
    name: data.name,
    model: data.model,
    systemPrompt: data.system_prompt,
    fromName: data.from_name,
    playbook: AgentPlaybookSchema.safeParse(data.playbook ?? {}).data ?? AgentPlaybookSchema.parse({}),
    customFields: parseCustomFields(data.custom_fields),
  };
}

/**
 * The approved openers this campaign may use.
 *
 * The agent's own when it has one, and the workspace's otherwise. Never both:
 * an agent that has been given three openers has been given exactly the three
 * somebody wants used, and quietly adding the workspace's other five back in
 * would make the agent's list a suggestion.
 *
 * Approved or nothing, in both cases (rule 40). An unapproved opener is a line
 * the agent wrote and nobody read, and it is the first thing a stranger ever
 * sees from this workspace.
 */
export async function openersFor(
  db: Db,
  workspaceId: string,
  agent: CampaignAgent | null,
): Promise<string[]> {
  if (agent) {
    const { data } = await db
      .from("hooks")
      .select("body")
      .eq("agent_id", agent.id)
      .not("approved_at", "is", null)
      .limit(12);
    const own = (data ?? []).map((row) => row.body?.trim() ?? "").filter(Boolean);
    if (own.length) return own;
    // An agent with no approved opener of its own falls back rather than
    // sending nothing: an invitation with no note is delivered by LinkedIn, so
    // an empty list here would quietly turn a campaign into bare connection
    // requests nobody chose to send.
  }

  const { data } = await db
    .from("hooks")
    .select("body")
    .eq("workspace_id", workspaceId)
    .is("agent_id", null)
    .not("approved_at", "is", null)
    .limit(12);
  return (data ?? []).map((row) => row.body?.trim() ?? "").filter(Boolean);
}

/**
 * The extra voice guidance handed to a writer.
 *
 * Appended to the prompt rather than replacing it: the shipped prompt carries
 * the rules that keep a note under LinkedIn's limit, keep a link out of a
 * connection request and keep the agent from inventing a fact. A rep's own
 * words about voice are worth a great deal and are not worth any of those.
 */
export function voiceOf(agent: CampaignAgent | null): string | undefined {
  const written = agent?.systemPrompt?.trim();
  if (!written) return undefined;
  const objective = agent?.playbook.objective?.trim();
  const avoid = agent?.playbook.avoid?.trim();
  return [
    `How this workspace wants you to write:\n${written}`,
    objective ? `\nWhat this campaign is for: ${objective}` : "",
    avoid ? `\nNever: ${avoid}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The model to call with, given what this deployment can actually serve.
 *
 * The agent's choice is honoured only when the running client is the provider
 * that serves it: a client built for OpenAI cannot answer for a Claude model,
 * so an agent set to one on an OpenAI-keyed deployment is not slower, it is a
 * failed call and a campaign with no notes.
 *
 * Guarded because a client that cannot report its own models is not evidence
 * about anything. `undefined` means "use whatever the writer would have used",
 * which is the behaviour every campaign had before an agent could choose —
 * deciding a model from a client that has not said what it serves is the kind
 * of guess that reaches a real person.
 */
export function modelFor(
  client: unknown,
  agent: CampaignAgent | null,
): { model: string | undefined; honoured: boolean } {
  const reported = client as { provider?: string; models?: { writer?: string } } | null | undefined;
  const provider = reported?.provider;
  const writer = reported?.models?.writer;
  if (typeof provider !== "string" || typeof writer !== "string") {
    return { model: undefined, honoured: !agent?.model };
  }
  const chosen = modelToUse(agent?.model, { provider, writer });
  return { model: chosen.model, honoured: chosen.honoured };
}
