import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@le/db";
import { effectiveCta, type CtaKind, type EffectiveCta } from "@le/shared";

/** The columns a campaign carries about what it asks for. */
export interface CampaignCtaColumns {
  id: string;
  cta_id: string | null;
  cta_kind: CtaKind | null;
  cta_label: string | null;
  cta_url: string | null;
}

/** The campaign columns to select for `campaignCtas`. */
export const CAMPAIGN_CTA_COLUMNS = "cta_id, cta_kind, cta_label, cta_url";

/**
 * What each campaign is actually asking for, read as the worker reads it.
 *
 * A campaign's own `cta_kind` is not the answer once it points at a library
 * entry (rule 36): the send path resolves `cta_id` first (`readCampaignCta`),
 * and a screen that read the column saw a "meeting" campaign whose every
 * message sent a link. The funnel's goals, the results label, the inbox's
 * meeting tab and the meeting-hours row all ask this one question, so they ask
 * it here.
 *
 * Archived entries still resolve, as they do on the send path: archiving a
 * destination keeps every campaign using it pointed where it was. A library
 * read that fails falls back to each campaign's own columns, which is what
 * the send path does with a pointer it cannot resolve.
 */
export async function campaignCtas(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  campaigns: readonly CampaignCtaColumns[],
): Promise<Map<string, EffectiveCta>> {
  const ids = [...new Set(campaigns.map((c) => c.cta_id).filter((id): id is string => Boolean(id)))];
  const { data: rows } = ids.length
    ? await supabase.from("ctas").select("id, kind, label, url").eq("workspace_id", workspaceId).in("id", ids)
    : { data: [] as Array<{ id: string; kind: CtaKind; label: string | null; url: string | null }> };
  const byId = new Map((rows ?? []).map((row) => [row.id, row]));
  return new Map(
    campaigns.map((c) => [
      c.id,
      effectiveCta(c.cta_id ? (byId.get(c.cta_id) ?? null) : null, {
        kind: c.cta_kind,
        label: c.cta_label,
        url: c.cta_url,
      }),
    ]),
  );
}
