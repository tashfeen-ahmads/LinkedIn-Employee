import {
  FIRST_STEP_DELAY_DAYS,
  DEFAULT_OPENER_TEMPLATE,
  LINKEDIN_LIMITS,
} from "@le/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Builds a campaign over people this workspace already has.
 *
 * One definition, used by the one-click start on `/app/campaigns` and by the
 * longer form on `/app/campaigns/new`. Two copies of this would drift on the
 * things that matter most — which prospects are eligible, what step 1 waits
 * for — and the copy somebody believes is whichever screen they used.
 *
 * It never launches. The campaign arrives as a draft, because the review
 * before a stranger is written to is the thing this product is built on and a
 * button that skipped it would be a way around it.
 */

export interface BuildCampaignInput {
  workspaceId: string;
  userId: string;
  name: string;
  accountId: string;
  agentId: string | null;
  ctaId: string | null;
  prospectIds: string[];
  followUpDays: number;
}

export interface BuildCampaignResult {
  ok: boolean;
  campaignId?: string;
  reason?: string;
}

export async function buildCampaign(
  supabase: SupabaseClient<never>,
  input: BuildCampaignInput,
): Promise<BuildCampaignResult> {
  if (input.prospectIds.length === 0) return { ok: false, reason: "There is nobody to add." };

  const db = supabase as unknown as {
    from: (table: string) => any;
  };

  /*
   * The agent's own approved opener becomes the campaign's template note.
   *
   * It is the line every prospect falls back to when the writer has not
   * answered for them individually. Without one the fallback is empty and the
   * invitation goes out with no note at all — ordinary on LinkedIn, and not
   * what anybody picking an agent expected to happen.
   *
   * Approved only. An opener nobody has read is the one thing that must never
   * be the first sentence a stranger sees.
   */
  let template = DEFAULT_OPENER_TEMPLATE;
  if (input.agentId) {
    const { data: opener } = await db
      .from("hooks")
      .select("body")
      .eq("agent_id", input.agentId)
      .not("approved_at", "is", null)
      .limit(1);
    if (opener?.[0]?.body?.trim()) template = opener[0].body.trim();
  }

  const { data: cta } = input.ctaId
    ? await db
        .from("ctas")
        .select("kind, label, url")
        .eq("id", input.ctaId)
        .eq("workspace_id", input.workspaceId)
        .maybeSingle()
    : { data: null };

  const { data: campaign, error } = await db
    .from("campaigns")
    .insert({
      workspace_id: input.workspaceId,
      linkedin_account_id: input.accountId,
      owner_user_id: input.userId,
      agent_id: input.agentId,
      name: input.name,
      status: "draft",
      connection_note: template,
      cta_id: input.ctaId,
      cta_kind: cta?.kind ?? "reply",
      cta_label: cta?.label ?? null,
      cta_url: cta?.url ?? null,
      daily_invite_cap: LINKEDIN_LIMITS.invitesPerDayStart,
      stop_conditions: ["prospect replies", "prospect opts out"],
      rules: { builtFrom: "prospect list" },
    })
    .select("id")
    .single();

  if (error || !campaign) {
    return { ok: false, reason: error?.message ?? "The campaign could not be created." };
  }

  // Both steps in one statement. A campaign holding step 1 and not step 2
  // sends a follow-up and then silently stops, and a partial sequence is not a
  // state anybody can see from a screen.
  const { error: stepsError } = await db.from("campaign_steps").insert([
    {
      workspace_id: input.workspaceId,
      campaign_id: campaign.id,
      variant_id: null,
      step_number: 1,
      // Not configurable, and not stored as anything else (rule 43): what
      // precedes step 1 is the acceptance, not a message.
      delay_days: FIRST_STEP_DELAY_DAYS,
      message: "Hi {{first_name}}, thanks for connecting.",
    },
    {
      workspace_id: input.workspaceId,
      campaign_id: campaign.id,
      variant_id: null,
      step_number: 2,
      delay_days: input.followUpDays,
      // A pointer rather than a copy of the words, so improving the agent's
      // offer improves every campaign using it without re-reviewing copy
      // somebody already approved.
      message: "{{pitch}}",
    },
  ]);
  if (stepsError) return { ok: false, reason: stepsError.message };

  const { error: linkError } = await db.from("campaign_prospects").insert(
    input.prospectIds.map((prospectId) => ({
      workspace_id: input.workspaceId,
      campaign_id: campaign.id,
      prospect_id: prospectId,
      status: "queued",
      invite_note: null,
    })),
  );
  if (linkError) return { ok: false, reason: linkError.message };

  return { ok: true, campaignId: campaign.id };
}

/**
 * Everybody this workspace may still write to.
 *
 * Never-contacted only, because nobody is approached twice under a different
 * pretext (rule 24), and never anyone on the do-not-contact list. The send
 * path checks both again immediately before the invitation — two campaigns
 * built from the same list can legitimately queue the same person — but
 * offering somebody here that the send will refuse is a list that lies.
 */
export async function eligibleProspects(
  supabase: SupabaseClient<never>,
  workspaceId: string,
  limit = 200,
): Promise<Array<{ id: string; first_name: string | null; last_name: string | null; company: string | null; title: string | null; fit_score: number | null }>> {
  const db = supabase as unknown as { from: (table: string) => any };
  const { data } = await db
    .from("prospects")
    .select("id, first_name, last_name, company, title, fit_score")
    .eq("workspace_id", workspaceId)
    .is("last_contacted_at", null)
    .eq("do_not_contact", false)
    .order("fit_score", { ascending: false, nullsFirst: false })
    .limit(limit);
  return data ?? [];
}
