import "server-only";
import type { createClient } from "@/lib/supabase-server";

/**
 * Who may write the workspace row, and so change how much the agent does on
 * its own: exactly the roles the database's `is_workspace_admin` lets update
 * `workspaces`. One list, so the app never refuses what the database allows
 * or offers what it refuses.
 */
export const AUTONOMY_ROLES = ["owner", "admin", "manager"] as const;

/**
 * Sets how replies are handled, on the workspace and on every campaign in it.
 *
 * Two places hold it: the workspace's answer, which the Targeting Agent copies
 * into each new campaign, and each campaign's own rules. Writing only the
 * campaigns let every later campaign revert to the signup answer; writing only
 * the workspace left the campaigns already built on the old one while every
 * screen reported the new one. One definition, for the profile page and for
 * onboarding (rule 65), so neither can do half of it.
 *
 * Merged, never replaced: the workspace row also holds the sending window and
 * the search tier, and a campaign's rules hold the record of how its list was
 * searched.
 *
 * `replyMode`, when given, is written onto every campaign as well: the launch
 * step's two answers are a reply mode each ("I'll check each one" is
 * `approval`, "Nora runs it" is `autopilot`) and that screen promises the
 * answer "becomes the setting for every campaign". Without it the profile's
 * own reading applies (`replyModeFor`).
 */
export async function setAutonomy(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  autonomy: "autonomous" | "supervised",
  replyMode?: ReplyMode,
): Promise<boolean> {
  const { data: ws } = await supabase.from("workspaces").select("onboarding").eq("id", workspaceId).maybeSingle();
  const answers = (ws?.onboarding && typeof ws.onboarding === "object" ? ws.onboarding : {}) as Record<string, unknown>;
  const { data: saved } = await supabase
    .from("workspaces")
    .update({ onboarding: { ...answers, autonomy } as never })
    .eq("id", workspaceId)
    .select("id");

  let campaignsOk = true;
  const { data: campaigns, error: readError } = await supabase
    .from("campaigns")
    .select("id, rules")
    .eq("workspace_id", workspaceId);
  if (readError) campaignsOk = false;
  for (const campaign of campaigns ?? []) {
    const rules = (campaign.rules && typeof campaign.rules === "object" ? campaign.rules : {}) as Record<string, unknown>;
    const { error } = await supabase
      .from("campaigns")
      .update({ rules: { ...rules, autonomy } as never, ...replyModeFor(autonomy, replyMode) })
      .eq("id", campaign.id)
      .eq("workspace_id", workspaceId);
    if (error) campaignsOk = false;
  }
  // Both halves or it did not happen: a workspace saying one thing and its
  // campaigns another is the drift this exists to prevent.
  return Boolean(saved?.length) && campaignsOk;
}

/**
 * "The agent answers on its own" has to reach the campaign's reply mode too.
 *
 * The reply gate holds every message on a campaign in `approval` mode whatever
 * its autonomy says, and every campaign is created in `approval`. So a rep who
 * answered "the agent answers and books, on its own" had every reply held
 * anyway: six live drafts said autonomous and would have waited on a person
 * for every message. Choosing autonomy turns the mode on; choosing supervision
 * on the profile leaves the mode as the rep set it on the campaign, since "hold
 * anything uncertain" still sends what is clean. A mode stated outright (the
 * launch step's answer) is written as stated.
 */
export function replyModeFor(
  autonomy: "autonomous" | "supervised",
  replyMode?: ReplyMode,
): { reply_mode?: ReplyMode } {
  if (replyMode) return { reply_mode: replyMode };
  return autonomy === "autonomous" ? { reply_mode: "autopilot" } : {};
}

export type ReplyMode = "approval" | "autopilot";

/** The choice made on the launch step: a person checks each reply, or Nora runs it. */
export type ReplyHandling = "check" | "nora";

/**
 * Sets how the campaign being launched handles replies, and — for the people
 * who may — the workspace's answer and every campaign's, so every later
 * campaign starts the same way and none already built says the opposite.
 *
 * Both ways, on every campaign: "I'll check each one" left a campaign that was
 * already on autopilot answering on its own, and "Nora runs it" left the ones
 * built on the signup answer holding every reply.
 *
 * "check" is `approval`: every reply waits for a person, which is what "I will
 * check each one" means. "nora" is `autopilot` and autonomous: it answers and
 * books on its own, with the holds rule 41 keeps whatever the setting.
 */
export async function setReplyHandling(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  campaignId: string,
  choice: ReplyHandling,
  mayWriteWorkspace: boolean,
): Promise<boolean> {
  const autonomy = choice === "nora" ? "autonomous" : "supervised";
  const replyMode: ReplyMode = choice === "nora" ? "autopilot" : "approval";
  if (mayWriteWorkspace && !(await setAutonomy(supabase, workspaceId, autonomy, replyMode))) return false;
  const { data: row } = await supabase
    .from("campaigns")
    .select("rules")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const rules = (row?.rules && typeof row.rules === "object" ? row.rules : {}) as Record<string, unknown>;
  const { data: saved } = await supabase
    .from("campaigns")
    .update({ rules: { ...rules, autonomy } as never, reply_mode: replyMode })
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .select("id");
  return Boolean(saved?.length);
}
