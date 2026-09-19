import { effectiveCta, type EffectiveCta } from "@le/shared";
import type { Db } from "@le/db";

/**
 * The CTA a campaign is actually sending, read once per job.
 *
 * The library row is fetched separately rather than as an embedded join:
 * PostgREST returns the related row and the worker's fake database cannot, and
 * a query shape that differs between the two is how a test passes while being
 * wrong (see the note in apps/worker/test/fake-db.ts).
 *
 * A pointer that does not resolve — a row deleted between the read and this
 * call — falls back to the campaign's own columns rather than failing the
 * send. The campaign still knows what it was asking for; the only thing lost
 * is the indirection.
 */
export async function readCampaignCta(
  db: Db,
  campaign: {
    cta_id?: string | null;
    cta_kind?: "meeting" | "link" | "reply" | null;
    cta_label?: string | null;
    cta_url?: string | null;
  },
  workspaceId: string,
): Promise<EffectiveCta> {
  const own = {
    kind: campaign.cta_kind ?? null,
    label: campaign.cta_label ?? null,
    url: campaign.cta_url ?? null,
  };

  if (!campaign.cta_id) return effectiveCta(null, own);

  const { data: linked } = await db
    .from("ctas")
    .select("kind, label, url")
    .eq("id", campaign.cta_id)
    // Scoped, because the worker holds the service role and RLS will not save
    // it: an id alone must never reach across workspaces.
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  return effectiveCta(
    linked ? { kind: linked.kind, label: linked.label, url: linked.url } : null,
    own,
  );
}
