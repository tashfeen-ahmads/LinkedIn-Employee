import "server-only";
import { CTA_DEFINITIONS } from "@le/shared";
import type { createClient } from "@/lib/supabase-server";
import { readConfirmations, readOnboardingStash, type StashedCta } from "@/lib/onboarding-stash";

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
  // Matched on what the entry says, not on which column says it: a row
  // written with the words in `name` and a null `label` is the same ask as
  // one written with them in `label`, and matching only the column made a
  // second "Book a Free Consultation" beside the first.
  let query = supabase
    .from("ctas")
    .select("id, name, label")
    .eq("workspace_id", workspaceId)
    .eq("kind", cta.kind)
    .is("archived_at", null);
  query = url ? query.eq("url", url) : query.is("url", null);
  const { data: existing, error } = await query.order("created_at", { ascending: true });
  if (error) return null;
  const words = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
  const wanted = words(cta.label || CTA_DEFINITIONS[cta.kind].label);
  const same = (existing ?? []).find((row) => words(row.label || row.name) === wanted);
  if (same) return same.id;

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

/**
 * The strategy columns for a call to action: the goal on the strategy's own
 * columns, and the library entry it points at. Written together, because the
 * Targeting Agent writes the copy toward `cta_kind` and the campaign it builds
 * sends through `cta_id` (rule 36); the two must name the same ask.
 */
export function ctaStrategyColumns(
  cta: StashedCta,
  ctaId: string | null,
): { cta_kind: StashedCta["kind"]; cta_label: string | null; cta_url: string | null; cta_id?: string } {
  return { cta_kind: cta.kind, cta_label: cta.label, cta_url: cta.url, ...(ctaId ? { cta_id: ctaId } : {}) };
}

/**
 * The call to action this person chose during setup, as the columns an
 * approval writes onto a strategy that has none of its own (rule 65).
 *
 * The same choice onboarding's approval step applies: this person's own
 * confirmed choice first, since the workspace's copy is only written by its
 * admins, then the workspace's. `/app/strategy` approved without it, so a
 * strategy Sage wrote after the CTA step and approved there built a campaign
 * asking for whatever the agent had defaulted to. Empty when nothing was
 * chosen, so an approval with no setup behind it writes nothing extra.
 */
export async function chosenCtaColumns(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const [{ data: me }, { data: workspace }] = await Promise.all([
    supabase.from("profiles").select("setup_confirmed").eq("id", userId).maybeSingle(),
    supabase.from("workspaces").select("onboarding").eq("id", workspaceId).maybeSingle(),
  ]);
  const cta =
    readConfirmations(me?.setup_confirmed, workspaceId).ctaChoice ?? readOnboardingStash(workspace?.onboarding).cta;
  if (!cta) return {};
  const ctaId = await ensureCta(supabase, workspaceId, userId, cta);
  return ctaStrategyColumns(cta, ctaId);
}
