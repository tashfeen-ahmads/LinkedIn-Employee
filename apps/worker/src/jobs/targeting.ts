import { buildCampaign, personalizeInvites, scoreProspects } from "@le/agents";
import type { ProspectCandidate } from "@le/shared";
import {
  BusinessProfileSchema,
  CustomerProfileSchema,
  LINKEDIN_LIMITS,
  assignVariants,
  isPublicProfileUrl,
  matchExclusion,
  normalizeLinkedInUrl,
} from "@le/shared";
import { isAccountGone } from "@le/linkedin";
import { markAccountGone } from "../accounts.js";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { loadExclusions } from "../exclusions.js";
import type { TargetingJob } from "../queues.js";

const MIN_FIT_TO_QUEUE = 60;

/**
 * Stamped on every `targeting.stopped` event.
 *
 * Three separate rounds of this were spent unable to tell whether a report came
 * from the build that was meant to fix it or the one before, because both
 * emitted the same sentences. A report that cannot identify the code that
 * produced it is a report that costs a deploy to interpret. Bump it whenever
 * the search behaviour changes.
 */
const TARGETING_BUILD = "2026-09-17.continuable-search";

/**
 * Why the job stopped, written where anyone can read it.
 *
 * Every exit below used to be a bare `return null`. The rep pressed "find
 * prospects", the queue accepted the job, the job decided there was nothing to
 * do, and the screen showed the same empty state as before — identical whether
 * the search matched nobody, the account was not connected, or the profile was
 * never approved. Three different things to do about it and no way to tell
 * which, which is exactly the report that brought this to light.
 */
async function giveUp(
  ctx: WorkerContext,
  job: TargetingJob,
  reason: string,
  detail: Record<string, unknown> = {},
): Promise<null> {
  console.error("targeting stopped", { reason, ...detail });
  await recordEvent(ctx.db, {
    workspaceId: job.workspaceId,
    name: "targeting.stopped",
    actorUserId: job.userId,
    subjectType: "customer_profile",
    subjectId: job.customerProfileId,
    // Named on every stop, so the campaign screen can find the report for the
    // press somebody just made rather than the last one anywhere.
    payload: { reason, build: TARGETING_BUILD, campaignId: job.campaignId ?? null, ...detail },
  });
  return null;
}


/**
 * Agent 2 as a job. Searches, dedupes against everything the workspace has
 * already touched, scores, and writes a draft campaign with its prospect list.
 * The campaign is left in `draft`: a human reviews the list and the copy, then
 * launches it.
 */
export async function runTargetingJob(ctx: WorkerContext, job: TargetingJob): Promise<string | null> {
  try {
    return await targeting(ctx, job);
  } catch (err) {
    // Every deliberate exit from this job says why. A throw does not, and this
    // job has several: a customer profile whose stored spec no longer matches
    // its schema, a campaign insert the database refuses, a provider error
    // outside the search. BullMQ catches those, retries, gives up, and the
    // person who pressed the button sees the page they were already looking
    // at -- no banner, no event, nothing at all. That silence is worse than
    // any of the failures behind it, because it looks exactly like a button
    // that is not wired up.
    const reason = (err as { message?: string })?.message ?? "unknown";
    console.error("targeting failed", { workspaceId: job.workspaceId, reason });
    await recordEvent(ctx.db, {
      workspaceId: job.workspaceId,
      name: "targeting.stopped",
      actorUserId: job.userId,
      subjectType: "customer_profile",
      subjectId: job.customerProfileId,
      payload: {
        reason: `The Targeting Agent hit an error: ${reason}`,
        build: TARGETING_BUILD,
        campaignId: job.campaignId ?? null,
        threw: true,
      },
    });
    throw err;
  }
}

