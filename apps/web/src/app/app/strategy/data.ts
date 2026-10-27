import "server-only";
import type { createClient } from "@/lib/supabase-server";
import { fetchAllRows } from "@/lib/rows";

type Client = Awaited<ReturnType<typeof createClient>>;

/** What one strategy has produced: people found, people written to, campaigns. */
export interface StrategyYield {
  found: number;
  contacted: number;
  campaigns: number;
  running: number;
}

export interface StrategyMenuRow {
  id: string;
  name: string;
  spec: unknown;
  priority: number;
  approved_at: string | null;
  do_not_pursue: boolean;
  cta_kind: "meeting" | "link" | "reply";
  cta_label: string | null;
  cta_url: string | null;
  business_profile_id: string;
}

export interface BusinessRow {
  id: string;
  spec: unknown;
  website_url: string | null;
  created_at: string;
}

/**
 * Everything the strategy menu needs, read once for both of its screens.
 *
 * The business profile and every strategy's own page show the same menu, and
 * two readings of "how many people did this strategy find" drift: the menu
 * would say forty and the page under it thirty-nine. So both pages read it
 * here.
 *
 * What each strategy has produced. The page used to rank strategies by a
 * priority somebody typed and show nothing about how any of them performed. A
 * business running fifteen of these needs the opposite: the one that found
 * four hundred people and booked nothing is a different problem from the one
 * that found nobody at all, and neither is visible from a priority number.
 * Read as two flat queries and reduced here — a count per strategy would be
 * one query per strategy.
 */
export async function loadStrategyMenu(supabase: Client, workspaceId: string) {
  /*
   * Every business this workspace runs, oldest first — not the newest one.
   * Oldest-first matches `loadBusinessProfile`, which is what every writer
   * resolves through: the first business is the one the workspace was set up
   * around, not the one somebody added last night.
   */
  const [{ data: businessRows }, { data: profileRows }, { rows: prospectRows }, { data: campaignRows }] =
    await Promise.all([
      supabase
        .from("business_profiles")
        .select("id, spec, website_url, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      supabase
        .from("customer_profiles")
        .select(
          "id, name, spec, priority, approved_at, do_not_pursue, cta_kind, cta_label, cta_url, business_profile_id",
        )
        .eq("workspace_id", workspaceId)
        .order("priority", { ascending: true }),
      // Paged: a plain select stops at the thousandth row without saying so, and
      // a strategy past it reported fewer people found than it had.
      fetchAllRows<{ customer_profile_id: string | null; last_contacted_at: string | null }>((from, to) =>
        supabase
          .from("prospects")
          .select("customer_profile_id, last_contacted_at")
          .eq("workspace_id", workspaceId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      supabase.from("campaigns").select("customer_profile_id, status").eq("workspace_id", workspaceId),
    ]);

  const yieldByStrategy = new Map<string, StrategyYield>();
  const bucket = (id: string | null) => {
    if (!id) return null;
    const existing = yieldByStrategy.get(id) ?? { found: 0, contacted: 0, campaigns: 0, running: 0 };
    yieldByStrategy.set(id, existing);
    return existing;
  };
  for (const row of prospectRows) {
    const entry = bucket(row.customer_profile_id);
    if (!entry) continue;
    entry.found += 1;
    if (row.last_contacted_at) entry.contacted += 1;
  }
  for (const row of campaignRows ?? []) {
    const entry = bucket(row.customer_profile_id);
    if (!entry) continue;
    entry.campaigns += 1;
    if (row.status === "running") entry.running += 1;
  }

  return {
    businesses: (businessRows ?? []) as BusinessRow[],
    profiles: (profileRows ?? []) as StrategyMenuRow[],
    yieldByStrategy,
  };
}

/**
 * What to call a business in a tab.
 *
 * `spec.companyName` rather than a column: the name is already a field on the
 * profile the agent wrote, and a second place to store it is a second place
 * for it to be wrong. The host of the site it was read from is the fallback,
 * because that is the one thing a rep certainly recognises.
 */
export function businessLabel(row: { spec: unknown; website_url: string | null }): string {
  const spec = row.spec as { companyName?: unknown } | null;
  if (typeof spec?.companyName === "string" && spec.companyName.trim()) return spec.companyName;
  if (row.website_url) return row.website_url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  return "Untitled business";
}

/** Where a strategy stands, in the words the menu and its page both use. */
export function strategyState(row: { approved_at: string | null; do_not_pursue: boolean }): "approved" | "waiting" | "set aside" {
  if (row.do_not_pursue) return "set aside";
  return row.approved_at ? "approved" : "waiting";
}

/** A strategy's name, or what to call one Sage wrote without a name. */
export function strategyName(row: { name: string | null }): string {
  return row.name?.trim() || "Unnamed strategy";
}
