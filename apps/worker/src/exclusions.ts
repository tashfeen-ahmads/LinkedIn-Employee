import type { ExclusionRule } from "@le/shared";
import type { Db } from "@le/db";

/**
 * Loads a workspace's exclusion list. Read fresh at every send rather than
 * cached: the whole point is that a manager can add an account at 10am and have
 * the 10:05 invitation to that account not go out.
 */
export async function loadExclusions(db: Db, workspaceId: string): Promise<ExclusionRule[]> {
  const { data } = await db
    .from("exclusions")
    .select("kind, value, raw_value, reason")
    .eq("workspace_id", workspaceId);

  return (data ?? []).map((row) => ({
    kind: row.kind,
    value: row.value,
    rawValue: row.raw_value,
    reason: row.reason,
  }));
}
