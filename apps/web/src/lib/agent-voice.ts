import "server-only";
import { withRepBio } from "@le/shared";
import type { createClient } from "@/lib/supabase-server";

/**
 * Carries the name and description given on onboarding's voice step to the
 * workspace's agent.
 *
 * The agent is what every writer reads: its `from_name` is the name a prospect
 * sees, ahead of the rep's own, and its voice carries the rep's description to
 * the invitation writer. Sage seeds it at the first step, before the voice step
 * has been reached, so without this the name and description typed there were
 * stored on the profile and read by nothing that writes to a prospect.
 *
 * Only what was copied from this person: an agent whose from-name or bio line
 * somebody has since changed by hand keeps their wording.
 */
export async function carryVoiceToAgent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  before: { fullName: string | null; bio: string | null },
  after: { fullName: string; bio: string | null },
): Promise<boolean> {
  const { data: agent, error } = await supabase
    .from("agents")
    .select("id, from_name, system_prompt")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  // Not written yet: Sage seeds it from the profile, which now holds both.
  if (!agent) return true;

  const fromName = agent.from_name?.trim() ?? "";
  const nameIsOurs = !fromName || fromName === (before.fullName?.trim() ?? "");
  const voice = agent.system_prompt ?? "";
  const nextVoice = withRepBio(voice, after.bio, before.bio);
  const patch = {
    ...(nameIsOurs && fromName !== after.fullName ? { from_name: after.fullName } : {}),
    ...(nextVoice !== voice ? { system_prompt: nextVoice } : {}),
  };
  if (Object.keys(patch).length === 0) return true;

  const { data: saved } = await supabase
    .from("agents")
    .update(patch)
    .eq("id", agent.id)
    .eq("workspace_id", workspaceId)
    .select("id");
  return Boolean(saved?.length);
}
