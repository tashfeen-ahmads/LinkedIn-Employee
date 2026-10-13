import type { DatedFunnelRow } from "@le/shared";
import type { FunnelData } from "./funnel-data";

/**
 * Whether a role reads the whole team's funnel or only its own campaigns.
 * One definition, because the overview's headline figures and the Results
 * section beneath them must scope by the same rule or they disagree.
 */
export function canSeeTeamFunnel(role: string): boolean {
  return ["owner", "admin", "manager"].includes(role);
}

/**
 * The funnel as one viewer may read it.
 *
 * Results told a rep "Showing your own campaigns. Team-wide figures are
 * visible to managers." and then drew the chart, the trend, the strategy bars
 * and every strategy row from the whole workspace, filtering only the "All"
 * row's counts. So the same table showed team numbers above a total of the
 * rep's own, and the total's rates came from the team. One scoping, applied
 * once, before anything is counted, so every figure on the page is the same
 * population the sentence under it names.
 */
export function scopeFunnel(
  funnel: FunnelData,
  viewer: { userId: string; canSeeTeam: boolean },
): FunnelData {
  if (viewer.canSeeTeam) return funnel;
  const campaigns = funnel.campaigns.filter((c) => c.owner_user_id === viewer.userId);
  const ids = new Set(campaigns.map((c) => c.id));
  const rows = funnel.rows.filter((r) => ids.has((r as DatedFunnelRow & { campaign_id: string }).campaign_id));
  const rowsByCampaign = new Map([...funnel.rowsByCampaign].filter(([id]) => ids.has(id)));
  return {
    campaigns,
    rows,
    rowsByCampaign,
    goals: [...new Set(campaigns.map((c) => c.cta_kind))],
    truncated: funnel.truncated,
  };
}