async function targeting(ctx: WorkerContext, job: TargetingJob): Promise<string | null> {
  const { db } = ctx;

  // A continuation names a campaign and takes everything else off its row: the
  // profile it was built from, the account that searched, and the position the
  // last run reached. Reading those from the request instead would let a
  // caller graft one campaign's list onto another profile's search.
  let continuing: CampaignPosition | null = null;
  if (job.campaignId) {
    const { data: row } = await db
      .from("campaigns")
      .select("id, customer_profile_id, linkedin_account_id, connection_note, search_cursor, search_exhausted")
      .eq("id", job.campaignId)
      .eq("workspace_id", job.workspaceId)
      .maybeSingle();
    if (!row) return giveUp(ctx, job, "That campaign no longer exists.");
    if (!row.customer_profile_id) {
      return giveUp(
        ctx,
        job,
        "The customer profile this campaign was built from has been deleted, so there is nothing left to search for.",
      );
    }
    if (row.search_exhausted) {
      // Different from finding nobody new. LinkedIn has been read to the end
      // of this profile, and pressing again would re-read the first page and
      // report every person on it as already known.
      return giveUp(ctx, job, "This search has reached the end of what LinkedIn will return for this profile.", {
        campaignId: row.id,
      });
    }
    continuing = row as CampaignPosition;
  }

  const customerProfileId = continuing?.customer_profile_id ?? job.customerProfileId;
  const linkedinAccountId = continuing?.linkedin_account_id ?? job.linkedinAccountId;

  const { data: profileRow } = await db
    .from("customer_profiles")
    .select("id, spec, business_profile_id, do_not_pursue, approved_at")
    .eq("id", customerProfileId)
    .single();
  if (!profileRow) return giveUp(ctx, job, "That customer profile no longer exists.");
  if (profileRow.do_not_pursue) {
    return giveUp(ctx, job, "That customer profile is marked do-not-pursue.");
  }

  // The Strategy Agent writes profiles; it does not approve them. Searching
  // LinkedIn against a description of a customer nobody has read is how a
  // campaign ends up aimed at the wrong market, and the search itself costs
  // Sales Navigator credits.
  if (!profileRow.approved_at) {
    return giveUp(ctx, job, "That customer profile has not been approved yet.");
  }

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
    .eq("id", linkedinAccountId)
    .single();
  if (!account?.provider_account_id || account.status !== "active") {
    return giveUp(ctx, job, "The LinkedIn account is not connected and active.", {
      status: account?.status ?? "missing",
      hasProviderId: Boolean(account?.provider_account_id),
    });
  }

  // Sales Navigator is a separate paid seat, and searching a tier the account
  // does not have returns nothing at all — which reads on screen as "your
  // customer profile matched nobody" rather than "you are not subscribed".
  // The column already existed and nothing read it.
  const searchTier = account.has_sales_navigator ? "sales_navigator" : "classic";
  let page;
  try {
    page = await ctx.linkedin.searchProspects({
      accountId: account.provider_account_id,
      query: profile.salesNavFilters,
      limit: job.limit,
      tier: searchTier,
      ...(continuing?.search_cursor ? { cursor: continuing.search_cursor } : {}),
    });
  } catch (err) {
    // A throw here is retried by the queue and then given up on, all of it out
    // of sight. The rep sees a button that did nothing, which is the same thing
    // they see when the search legitimately matches nobody.
    //
    // One of these is theirs to fix and the rest are not, so it is said
    // separately: "the provider refused the search" sounds like LinkedIn
    // having a bad day, and a connected account the provider no longer has is
    // a Reconnect button away from working.
    if (isAccountGone(err)) {
      // Said on the Team page as well as here. Pointing someone at a screen
      // that still reads "Connected · active" is not telling them anything.
      await markAccountGone(db, { id: account.id, workspace_id: job.workspaceId });
      return giveUp(ctx, job, "LinkedIn's provider no longer has this account. Reconnect it on the Team page.", {
        searchTier,
        cause: (err as { message?: string })?.message ?? "unknown",
      });
    }
    return giveUp(ctx, job, "LinkedIn's provider refused the search.", {
      searchTier,
      cause: (err as { message?: string })?.message ?? "unknown",
    });
  }

  // Written before anything else can stop the run, and whatever the run finds.
  //
  // A page read is a page spent: those profiles came off a seat somebody pays
  // for, and LinkedIn will not hand them back a second time except by handing
  // back the same page. If the position only moved on a run that produced
  // prospects, then a run whose fifty people were all already known -- the
  // common case once a campaign is a few hundred deep -- would leave the
  // campaign parked on that page, and every future press would read it again.
  // "Find more" would go permanently dead at the first repeat page.
  if (continuing) await rememberPosition(ctx, job, continuing.id, page.cursor);

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
  if (fresh.length === 0) {
    // A search that reaches LinkedIn and comes back with nobody, at the widest
    // setting this product will go to, is not an answer LinkedIn really gives.
    // It means a field in the request is silently matching nothing, and working
    // out which one by editing code and asking somebody to press a button is a
    // round trip per guess.
    //
    // So the probe runs here, attached to the report nobody has to go looking
    // for. Whoever is stuck is already reading this event; the answer belongs
    // in it. Only when the provider returned literally nothing -- a list that
    // was filtered down to nobody is a different problem and needs no probe.
    const probe =
      page.items.length === 0 ? await probeProvider(ctx, account.provider_account_id) : undefined;

    // The three reasons a page of results yields nobody are completely
    // different problems, so they are counted separately rather than reported
    // as one empty list.
    //
    // A page of people we already have is the one that is not a problem at
    // all, and reads exactly like the ones that are. It is what a repeated
    // search over a profile a campaign has already worked through looks like,
    // and the answer to it is to read further, not to change anything.
    const reason = wholePageKnown(page, unknown)
      ? nothingNewYet(continuing, page)
      : "The search returned nobody new to contact.";
    return giveUp(ctx, job, reason, {
      ...(probe ? { probe } : {}),
      searchTier,
      returnedByProvider: page.items.length,
      alreadyKnown: page.items.length - unknown.length,
      excluded: unknown.length - fresh.length,
      droppedFilters: page.droppedFilters,
      // Usually the answer. A search whose every location and industry was
      // left out is a search for a job title anywhere on earth, or for
      // nothing at all.
      filterNotes: page.filterNotes ?? [],
    });
  }

  // Nobody enters a campaign who cannot be opened and checked first.
  //
  // LinkedIn hides a profile's public address from anyone outside the viewer's
  // network, so a real person can arrive here with no link to them. They are
  // not fake — but an invitation is spent from a capped daily allowance, it
  // carries restriction risk for the account sending it, and a reviewer who
  // cannot open the profile cannot do the one job the review exists for. A
  // list nobody can verify is not a list worth launching.
  //
  // Resolving is tried before dropping: the profile endpoint usually knows the
  // public identifier the search result omitted, which turns a real person into
  // a usable prospect rather than discarding them.
  const { verified, unverifiable } = await verifyProfiles(
    ctx,
    account.provider_account_id,
    fresh,
  );

  if (verified.length === 0) {
    return giveUp(ctx, job, "Nobody found had a profile that can be opened and checked.", {
      searchTier,
      returnedByProvider: page.items.length,
      unverifiable,
    });
  }

  const ranked = await scoreProspects(ctx.agentsFor(job.workspaceId), { profile, candidates: verified });
  const shortlist = ranked.filter((r) => !r.disqualified && r.fitScore >= MIN_FIT_TO_QUEUE);
  if (shortlist.length === 0) {
    return giveUp(ctx, job, `Nobody scored above the minimum fit of ${MIN_FIT_TO_QUEUE}.`, {
      scored: ranked.length,
      disqualified: ranked.filter((r) => r.disqualified).length,
      bestScore: ranked.reduce((best, r) => Math.max(best, r.fitScore), 0),
    });
  }

  const { data: rep } = await db.from("profiles").select("full_name").eq("id", job.userId).single();
  const repName = rep?.full_name ?? "the sender";

  // Continuing a list adds people to it. The copy, the steps and the angle are
  // the ones a human already read and approved — rewriting them because the
  // list grew would change what everybody already queued is about to receive,
  // silently, at the moment somebody asked for more names.
  if (continuing) {
    const added = await attachProspects(ctx, job, {
      campaignId: continuing.id,
      customerProfileId: profileRow.id,
      campaignAngle: continuing.connection_note,
      business,
      profile,
      repName,
      shortlist,
    });
    await recordEvent(db, {
      workspaceId: job.workspaceId,
      name: "campaign.extended",
      actorUserId: job.userId,
      subjectType: "campaign",
      subjectId: continuing.id,
      payload: {
        campaignId: continuing.id,
        added,
        searched: page.items.length,
        alreadyKnown: page.items.length - unknown.length,
        searchTier,
        exhausted: page.cursor === null,
      },
    });
    return continuing.id;
  }

  const plan = await buildCampaign(ctx.agentsFor(job.workspaceId), {
    business,
    profile,
    repName,
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
      rules: {
        searchTier,
        droppedFilters: page.droppedFilters,
        filterNotes: page.filterNotes ?? [],
      } as never,
    })
    .select("id")
    .single();
  if (error || !campaign) throw new Error(`could not create campaign: ${error?.message}`);

  // The angles this campaign will test against each other. Created with the
  // campaign, not later: a variant added after people are already assigned
  // starts with a deficit the rotation then spends the next batch correcting,
  // and the comparison is skewed by the order somebody clicked in.
  // `?? []` and not an assertion: the schema requires two or three, so this is
  // always populated in production. But a campaign that cannot store its
  // angles must still be a campaign — losing the test is better than losing
  // the list, the copy and the search position with it.
  const plannedVariants = plan.variants ?? [];
  const { data: variantRows } = await db
    .from("campaign_variants")
    .insert(
      plannedVariants.map((variant) => ({
        workspace_id: job.workspaceId,
        campaign_id: campaign.id,
        name: variant.name,
        angle: variant.angle,
        pain_point: variant.painPoint,
        connection_note: variant.connectionNote,
        // Written rather than left to the column default. The default is real,
        // but code that depends on one is code the in-memory database cannot
        // model, and a test that silently reads `enabled` as absent assigns
        // nobody to anything while passing.
        enabled: true,
      })),
    )
    .select("id, name, angle, connection_note");
  if (plannedVariants.length && !variantRows?.length) {
    // Not fatal. A campaign with no variants behaves exactly as every campaign
    // did before they existed: one angle, the campaign's own note. Losing the
    // test is better than losing the campaign.
    console.error("could not store campaign variants", { campaignId: campaign.id });
  }

  // The campaign's own sequence, and one per angle.
  //
  // The campaign-wide steps (variant_id null) are not a leftover: they are what
  // a prospect receives when no angle was assigned, which is every campaign
  // built before angles existed and every campaign whose angles could not be
  // stored. Inserted in one statement so a partial sequence is not possible —
  // a campaign holding step 1 and step 3 sends a follow-up and then silently
  // stops.
  const variantIdByName = new Map((variantRows ?? []).map((v) => [v.name, v.id]));
  await db.from("campaign_steps").insert([
    ...plan.steps.map((step, index) => ({
      workspace_id: job.workspaceId,
      campaign_id: campaign.id,
      variant_id: null,
      step_number: index + 1,
      delay_days: step.delayDays,
      message: step.message,
    })),
    ...plannedVariants.flatMap((variant) => {
      const variantId = variantIdByName.get(variant.name);
      if (!variantId) return [];
      return (variant.steps ?? []).map((step, index) => ({
        workspace_id: job.workspaceId,
        campaign_id: campaign.id,
        variant_id: variantId,
        step_number: index + 1,
        delay_days: step.delayDays,
        message: step.message,
      }));
    }),
  ]);

  const attached = await attachProspects(ctx, job, {
    campaignId: campaign.id,
    customerProfileId: profileRow.id,
    campaignAngle: plan.connectionNote,
    business,
    profile,
    repName,
    shortlist,
  });

  // Where the search stopped, so the next press reads past it rather than
  // re-reading the page this campaign was built from.
  await rememberPosition(ctx, job, campaign.id, page.cursor);

  await recordEvent(db, {
    workspaceId: job.workspaceId,
    name: "campaign.created",
    actorUserId: job.userId,
    subjectType: "campaign",
    subjectId: campaign.id,
    payload: {
      prospects: attached,
      searched: page.items.length,
      searchTier,
      droppedFilters: page.droppedFilters,
      filterNotes: page.filterNotes ?? [],
    },
  });

  return campaign.id;
}

