import type { Db } from "@le/db";

/**
 * The pitch a particular prospect hears.
 *
 * Their angle's, if it has one; otherwise the workspace default. That is rule
 * 28's rule applied to the offer: an angle owns its prospect end to end, and a
 * prospect assigned no angle is not an edge case — the campaign-wide steps are
 * already their whole sequence, and the default pitch is already their whole
 * offer.
 *
 * Approved or nothing, in both cases. An unapproved pitch is a line the agent
 * wrote and nobody read, and sending it would make the approval screen
 * decorative — which is the one thing a review screen cannot survive.
 */
export async function pitchFor(
  db: Db,
  workspaceId: string,
  variantId: string | null | undefined,
): Promise<string | null> {
  if (variantId) {
    const { data: variant } = await db
      .from("campaign_variants")
      .select("pitch_id")
      .eq("id", variantId)
      .maybeSingle();
    if (variant?.pitch_id) {
      const { data } = await db
        .from("pitches")
        .select("body, approved_at")
        .eq("id", variant.pitch_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      // Falls through to the default when this angle's own pitch is not
      // approved. The alternative is silence from a campaign that is otherwise
      // ready, and the default is copy a person approved for exactly this.
      if (data?.approved_at && data.body?.trim()) return data.body.trim();
    }
  }

  const { data } = await db
    .from("pitches")
    .select("body, approved_at")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .maybeSingle();
  if (!data?.approved_at) return null;
  return data.body?.trim() || null;
}
