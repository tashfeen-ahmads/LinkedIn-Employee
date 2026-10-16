import "server-only";
import { CTA_DEFINITIONS } from "@le/shared";
import type { createClient } from "@/lib/supabase-server";
import type { StashedCta } from "@/lib/onboarding-stash";

/**
 * The library entry for the call to action chosen on onboarding's CTA step,
 * found or created (rule 36).
 *
 * Onboarding wrote the choice onto each strategy's own columns and nowhere
 * else, so a customer who had just picked one opened Calls to action to "No
 * calls to action yet" — the screen telling them to set up the thing they had
 * set up. The same values make the same row, so pressing the step twice or
 * approving after it reuses one entry rather than listing it twice.
 */
export async function ensureCta(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
  cta: StashedCta,
): Promise<string | null> {
  const url = CTA_DEFINITIONS[cta.kind].needsUrl ? cta.url : null;
  let query = supabase
    .from("ctas")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("kind", cta.kind)
    .is("archived_at", null);
  query = url ? query.eq("url", url) : query.is("url", null);
  query = cta.label ? query.eq("label", cta.label) : query.is("label", null);
  const { data: existing, error } = await query.limit(1);
  if (error) return null;
  if (existing?.[0]) return existing[0].id;

  const { data: created } = await supabase
    .from("ctas")
    .insert({
      workspace_id: workspaceId,
      name: cta.label?.trim() || CTA_DEFINITIONS[cta.kind].label,
      kind: cta.kind,
      label: cta.label,
      url,
      created_by: userId,
    })
    .select("id")
    .single();
  return created?.id ?? null;
}