/**
 * Whether the provider answered with people and every one of them was somebody
 * this workspace already has.
 */
function wholePageKnown(page: { items: unknown[] }, unknown: unknown[]): boolean {
  return page.items.length > 0 && unknown.length === 0;
}

/**
 * What to say when a run read a full page and knew everybody on it.
 *
 * Not a failure, and it must not read like one. A continuation has already
 * moved past that page, so the useful instruction is to press again; a fresh
 * search has not, and pressing the same button would re-read the same page for
 * ever, so it points at the campaign that can read further instead.
 */
function nothingNewYet(continuing: CampaignPosition | null, page: { cursor: string | null }): string {
  if (!continuing) {
    return "Everyone LinkedIn returned is already on your prospect list. Open the campaign built from this profile and use Find more, which reads past the page this search keeps landing on.";
  }
  return page.cursor
    ? "Everyone on this page is already on your prospect list. The search has moved past them — press Find more again to read the next page."
    : "Everyone on this page is already on your prospect list, and that was the last page LinkedIn will return for this profile.";
}

/**
 * The prospects to write for, split by the angle each was assigned.
 *
 * One group per angle, plus one for anybody unassigned — which is every
 * prospect on a campaign built before variants existed, and the whole campaign
 * when the variant insert failed. That group keeps the campaign's own note as
 * its angle, so a campaign without variants writes exactly as it always did.
 */
