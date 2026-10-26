import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@le/db";
import type { CtaKind, DatedFunnelRow } from "@le/shared";
import { fetchAllRows } from "./rows";
import { CAMPAIGN_CTA_COLUMNS, campaignCtas, type CampaignCtaColumns } from "./campaign-cta";

export interface CampaignFacts {
  id: string;
  name: string;
  status: string;
  owner_user_id: string;
  /**
   * What the campaign is actually asking for: its library entry's kind when
   * it points at one, its own column otherwise (`effectiveCta`, rule 36). Not
   * the raw column, which goes stale when a campaign is pointed elsewhere.
   */
  cta_kind: CtaKind;
  customer_profile_id: string | null;
  launched_at: string | null;
}

export interface FunnelData {
  campaigns: CampaignFacts[];
  rows: DatedFunnelRow[];
  rowsByCampaign: Map<string, DatedFunnelRow[]>;
  /** The goals actually in play, which decide which stages may be shown. */
  goals: CtaKind[];
  /** True when more rows exist than were read. Said on screen, never hidden. */
  truncated: boolean;
}

/**
 * The rows every funnel on every screen is counted from, read once per request.
 *
 * Both dashboards used to run their own version of this query, which is how
 * they came to disagree: the overview counted every prospect in the workspace
 * and reporting counted only those on a campaign it had also loaded, so a
 * campaign deleted out from under its prospects moved the two numbers apart
 * with nothing to say which was right.
 */
export async function readFunnelData(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<FunnelData> {
  const { data: campaignRows } = await supabase
    .from("campaigns")
    .select(`id, name, status, owner_user_id, customer_profile_id, launched_at, ${CAMPAIGN_CTA_COLUMNS}`)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  // The goal each campaign is judged on is the one it actually sends toward.
  const raw = (campaignRows ?? []) as unknown as Array<Omit<CampaignFacts, "cta_kind"> & CampaignCtaColumns>;
  const ctas = await campaignCtas(supabase, workspaceId, raw);
  const campaigns: CampaignFacts[] = raw.map(({ cta_id: _id, cta_label: _label, cta_url: _url, ...c }) => ({
    ...c,
    cta_kind: ctas.get(c.id)?.kind ?? c.cta_kind ?? "meeting",
  }));

  const { rows, truncated } = await fetchAllRows<DatedFunnelRow & { campaign_id: string }>((from, to) =>
    supabase
      .from("campaign_prospects")
      .select("campaign_id, status, invited_at, accepted_at, replied_at")
      .eq("workspace_id", workspaceId)
      // Ordered, because paging an unordered query can repeat or skip a row.
      .order("id", { ascending: true })
      .range(from, to),
  );

  const rowsByCampaign = new Map<string, DatedFunnelRow[]>();
  for (const row of rows) {
    const list = rowsByCampaign.get(row.campaign_id);
    if (list) list.push(row);
    else rowsByCampaign.set(row.campaign_id, [row]);
  }

  return {
    campaigns,
    rows,
    rowsByCampaign,
    goals: [...new Set(campaigns.map((c) => c.cta_kind))],
    truncated,
  };
}
