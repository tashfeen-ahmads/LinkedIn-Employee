import type { Db } from "./client.js";
import type { BusinessProfileRow } from "./database.types.js";

/**
 * Which business a workspace is acting for.
 *
 * `business_profiles` has always been one-to-many on `workspace_id` — the
 * column and its index are in migration 0001, and `customer_profiles` carries
 * a `business_profile_id` — so the schema has always allowed a workspace to
 * run several businesses. The code never did.
 *
 * Five separate places resolved "the" business profile by writing
 * `where workspace_id = X order by created_at desc limit 1`, which means the
 * most recently created one. With one row that is correct and invisible. With
 * two it is a coin toss settled by insertion order: `writeWorkspacePitch`,
 * `writeHooks` and `rewriteNotes` would each write copy for whichever business
 * happened to be newest, and offer it for approval as though it had come from
 * somewhere. A sixth place used `maybeSingle()`, which does not pick at all —
 * PostgREST returns PGRST116 for more than one row, so the agent test would
 * stop working outright the moment a second business existed.
 *
 * So there is one definition, and it takes the id when the caller knows it.
 * `targeting.ts` already did the right thing — it reads the business through
 * the strategy that produced the prospect (`profileRow.business_profile_id`),
 * which is the only chain that stays correct when a workspace has several.
 * Everything that knows its strategy should pass the id; what genuinely acts
 * for the whole workspace falls back to the oldest, which is the one the
 * workspace was set up with rather than the one somebody added last night.
 */

export async function loadBusinessProfile(
  db: Db,
  workspaceId: string,
  businessProfileId?: string | null,
): Promise<BusinessProfileRow | null> {
  if (businessProfileId) {
    const { data } = await db
      .from("business_profiles")
      .select("id, workspace_id, website_url, spec, approved_at, created_at")
      .eq("id", businessProfileId)
      // Scoped to the workspace as well as the id. The id arrives from a row
      // this workspace owns, but a query that trusts an id alone is one
      // mistake away from reading another tenant's business (the worker runs
      // as the service role, so RLS will not save it).
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (data) return data as BusinessProfileRow;
    // Falling through rather than returning null: a strategy pointing at a
    // business that has been deleted should still let the workspace write
    // copy, and reporting "tell us what you sell" to somebody who already has
    // would send them to fix a thing that is not broken.
  }

  const { data } = await db
    .from("business_profiles")
    .select("id, workspace_id, website_url, spec, approved_at, created_at")
    .eq("workspace_id", workspaceId)
    // Oldest, deliberately. "Newest" makes adding a second business silently
    // re-point every workspace-wide writer at it; the first one is the
    // business the workspace was set up around.
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as BusinessProfileRow | null) ?? null;
}

/** Every business a workspace runs, oldest first, for a picker or a count. */
export async function listBusinessProfiles(
  db: Db,
  workspaceId: string,
): Promise<BusinessProfileRow[]> {
  const { data } = await db
    .from("business_profiles")
    .select("id, workspace_id, website_url, spec, approved_at, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  return (data ?? []) as BusinessProfileRow[];
}