function groupByAngle(
  insertedProspects: Array<{ id: string }>,
  variantByProspectId: Map<string, { id: string; angle: string } | null>,
  providerIdByProspectId: Map<string, string>,
  input: { campaignAngle: string; shortlist: Array<{ candidate: ProspectCandidate }> },
): Array<{ angle: string; prospects: ProspectCandidate[] }> {
  const candidateByProviderId = new Map(input.shortlist.map((r) => [r.candidate.providerId, r.candidate]));
  const groups = new Map<string, { angle: string; prospects: ProspectCandidate[] }>();

  for (const p of insertedProspects) {
    const candidate = candidateByProviderId.get(providerIdByProspectId.get(p.id) ?? "");
    if (!candidate) continue;
    const variant = variantByProspectId.get(p.id) ?? null;
    const key = variant?.id ?? "none";
    const group = groups.get(key) ?? { angle: variant?.angle ?? input.campaignAngle, prospects: [] };
    group.prospects.push(candidate);
    groups.set(key, group);
  }

  return [...groups.values()];
}

/**
 * A campaign being added to, and where its search had reached.
 */
interface CampaignPosition {
  id: string;
  customer_profile_id: string;
  linkedin_account_id: string;
  connection_note: string;
  search_cursor: string | null;
  search_exhausted: boolean;
}

