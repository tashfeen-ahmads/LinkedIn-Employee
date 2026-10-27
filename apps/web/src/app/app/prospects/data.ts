import "server-only";
import type { createClient } from "@/lib/supabase-server";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface ProspectMenuCounts {
  /** Everybody this workspace has found. */
  everyone: number;
  /** People queued on a campaign nobody has launched yet: the review step. */
  review: number;
  /** Draft campaigns those people are on. */
  draftCampaigns: { id: string; name: string; customer_profile_id: string | null; created_at: string }[];
  /** Approved strategies a search can run for. */
  searchable: number;
  /** People marked do-not-contact, plus entries on the shared exclusion list. */
  excluded: number;
}

/**
 * The counts beside each item of the prospect menu, read once per page.
 *
 * Head counts, never rows: the menu is on every prospect screen and a count
 * that read every row would be the slowest part of all four of them.
 */
export async function loadProspectMenu(supabase: Client, workspaceId: string): Promise<ProspectMenuCounts> {
  const [{ count: everyone }, { data: drafts }, { count: searchable }, { count: dnc }, { count: exclusions }] =
    await Promise.all([
      supabase.from("prospects").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
      supabase
        .from("campaigns")
        .select("id, name, customer_profile_id, created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "draft")
        .order("created_at", { ascending: false }),
      supabase
        .from("customer_profiles")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .not("approved_at", "is", null)
        .eq("do_not_pursue", false),
      supabase
        .from("prospects")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("do_not_contact", true),
      supabase.from("exclusions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    ]);

  const draftCampaigns = drafts ?? [];
  const { count: review } = draftCampaigns.length
    ? await supabase
        .from("campaign_prospects")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "queued")
        .in(
          "campaign_id",
          draftCampaigns.map((c) => c.id),
        )
    : { count: 0 };

  return {
    everyone: everyone ?? 0,
    review: review ?? 0,
    draftCampaigns,
    searchable: searchable ?? 0,
    excluded: (dnc ?? 0) + (exclusions ?? 0),
  };
}

/**
 * What to call somebody on screen.
 *
 * A blank name is never shown: fourteen real prospects rendering as "Unknown"
 * is what made a working list look like fake data. The headline is the next
 * best thing and is usually the most informative line we have about them.
 */
export function displayName(prospect: { first_name: string | null; last_name: string | null; headline: string | null }): string {
  const name = `${prospect.first_name ?? ""} ${prospect.last_name ?? ""}`.trim();
  if (name) return name;
  return prospect.headline?.trim() || "LinkedIn member";
}

/**
 * A strategy name short enough to sit in a filter pill or a table cell.
 *
 * The Strategy Agent writes descriptive names — "Networking group leaders &
 * organizations (BNI chapters, Chambers, masterminds)" — which are exactly
 * right on the strategy page and unusable as a tab. The full name stays in the
 * title attribute rather than being lost.
 */
export function shortName(name: string): string {
  const head = name.split(/[(—–]/)[0]!.trim();
  return head.length > 34 ? `${head.slice(0, 33).trimEnd()}…` : head;
}
