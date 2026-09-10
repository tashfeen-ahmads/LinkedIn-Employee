import { buildCampaign, scoreProspects } from "@le/agents";
import {
  BusinessProfileSchema,
  CustomerProfileSchema,
  LINKEDIN_LIMITS,
  matchExclusion,
  normalizeLinkedInUrl,
} from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { loadExclusions } from "../exclusions.js";
import type { TargetingJob } from "../queues.js";

const MIN_FIT_TO_QUEUE = 60;

/**
 * Agent 2 as a job. Searches, dedupes against everything the workspace has
 * already touched, scores, and writes a draft campaign with its prospect list.
 * The campaign is left in `draft`: a human reviews the list and the copy, then
 * launches it.
 */
export async function runTargetingJob(ctx: WorkerContext, job: TargetingJob): Promise<string | null> {
  const { db } = ctx;

  const { data: profileRow } = await db
    .from("customer_profiles")
    .select("id, spec, business_profile_id, do_not_pursue, approved_at")
    .eq("id", job.customerProfileId)
    .single();
  if (!profileRow || profileRow.do_not_pursue) return null;

  // The Strategy Agent writes profiles; it does not approve them. Searching
  // LinkedIn against a description of a customer nobody has read is how a
  // campaign ends up aimed at the wrong market, and the search itself costs
  // Sales Navigator credits.
  if (!profileRow.approved_at) return null;

  const profile = CustomerProfileSchema.parse(profileRow.spec);

  const { data: businessRow } = await db
    .from("business_profiles")
    .select("spec")
    .eq("id", profileRow.business_profile_id)
    .single();
  const business = BusinessProfileSchema.parse(businessRow?.spec);

  const { data: account } = await db
    .from("linkedin_accounts")
    .select("id, provider_account_id, status, has_sales_navigator")
    .eq("id", job.linkedinAccountId)
    .single();
  if (!account?.provider_account_id || account.status !== "active") return null;

  // Sales Navigator is a separate paid seat, and searching a tier the account
  // does not have returns nothing at all — which reads on screen as "your
  // customer profile matched nobody" rather than "you are not subscribed".
  // The column already existed and nothing read it.
  const searchTier = account.has_sales_navigator ? "sales_navigator" : "classic";
  const page = await ctx.linkedin.searchProspects({
    accountId: account.provider_account_id,
    query: profile.salesNavFilters,
    limit: job.limit,
    tier: searchTier,
  });

  // Anyone this workspace already knows about is excluded, whichever rep owns
  // them. This is the cross-rep duplicate prevention promised in the spec.
  const known = await loadKnownUrls(ctx, job.workspaceId, page.items.map((c) => c.linkedinUrl));
  const unknown = page.items.filter((c) => !known.has(normalizeLinkedInUrl(c.linkedinUrl)));

  // The shared exclusion list, applied before the scoring model sees anyone.
  // The send-time check in linkedin-action.ts is the one that has to be right;
  // this one keeps off-limits accounts out of the campaign a human reviews, and
  // out of the model spend.
  const exclusions = await loadExclusions(db, job.workspaceId);
  const fresh = unknown.filter(
    (c) => !matchExclusion(exclusions, { company: c.company, linkedinUrl: c.linkedinUrl }),
  );
  if (fresh.length === 0) return null;

  const ranked = await scoreProspects(ctx.agentsFor(job.workspaceId), { profile, candidates: fresh });
  const shortlist = ranked.filter((r) => !r.disqualified && r.fitScore >= MIN_FIT_TO_QUEUE);
  if (shortlist.length === 0) return null;

  const { data: rep } = await db.from("profiles").select("full_name").eq("id", job.userId).single();

  const plan = await buildCampaign(ctx.agentsFor(job.workspaceId), {
    business,
    profile,
    repName: rep?.full_name ?? "the sender",
    dailyInviteCap: Math.min(LINKEDIN_LIMITS.invitesPerDayMax, 20),
  });

  const { data: campaign, error } = await db
    .from("campaigns")
    .insert({
      workspace_id: job.workspaceId,
      customer_profile_id: profile ? profileRow.id : null,
      linkedin_account_id: account.id,
      owner_user_id: job.userId,
      name: plan.name,
      status: "draft",
      connection_note: plan.connectionNote,
      daily_invite_cap: plan.dailyInviteCap,
      stop_conditions: plan.stopConditions as never,
      // Carried on the campaign, not only in the event log, because the person
      // who reviews this list before launching is the one who needs to know
      // the search could not honour part of the profile they approved.
      rules: { searchTier, droppedFilters: page.droppedFilters } as never,
    })
    .select("id")
    .single();
  if (error || !campaign) throw new Error(`could not create campaign: ${error?.message}`);

  await db.from("campaign_steps").insert(
    plan.steps.map((step, index) => ({
      workspace_id: job.workspaceId,
      campaign_id: campaign.id,
      step_number: index + 1,
      delay_days: step.delayDays,
      message: step.message,
    })),
  );

  const { data: insertedProspects } = await db
    .from("prospects")
    .upsert(
      shortlist.map((r) => ({
        workspace_id: job.workspaceId,
        linkedin_url: normalizeLinkedInUrl(r.candidate.linkedinUrl),
        provider_id: r.candidate.providerId,
        first_name: r.candidate.firstName,
        last_name: r.candidate.lastName,
        headline: r.candidate.headline ?? null,
        title: r.candidate.title ?? null,
        company: r.candidate.company ?? null,
        company_size: r.candidate.companySize ?? null,
        industry: r.candidate.industry ?? null,
        location: r.candidate.location ?? null,
        about: r.candidate.about ?? null,
        fit_score: r.fitScore,
        fit_reasons: r.fitReasons as never,
        intent_score: r.intentScore,
        signals: r.candidate.signals as never,
        owner_user_id: job.userId,
      })),
      { onConflict: "workspace_id,linkedin_url" },
    )
    .select("id");

  if (insertedProspects?.length) {
    await db.from("campaign_prospects").insert(
      insertedProspects.map((p) => ({
        workspace_id: job.workspaceId,
        campaign_id: campaign.id,
        prospect_id: p.id,
        status: "queued" as const,
      })),
    );
  }

  await recordEvent(db, {
    workspaceId: job.workspaceId,
    name: "campaign.created",
    actorUserId: job.userId,
    subjectType: "campaign",
    subjectId: campaign.id,
    payload: {
      prospects: insertedProspects?.length ?? 0,
      searched: page.items.length,
      searchTier,
      droppedFilters: page.droppedFilters,
    },
  });

  return campaign.id;
}

/**
 * Which of these candidates the workspace already has.
 *
 * Asks about the candidates rather than downloading every prospect the
 * workspace has ever seen: the old query pulled up to 50,000 rows to filter a
 * page of fifty, so its cost grew with the customer's history rather than with
 * the work being done.
 */
async function loadKnownUrls(
  ctx: WorkerContext,
  workspaceId: string,
  candidateUrls: string[],
): Promise<Set<string>> {
  const normalized = [...new Set(candidateUrls.map(normalizeLinkedInUrl))];
  if (normalized.length === 0) return new Set();

  const { data } = await ctx.db
    .from("prospects")
    .select("linkedin_url")
    .eq("workspace_id", workspaceId)
    .in("linkedin_url", normalized);

  return new Set((data ?? []).map((p) => normalizeLinkedInUrl(p.linkedin_url)));
}