/**
 * Stores where the search stopped, and whether there is anywhere left to go.
 *
 * A null cursor here means the provider has nothing further for this profile,
 * which is not the same as a run finding nobody new: one is the end of
 * LinkedIn's answer and the other is a page of people we already had. The
 * screen has to tell those apart or it either offers a button that cannot work
 * or hides one that would have.
 */
async function rememberPosition(
  ctx: WorkerContext,
  job: TargetingJob,
  campaignId: string,
  cursor: string | null,
): Promise<void> {
  const { error } = await ctx.db
    .from("campaigns")
    .update({
      search_cursor: cursor,
      search_exhausted: cursor === null,
      searched_at: new Date().toISOString(),
    })
    .eq("id", campaignId)
    .eq("workspace_id", job.workspaceId);

  // Loud, and never fatal. The prospects this run found are already stored and
  // are the thing the person asked for; losing the position costs one repeated
  // page on the next press, and throwing here would throw them away instead.
  if (error) console.error("could not store the search position", { campaignId, reason: error.message });
}

/**
 * Writes a shortlist into `prospects` and onto a campaign, with a note per
 * person. Returns how many people were added.
 *
 * Shared by the run that creates a campaign and the run that adds to one,
 * because they differ in exactly one thing — where the angle comes from — and
 * the personalisation, the provider-id matching and the upsert are the part
 * that must not drift between them.
 */
