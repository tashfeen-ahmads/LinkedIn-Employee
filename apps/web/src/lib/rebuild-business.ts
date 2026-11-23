import "server-only";
import { callWorker } from "@/lib/worker";
import { hasStrategySource, mergeStash, readOnboardingStash, type StrategySource } from "@/lib/onboarding-stash";
import type { createClient } from "@/lib/supabase-server";

type Client = Awaited<ReturnType<typeof createClient>>;

export type RebuildOutcome =
  | { ok: true; data: unknown }
  | { ok: false; reason: "role" | "unreadable" | "campaigns" | "no-source" | "save-failed" | "clear-failed" | "worker"; error?: string };

/**
 * Sage reads the business again from corrected details, and writes new
 * strategies in place of the old ones.
 *
 * One definition for the two screens that offer it: Profile → Company, and
 * setup's first step. Setup closes every app page until something launches
 * (rule 65), so a customer whose strategies were wrong from the start could
 * only reach the first step, saw it read-only, and was told to connect
 * LinkedIn before anything could be corrected (BeenThere, 23 Nov 2026).
 *
 * Only an owner or admin, and only while no campaign exists: a campaign was
 * built from these strategies and from copy a person read, and replacing them
 * under it leaves a list nobody's strategy explains. A count that could not be
 * read is never "no campaigns" (rule 17), because deleting the business
 * profile takes every strategy with it.
 *
 * `typed` is what the person has just written. Kept before anything is
 * cleared, as a whole rather than field by field: a website from the old
 * answer beside a description of the new one describes two businesses.
 */
export async function rebuildBusiness(
  supabase: Client,
  who: { workspaceId: string; userId: string; role: string | null },
  typed?: StrategySource,
): Promise<RebuildOutcome> {
  if (!["owner", "admin"].includes(who.role ?? "")) return { ok: false, reason: "role" };

  const [{ count: campaigns, error: countError }, { data: ws, error: wsError }] = await Promise.all([
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("workspace_id", who.workspaceId),
    supabase.from("workspaces").select("onboarding").eq("id", who.workspaceId).maybeSingle(),
  ]);
  if (countError || campaigns === null || wsError) return { ok: false, reason: "unreadable" };
  if (campaigns) return { ok: false, reason: "campaigns" };

  const source = typed && hasStrategySource(typed) ? typed : readOnboardingStash(ws?.onboarding).source;
  if (!hasStrategySource(source)) return { ok: false, reason: "no-source" };

  if (typed && hasStrategySource(typed)) {
    const { data: saved } = await supabase
      .from("workspaces")
      .update({ onboarding: mergeStash(ws?.onboarding, { source: typed }) as never })
      .eq("id", who.workspaceId)
      .select("id");
    if (!saved?.length) return { ok: false, reason: "save-failed" };
  }

  // Strategies hang off the business profile and go with it.
  const { error } = await supabase.from("business_profiles").delete().eq("workspace_id", who.workspaceId);
  if (error) return { ok: false, reason: "clear-failed" };

  const queued = await callWorker("/jobs/strategy", { workspaceId: who.workspaceId, userId: who.userId, ...source });
  if (!queued.ok) return { ok: false, reason: "worker", error: queued.error };
  return { ok: true, data: queued.data };
}