async function attachProspects(
  ctx: WorkerContext,
  job: TargetingJob,
  input: {
    campaignId: string;
    /**
     * The strategy whose search found these people.
     *
     * Recorded on the prospect, not only on the campaign, because a prospect
     * outlives every campaign it appears in — and because a fit score is only
     * meaningful against the customer profile it was scored for. Storing the
     * number without the thing it was scored against leaves a ranking nobody
     * can interpret.
     */
    customerProfileId: string;
    campaignAngle: string;
    business: Parameters<typeof personalizeInvites>[1]["business"];
    profile: Parameters<typeof personalizeInvites>[1]["profile"];
    repName: string;
    shortlist: Array<{ candidate: ProspectCandidate; fitScore: number; fitReasons: unknown; intentScore: number }>;
  },
): Promise<number> {
  const { db } = ctx;

  const { data: insertedProspects } = await db
    .from("prospects")
    .upsert(
      input.shortlist.map((r) => ({
        workspace_id: job.workspaceId,
        customer_profile_id: input.customerProfileId,
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

  if (!insertedProspects?.length) return 0;

  // The angles this campaign is testing, and how many people each already has.
  //
  // Read here rather than passed in, because both callers need the same answer
  // and the continuation path has no plan object to take it from. Counting what
  // is already assigned is what makes "Find more" balanced: a second batch of
  // fifty continues the rotation instead of handing the first angle another
  // even split on top of the one it has.
  const { data: variantRows } = await db
    .from("campaign_variants")
    .select("id, name, angle, connection_note")
    .eq("campaign_id", input.campaignId)
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  const variants = variantRows ?? [];

  const { data: alreadyAssigned } = await db
    .from("campaign_prospects")
    .select("variant_id")
    .eq("campaign_id", input.campaignId);
  const assignedSoFar = new Map<string, number>();
  for (const row of alreadyAssigned ?? []) {
    if (row.variant_id) assignedSoFar.set(row.variant_id, (assignedSoFar.get(row.variant_id) ?? 0) + 1);
  }

  // Fixed here, at list-build time, and never reassigned. A human reviews this
  // list before it launches and has to be able to see which person is getting
  // which angle; and reassigning after a send would attribute an outcome to an
  // angle that did not produce it, which is the one way a test is worse than
  // no test.
  const assignment = assignVariants(variants, insertedProspects.length, assignedSoFar);
  const variantByProspectId = new Map<string, (typeof variants)[number] | null>();
  for (const [index, p] of insertedProspects.entries()) {
    variantByProspectId.set(p.id, assignment[index] ?? null);
  }

  // One note per person, written from that person's own details.
  //
  // Done here rather than at send time for two reasons. A human reviews and
  // launches the campaign, and they cannot review copy that does not exist
  // yet. And a send-time model call sits on the path of an action the rate
  // limiter has already scheduled, where a slow or failed response becomes a
  // missed send rather than a visible problem.
  //
  // The upsert above returns ids in the order it was given, so the shortlist
  // and the inserted rows line up — but "lines up" is an assumption that
  // breaks silently, so the note is matched by provider id instead.
  // A writer outage degrades a campaign; it does not strand the people in it.
  //
  // `inviteNote` already falls back to the campaign template when a prospect
  // has no personalised note — that is rule 16, and it is the whole reason the
  // fallback exists. But letting this call throw walked straight past it: the
  // prospects were written a few lines above, the exception unwound the run
  // before `campaign_prospects` was touched, and the result was people in the
  // workspace who belong to no campaign at all.
  //
  // Which is worse than it sounds, because a `prospects` row is what enforces
  // "never contact anybody twice". Every one of those people is now excluded
  // from every future search, permanently, on the strength of an outreach that
  // never happened. Forty-nine real people went that way on this deployment,
  // over two failed runs, and nothing anywhere said so.
  let notes = new Map<string, Awaited<ReturnType<typeof personalizeInvites>> extends Map<string, infer V> ? V : never>();
  let writerFailed: string | null = null;
  try {
    // One call per angle rather than one for everybody. The angle is the
    // variable under test, so a single call covering all of them would have the
    // writer choosing which to lean on per person — and the group labels would
    // then describe an assignment nobody made. It also caches better: the angle
    // is the stable half of the prompt.
    const providerIdByProspectId = new Map(
      insertedProspects.map((p, index) => [p.id, input.shortlist[index]?.candidate.providerId ?? ""]),
    );
    const groups = groupByAngle(insertedProspects, variantByProspectId, providerIdByProspectId, input);

    for (const group of groups) {
      const written = await personalizeInvites(ctx.agentsFor(job.workspaceId), {
        business: input.business,
        profile: input.profile,
        repName: input.repName,
        campaignAngle: group.angle,
        prospects: group.prospects,
      });
      for (const [providerId, note] of written) notes.set(providerId, note);
    }
  } catch (err) {
    // Degraded, and said out loud. Silently sending everyone the template is
    // the other way this goes wrong: the review screen would show a campaign
    // that looks personalised and is not.
    writerFailed = (err as { message?: string })?.message ?? "unknown";
    console.error("the invite writer failed; falling back to the campaign template", {
      campaignId: input.campaignId,
      reason: writerFailed,
    });
  }

  const providerIdByProspectId = new Map<string, string>();
  for (const [index, p] of insertedProspects.entries()) {
    const candidate = input.shortlist[index]?.candidate;
    if (candidate) providerIdByProspectId.set(p.id, candidate.providerId);
  }

  await db.from("campaign_prospects").upsert(
    insertedProspects.map((p) => {
      const note = notes.get(providerIdByProspectId.get(p.id) ?? "");
      return {
        workspace_id: job.workspaceId,
        campaign_id: input.campaignId,
        prospect_id: p.id,
        variant_id: variantByProspectId.get(p.id)?.id ?? null,
        status: "queued" as const,
        // Absent is not an error: the send falls back to the campaign
        // template, which is exactly what happened before any of this.
        invite_note: note?.note ?? null,
        invite_note_prompt_version: note?.promptVersion ?? null,
        invite_note_grounding: (note?.grounding ?? []) as never,
        invite_note_thin: note?.tooThin ?? false,
      };
    }),
    // Somebody already on this campaign keeps the row they have. Overwriting it
    // would replace a note a human may have rewritten, and reset a person the
    // campaign has already invited back to `queued` — inviting them twice.
    { onConflict: "campaign_id,prospect_id", ignoreDuplicates: true },
  );

  if (writerFailed) {
    await recordEvent(db, {
      workspaceId: job.workspaceId,
      name: "campaign.notes_missing",
      actorUserId: job.userId,
      subjectType: "campaign",
      subjectId: input.campaignId,
      payload: { reason: writerFailed, prospects: insertedProspects.length },
    });
  }

  return insertedProspects.length;
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

/**
 * Which parts of a classic search body LinkedIn honours, asked all at once.
 *
 * A diagnostic rather than a feature: it runs only when a search has already
 * come back empty, asks for one result per probe, and never stops the job. The
 * row that matters most is the one with no filters at all — if even that
 * returns nobody, the problem is the account or the subscription and no amount
 * of query fixing will touch it.
 */
async function probeProvider(
  ctx: WorkerContext,
  accountId: string,
): Promise<Record<string, string> | undefined> {
  const provider = ctx.linkedin as {
    probeSearch?: (id: string) => Promise<Array<{ label: string; count: number | null; error?: string }>>;
  };
  if (typeof provider.probeSearch !== "function") return undefined;

  try {
    const rows = await provider.probeSearch(accountId);
    return Object.fromEntries(
      rows.map((r) => [r.label, r.error ? `refused: ${r.error}` : `${r.count}`]),
    );
  } catch (err) {
    // A probe that fails is worth reporting too: it is the same provider the
    // search just used.
    return { probeFailed: (err as { message?: string })?.message ?? "unknown" };
  }
}

/**
 * How many profiles can be opened, and by whom.
 *
 * A search result carries a public identifier for people in or near the
 * viewer's network and omits it for everyone else. The profile endpoint
 * usually has it, so it is asked once per candidate that arrived without one —
 * an extra request each, spent only on people who would otherwise be thrown
 * away.
 *
 * Anyone still without a public address after that is dropped, not hidden. The
 * cost of keeping them is an invitation from a capped daily allowance, aimed by
 * a reviewer who could not open the profile to check who they were aiming at.
 */
async function verifyProfiles(
  ctx: WorkerContext,
  accountId: string,
  candidates: ProspectCandidate[],
): Promise<{ verified: ProspectCandidate[]; unverifiable: number }> {
  const verified: ProspectCandidate[] = [];
  let unverifiable = 0;

  for (const candidate of candidates) {
    if (isPublicProfileUrl(candidate.linkedinUrl, candidate.providerId)) {
      verified.push(candidate);
      continue;
    }

    try {
      const profile = await ctx.linkedin.getProfile({ accountId, providerId: candidate.providerId });
      if (isPublicProfileUrl(profile.linkedinUrl, candidate.providerId)) {
        // Everything the profile knows and the search result did not. A page
        // built from a search row alone is thin exactly where a reviewer looks.
        verified.push({
          ...candidate,
          linkedinUrl: profile.linkedinUrl,
          firstName: profile.firstName || candidate.firstName,
          lastName: profile.lastName || candidate.lastName,
          headline: profile.headline ?? candidate.headline,
          title: profile.title ?? candidate.title,
          company: profile.company ?? candidate.company,
          location: profile.location ?? candidate.location,
          about: profile.about ?? candidate.about,
        });
        continue;
      }
    } catch (err) {
      // A profile we cannot read is a profile a reviewer cannot read either.
      console.error("could not resolve a prospect profile", {
        providerId: candidate.providerId,
        reason: (err as { message?: string })?.message ?? "unknown",
      });
    }

    unverifiable++;
  }

  return { verified, unverifiable };
}
