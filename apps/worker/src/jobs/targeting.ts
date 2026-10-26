import { buildCampaign, personalizeInvites, scoreProspects } from "@le/agents";
import type { ProspectCandidate } from "@le/shared";
import {
  BusinessProfileSchema,
  parseCustomerProfile,
  FIRST_STEP_DELAY_DAYS,
  LINKEDIN_LIMITS,
  MIN_FIT_TO_QUEUE,
  assignVariants,
  clampFitScore,
  isPublicProfileUrl,
  matchExclusion,
  normalizeLinkedInUrl,
  parseHeadline,
} from "@le/shared";
import {
  SALES_NAVIGATOR_PARTIAL_NOTE,
  SALES_NAVIGATOR_REFUSED_NOTE,
  describeRefusal,
  isAccountGone,
} from "@le/linkedin";
import { markAccountGone } from "../accounts.js";
import { agentForCampaign, modelFor, openersFor, voiceOf } from "../agent.js";
import { brandOf, withBrand } from "../brand.js";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { loadExclusions } from "../exclusions.js";
import type { TargetingJob } from "../queues.js";


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
      .select("id, customer_profile_id, linkedin_account_id, owner_user_id, connection_note, search_cursor, search_exhausted, rules")
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
    .select("id, spec, business_profile_id, do_not_pursue, approved_at, cta_kind, cta_label, cta_url, cta_id, search_position")
    .eq("id", customerProfileId)
    // Every id in this job arrived from a form. The worker holds the service
    // role, so RLS does not stand between a member and another workspace's
    // strategy, business or LinkedIn account: these filters are the whole
    // tenant boundary, and without them a pasted id ran one company's search
    // on another company's seat.
    .eq("workspace_id", job.workspaceId)
    .maybeSingle();
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

  /*
   * Tolerant of a strategy written before `whatTheyBuy` existed — and only of
   * that. A bare parse here would have thrown on every row this deployment
   * already had, which is prospecting stopped on every workspace to gain a
   * field; a spec still unreadable once those two keys are filled is genuinely
   * broken, and throwing is what gets it retried and recorded with `threw`
   * rather than turned into a quiet "nothing to do".
   */
  const parsedProfile = parseCustomerProfile(profileRow.spec);
  if (!parsedProfile.success) throw parsedProfile.error;
  const profile = parsedProfile.data;

  const { data: businessRow } = await db
    .from("business_profiles")
    .select("spec")
    .eq("id", profileRow.business_profile_id)
    .eq("workspace_id", job.workspaceId)
    .maybeSingle();
  const business = BusinessProfileSchema.parse(businessRow?.spec);

  const { data: account } = await db
    .from("linkedin_accounts")
    .select("id, provider_account_id, status, has_sales_navigator")
    .eq("id", linkedinAccountId)
    .eq("workspace_id", job.workspaceId)
    .maybeSingle();
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

  /*
   * Where a search that builds no campaign carries on from (migration 0042).
   *
   * A continuation reads its position off the campaign. A fresh search used to
   * have nowhere to read one from, so a first press that built nothing — the
   * whole page already known, or nobody over the fit bar — left the next press
   * reading (and paying for) the same first page, for ever. The position is
   * keyed to the search that produced it: edited filters, a different tier or
   * a different seat are a different result set, and a cursor into the old one
   * is meaningless there.
   */
  const searchKey = strategySearchKey(profile.salesNavFilters, searchTier, account.id);
  const strategyCursor = continuing ? null : strategyPositionCursor(profileRow.search_position, searchKey);
  const startCursor = continuing ? continuing.search_cursor : strategyCursor;
  let page;
  try {
    page = await ctx.linkedin.searchProspects({
      accountId: account.provider_account_id,
      query: profile.salesNavFilters,
      limit: job.limit,
      tier: searchTier,
      ...(startCursor ? { cursor: startCursor } : {}),
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
    // Which refusal it was, in words, because each has a different remedy: a
    // monthly search limit waits for next month or a paid plan, a plan the
    // account does not have is a switch on the profile, a sign-in is a
    // reconnect. "Refused the search" was all four.
    const cause = (err as { message?: string })?.message ?? "";
    const said = describeRefusal(cause);
    const sentence =
      said.kind === "unknown" || said.kind === "recipient" || said.kind === "note_quota" || said.kind === "note_too_long"
        ? "LinkedIn refused the search."
        : `${said.title}. ${said.detail}`;
    return giveUp(ctx, job, sentence, {
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
  else await rememberStrategyPosition(ctx, job, profileRow.id, searchKey, page.cursor);

  // The seat refused the full search and the list came from a narrower one.
  // Which field it refused is answered only by asking each alone, so that is
  // done once a week per workspace and kept where whoever fixes it will look.
  if (
    searchTier === "sales_navigator" &&
    (page.filterNotes ?? []).some((n) => n === SALES_NAVIGATOR_REFUSED_NOTE || n === SALES_NAVIGATOR_PARTIAL_NOTE)
  ) {
    await probeSalesNavigatorOnce(ctx, job.workspaceId, profileRow.id, account.provider_account_id);
  }

  // Anyone this workspace already knows about is excluded, whichever rep owns
  // them. This is the cross-rep duplicate prevention promised in the spec.
  //
  // Matched by provider id as well as by address. Somebody outside the
  // viewer's network arrives with no public address — only the provider id —
  // so an address check alone never recognises them, and the profile lookup
  // below would be spent on a person we already have.
  const known = await loadKnown(ctx, job.workspaceId, page.items);
  const unknown = page.items.filter((c) => !isKnown(known, c));

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
  const { verified: resolved, unverifiable } = await verifyProfiles(
    ctx,
    account.provider_account_id,
    fresh,
  );

  /*
   * Asked again, now that everybody has a real address (rules 24 and 26).
   *
   * The check above runs on what the search returned, and for somebody outside
   * the viewer's network that is `linkedin.com/in/<provider id>` — an address
   * no stored prospect ever has. Resolving turns it into the real one, which
   * may be somebody another strategy found and this workspace has already
   * written to. Unchecked, that person was scored again, had their strategy
   * and fit score overwritten, and was put on a second campaign: a second
   * first contact under the same company's name.
   *
   * The exclusion list is applied again for the same reason: a person excluded
   * by their address cannot be matched on an address the search withheld.
   */
  const knownOnceResolved = await loadKnown(ctx, job.workspaceId, resolved);
  const verified = resolved.filter(
    (c) =>
      !isKnown(knownOnceResolved, c) &&
      !matchExclusion(exclusions, { company: c.company, linkedinUrl: c.linkedinUrl }),
  );
  const knownOnResolve = resolved.length - verified.length;

  if (verified.length === 0) {
    if (knownOnResolve > 0 && unverifiable === 0) {
      return giveUp(ctx, job, nothingNewYet(continuing, page), {
        searchTier,
        returnedByProvider: page.items.length,
        alreadyKnown: page.items.length - unknown.length + knownOnResolve,
      });
    }
    return giveUp(ctx, job, "Nobody found had a profile that can be opened and checked.", {
      searchTier,
      returnedByProvider: page.items.length,
      unverifiable,
      alreadyKnown: page.items.length - unknown.length + knownOnResolve,
    });
  }

  const ranked = await scoreProspects(ctx.agentsFor(job.workspaceId), {
    profile,
    candidates: verified,
    // So "disqualify a competitor" is a rule the scorer can actually apply.
    business: { oneLiner: business.oneLiner, competitors: business.competitors },
  });
  // Bounded here as well as in the scorer: this is the last code before the
  // column, and a score outside 0..100 is a number every screen misreads.
  const shortlist = ranked
    .map((r) => {
      const fit = clampFitScore(r.fitScore);
      return { ...r, fitScore: fit.score, disqualified: r.disqualified || !fit.usable };
    })
    .filter((r) => !r.disqualified && r.fitScore >= MIN_FIT_TO_QUEUE);
  if (shortlist.length === 0) {
    return giveUp(ctx, job, `Nobody scored above the minimum fit of ${MIN_FIT_TO_QUEUE}.`, {
      scored: ranked.length,
      disqualified: ranked.filter((r) => r.disqualified).length,
      bestScore: ranked.reduce((best, r) => Math.max(best, clampFitScore(r.fitScore).score), 0),
    });
  }

  /*
   * Whose name the notes go out under, and who owns the people found.
   *
   * The campaign's owner when adding to a campaign, never whoever pressed Find
   * more. The invitations go out from the campaign's seat, so a note signed by
   * the teammate who pressed the button reaches a stranger under one name from
   * another person's account — and the people found would sit in the presser's
   * pipeline while every message to them came from somebody else.
   */
  const ownerUserId = continuing?.owner_user_id ?? job.userId;
  const { data: rep } = await db.from("profiles").select("full_name").eq("id", ownerUserId).maybeSingle();
  const repName = rep?.full_name ?? "the sender";

  // Continuing a list adds people to it. The copy, the steps and the angle are
  // the ones a human already read and approved — rewriting them because the
  // list grew would change what everybody already queued is about to receive,
  // silently, at the moment somebody asked for more names.
  if (continuing) {
    const added = await attachProspects(ctx, job, {
      campaignId: continuing.id,
      ownerUserId,
      customerProfileId: profileRow.id,
      campaignAngle: continuing.connection_note,
      business,
      profile,
      repName,
      shortlist,
    });
    // What this batch's search could not honour is said on the campaign, next
    // to what the first batch's could not (rule 12). Loud and never fatal, for
    // the reason `rememberPosition` gives: the people are already stored.
    const rules = mergeSearchDisclosures(continuing.rules, page, searchTier);
    const { error: rulesError } = await db
      .from("campaigns")
      .update({ rules: rules as never })
      .eq("id", continuing.id)
      .eq("workspace_id", job.workspaceId);
    if (rulesError) {
      console.error("could not record what the search dropped", { campaignId: continuing.id, reason: rulesError.message });
    }
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
        alreadyKnown: page.items.length - unknown.length + knownOnResolve,
        searchTier,
        exhausted: page.cursor === null,
        droppedFilters: page.droppedFilters,
        filterNotes: page.filterNotes ?? [],
      },
    });
    return continuing.id;
  }

  /*
   * The one call in this job where failing throws away work already paid for.
   *
   * By the time it runs, this run has spent a LinkedIn search page and a
   * profile lookup for every candidate that arrived without a public address —
   * both off a Sales Navigator seat somebody pays for (rule 20) — and a
   * scoring call per prospect. The prospects are not written until after this
   * returns, so an exception here discards all of it and leaves a campaign
   * row with nobody on it. That is not hypothetical: this deployment has two
   * such campaigns, from four `targeting.campaign: model returned no parsable
   * output` failures in one afternoon.
   *
   * `callStructured` deliberately retries truncation and nothing else, and
   * that is right in general — a model ignoring its schema needs a different
   * prompt, not another identical call. But "in general" is about a persistent
   * mismatch, and one stochastic miss is a different thing: a second attempt
   * usually parses, and the alternative is discarding a page of real people
   * off a paid seat. So the retry lives here, at the one call site where that
   * is the trade, rather than loosening the rule for every call in the
   * product. Once only: twice means it is the prompt.
   */
  // The copy is written for the brand of the agent this campaign will run on
  // (the workspace default, assigned below). The scorer above kept the
  // strategy's own business: who would buy is the strategy's question.
  const planBusiness =
    withBrand(business, await brandOf(db, job.workspaceId, await defaultAgentId(ctx, job.workspaceId))) ?? business;
  const askForPlan = () =>
    buildCampaign(ctx.agentsFor(job.workspaceId), {
      business: planBusiness,
      profile,
      repName,
      dailyInviteCap: Math.min(LINKEDIN_LIMITS.invitesPerDayMax, 20),
      // Inherited from the strategy, because the copy is written toward the
      // ask. Changing it afterwards on the campaign leaves a sequence whose
      // first two messages were building to something else.
      cta: {
        kind: profileRow.cta_kind,
        label: profileRow.cta_label,
        url: profileRow.cta_url,
      },
    });

  let plan: Awaited<ReturnType<typeof buildCampaign>>;
  try {
    plan = await askForPlan();
  } catch (err) {
    const reason = (err as { message?: string })?.message ?? "unknown";
    console.warn("the campaign writer failed; asking once more before losing the search", {
      workspaceId: job.workspaceId,
      reason,
    });
    // Recorded whether or not the second attempt works, because a run that
    // needed two goes is worth knowing about and a silent retry is how a
    // prompt problem stays invisible until it is permanent.
    await recordEvent(ctx.db, {
      workspaceId: job.workspaceId,
      name: "targeting.campaign.retried",
      actorUserId: job.userId,
      subjectType: "customer_profile",
      subjectId: profileRow.id,
      payload: { reason },
    });
    plan = await askForPlan();
  }

  /*
   * Read here rather than carried in the job: a campaign built weeks after
   * signup should still open with the answer the rep actually gave.
   */
  const { data: wsRow } = await ctx.db
    .from("workspaces")
    .select("onboarding")
    .eq("id", job.workspaceId)
    .maybeSingle();
  const onboardingAutonomy =
    (wsRow?.onboarding as { autonomy?: string } | null)?.autonomy === "autonomous"
      ? "autonomous"
      : "supervised";

  /*
   * The workspace's default agent, as a campaign built on /app/campaigns/new
   * gets.
   *
   * Without it a strategy-built campaign had no agent at all, so the pitch and
   * opener the rep approved on that agent, its voice and its from-name were
   * all skipped for exactly the campaigns most people launch — the agent
   * screen was a settings page that changed nothing for them.
   */
  const agentId = await defaultAgentId(ctx, job.workspaceId);

  const { data: campaign, error } = await db
    .from("campaigns")
    .insert({
      workspace_id: job.workspaceId,
      customer_profile_id: profile ? profileRow.id : null,
      linkedin_account_id: account.id,
      owner_user_id: job.userId,
      agent_id: agentId,
      name: plan.name,
      status: "draft",
      connection_note: plan.connectionNote,
      cta_kind: profileRow.cta_kind,
      cta_label: profileRow.cta_label,
      cta_url: profileRow.cta_url,
      // The library entry the strategy points at, so the Calls to action page
      // lists this campaign under it and a corrected URL reaches it (rule 36).
      cta_id: profileRow.cta_id ?? null,
      daily_invite_cap: plan.dailyInviteCap,
      // The reply gate holds every message on an `approval` campaign whatever
      // its autonomy says, so "answers on its own" has to set the mode too or
      // it changes nothing.
      reply_mode: onboardingAutonomy === "autonomous" ? "autopilot" : "approval",
      stop_conditions: plan.stopConditions as never,
      // Carried on the campaign, not only in the event log, because the person
      // who reviews this list before launching is the one who needs to know
      // the search could not honour part of the profile they approved.
      rules: {
        searchTier,
        droppedFilters: page.droppedFilters,
        filterNotes: page.filterNotes ?? [],
        /*
         * How much the agent finishes on its own, from what onboarding was
         * told (migration 0038).
         *
         * Without it every campaign was born `supervised` whatever the rep
         * answered at signup, and the setting only took effect once they
         * found the profile screen and set it a second time — so an answer
         * given on day one did nothing until day three. `applyRules` reads
         * this field and the campaign's `reply_mode` (set beside it above),
         * and the two together are what make the answer real.
         */
        autonomy: onboardingAutonomy,
      } as never,
    })
    .select("id")
    .single();
  if (error || !campaign) throw new Error(`could not create campaign: ${error?.message}`);

  // Copy that still did not read like a person after the writer's one rewrite.
  // Recorded rather than hidden: the person reviewing before launch is who
  // fixes it, and a placeholder left in a step is held at send time.
  if (plan.voiceProblems?.length) {
    await recordEvent(ctx.db, {
      workspaceId: job.workspaceId,
      name: "campaign.voice_problems",
      actorUserId: job.userId,
      subjectType: "campaign",
      subjectId: campaign.id,
      payload: { problems: plan.voiceProblems.slice(0, 20) },
    });
  }

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
  const { error: stepsError } = await db.from("campaign_steps").insert([
    ...plan.steps.map((step, index) => ({
      workspace_id: job.workspaceId,
      campaign_id: campaign.id,
      variant_id: null,
      step_number: index + 1,
      delay_days: stepDelay(index + 1, step.delayDays),
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
        delay_days: stepDelay(index + 1, step.delayDays),
        message: step.message,
      }));
    }),
  ]);
  if (stepsError) {
    /*
     * A campaign with invitations and no follow-ups launches, collects
     * acceptances, and then says nothing to anybody — the one outcome the
     * campaign existed to produce, spent. The error used to be ignored and the
     * run went on to report the campaign built. Nobody has been attached yet,
     * so the half-built campaign is removed and the run fails where it can be
     * seen and retried.
     */
    await discardCampaign(ctx, job.workspaceId, campaign.id);
    throw new Error(`could not store the campaign's follow-up sequence: ${stepsError.message}`);
  }

  const attached = await attachProspects(ctx, job, {
    campaignId: campaign.id,
    ownerUserId: job.userId,
    customerProfileId: profileRow.id,
    campaignAngle: plan.connectionNote,
    business,
    profile,
    repName,
    shortlist,
  });

  if (attached === 0) {
    /*
     * Everybody on the shortlist became somebody else's in the moments since
     * this run checked: another strategy's search running at the same time
     * (targeting runs two at once, and `startPendingSearches` starts several)
     * wrote them first. They are that search's people now (rule 26), and an
     * empty draft campaign beside theirs is a list that can only report zero.
     */
    await discardCampaign(ctx, job.workspaceId, campaign.id);
    return giveUp(
      ctx,
      job,
      "Everyone this search found was taken by another search that ran at the same time. Press again to read the next page.",
      { searchTier, returnedByProvider: page.items.length, shortlisted: shortlist.length },
    );
  }

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
    // Never "use Find more": a search that builds no campaign has no campaign
    // to press it on. The strategy keeps its own position (migration 0042),
    // so pressing the same button again is the instruction that works.
    return page.cursor
      ? "Everyone LinkedIn returned is already on your prospect list. The search has moved past them — press again to read the next page."
      : "Everyone LinkedIn returned is already on your prospect list, and that was the last page LinkedIn will return for this strategy. The next search starts again from the first page.";
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
/**
 * The approved openers, and which angle each belongs to.
 *
 * Approved or nothing. An unapproved opener is a line the agent wrote and
 * nobody read, and it would be the first thing a stranger ever saw from this
 * workspace — which is the one place a review screen cannot be decorative.
 */
async function loadHooks(
  ctx: WorkerContext,
  workspaceId: string,
  /**
   * The set the campaign's agent owns, already resolved.
   *
   * Passed in rather than read again here: `openersFor` is the one definition
   * of which openers a campaign may use, and a second query with its own idea
   * of the answer is how the screen and the send come apart.
   */
  agentOpeners: string[] = [],
  /**
   * The campaign's agent, or null. Openers are read from that agent and from
   * the workspace's shared set (`agent_id` null), never from another agent:
   * a workspace running two brands would otherwise hand one brand's opening
   * lines to the other's invite writer, and the first thing a stranger reads
   * would be about a product they were never offered.
   */
  agentId: string | null = null,
): Promise<{ byVariantId: Map<string, string>; all: string[] }> {
  const approvedHooks = (owner: string | null) => {
    const q = ctx.db
      .from("hooks")
      .select("id, body")
      .eq("workspace_id", workspaceId)
      .not("approved_at", "is", null);
    return (owner ? q.eq("agent_id", owner) : q.is("agent_id", null)).limit(12);
  };
  const [{ data: shared }, { data: own }, { data: variants }] = await Promise.all([
    approvedHooks(null),
    agentId ? approvedHooks(agentId) : Promise.resolve({ data: [] as Array<{ id: string; body: string | null }> }),
    ctx.db.from("campaign_variants").select("id, hook_id").eq("workspace_id", workspaceId),
  ]);
  const hooks = [...(own ?? []), ...(shared ?? [])];

  const bodyById = new Map(
    hooks
      .map((row) => [row.id, row.body?.trim() ?? ""] as const)
      .filter(([, body]) => body.length > 0),
  );
  const byVariantId = new Map<string, string>();
  for (const variant of variants ?? []) {
    const body = variant.hook_id ? bodyById.get(variant.hook_id) : undefined;
    if (body) byVariantId.set(variant.id, body);
  }
  // The agent's set wins outright where it has one. An agent given three
  // openers has been given exactly the three somebody wants used, and quietly
  // adding the workspace's other five back would make that list a suggestion.
  return { byVariantId, all: agentOpeners.length ? agentOpeners : [...bodyById.values()] };
}

function groupByAngle(
  insertedProspects: Array<{ id: string }>,
  variantByProspectId: Map<string, { id: string; angle: string } | null>,
  providerIdByProspectId: Map<string, string>,
  input: { campaignAngle: string; shortlist: Array<{ candidate: ProspectCandidate }> },
  /**
   * The approved openers, and which angle owns which.
   *
   * The angle's own leads, then the rest of the approved set: the writer picks
   * whichever fits the person in front of it, and being handed one line only
   * would make it a template again.
   */
  hooks: { byVariantId: Map<string, string>; all: string[] } = { byVariantId: new Map(), all: [] },
): Array<{ angle: string; hooks: string[]; prospects: ProspectCandidate[] }> {
  const candidateByProviderId = new Map(input.shortlist.map((r) => [r.candidate.providerId, r.candidate]));
  const groups = new Map<string, { angle: string; hooks: string[]; prospects: ProspectCandidate[] }>();

  for (const p of insertedProspects) {
    const candidate = candidateByProviderId.get(providerIdByProspectId.get(p.id) ?? "");
    if (!candidate) continue;
    const variant = variantByProspectId.get(p.id) ?? null;
    const key = variant?.id ?? "none";
    const own = variant ? hooks.byVariantId.get(variant.id) : undefined;
    const group =
      groups.get(key) ??
      {
        angle: variant?.angle ?? input.campaignAngle,
        hooks: own ? [own, ...hooks.all.filter((line) => line !== own)] : hooks.all,
        prospects: [],
      };
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
  owner_user_id: string | null;
  connection_note: string;
  search_cursor: string | null;
  search_exhausted: boolean;
  rules?: unknown;
}

/**
 * The campaign's disclosures once another batch has been added to it.
 *
 * `rules.droppedFilters` and `rules.filterNotes` are what the campaign page
 * shows a reviewer about how the list was searched (rule 12). They were
 * written once, when the campaign was built, so a Find more run whose search
 * dropped the industry filter, or ran on a different tier, added people the
 * page then described with the first run's sentences. Merged, never replaced:
 * the people from the first batch are still on the list, and what was true of
 * them is still true. Deduplicated, so pressing Find more ten times does not
 * print one sentence ten times.
 *
 * A list with any classic batch in it was built (partly) without Sales
 * Navigator, so classic wins over the seat when the two differ.
 */
export function mergeSearchDisclosures(
  rules: unknown,
  page: { droppedFilters?: string[]; filterNotes?: string[] },
  searchTier: "classic" | "sales_navigator",
): Record<string, unknown> {
  const current = rules && typeof rules === "object" && !Array.isArray(rules) ? (rules as Record<string, unknown>) : {};
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  return {
    ...current,
    searchTier: current.searchTier === "classic" || searchTier === "classic" ? "classic" : searchTier,
    droppedFilters: union(strings(current.droppedFilters), page.droppedFilters ?? []),
    filterNotes: union(strings(current.filterNotes), page.filterNotes ?? []),
  };
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
    /** Who owns the people found: the campaign's owner, never the presser. */
    ownerUserId: string;
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

  /*
   * Created, never overwritten (rules 24 and 26).
   *
   * An existing row is somebody this workspace already has: found by another
   * strategy, possibly already written to. Overwriting it moved them onto this
   * strategy, replaced the fit score they were scored with against the one that
   * found them, reassigned their owner — and the returned row then put them on
   * this campaign as well. `ignoreDuplicates` makes the write ON CONFLICT DO
   * NOTHING, which returns only the rows it created, so only people this run
   * actually created are attached. That is also what makes two searches
   * running at once safe: whichever writes a person first has them, and the
   * other gets nothing back for that person.
   */
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
        /*
         * Read out of the headline when the search did not supply them, which
         * is almost always: classic search returns a headline and nothing
         * structured, and the profile endpoint that does know is spent only on
         * candidates missing a public URL (rule 13). So these two columns were
         * null for every person in the database, and a message written from
         * `{{company}}` had nothing to put there.
         *
         * The provider's own answer always wins; this only fills a blank.
         */
        title: r.candidate.title ?? parseHeadline(r.candidate.headline).title,
        company: r.candidate.company ?? parseHeadline(r.candidate.headline).company,
        company_size: r.candidate.companySize ?? null,
        industry: r.candidate.industry ?? null,
        location: r.candidate.location ?? null,
        about: r.candidate.about ?? null,
        fit_score: clampFitScore(r.fitScore).score,
        fit_reasons: r.fitReasons as never,
        intent_score: r.intentScore,
        signals: r.candidate.signals as never,
        owner_user_id: input.ownerUserId,
      })),
      { onConflict: "workspace_id,linkedin_url", ignoreDuplicates: true },
    )
    .select("id, provider_id");

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
  // Every row is paired with its person by the provider id it was written
  // with, never by position: the insert returns only the rows it created, in
  // whatever order the database likes, so position is exactly the assumption
  // that hands one person's note to somebody else (rule 16).
  const providerIdByProspectId = new Map(insertedProspects.map((p) => [p.id, p.provider_id ?? ""]));
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
    /*
     * The campaign's agent, which decides the openers, the voice and the name.
     *
     * Without this the agent screen is a settings page that changes nothing —
     * the rep edits the voice, the notes go out identical, and they conclude
     * the product is lying to them. A campaign with no agent resolves exactly
     * as it always did, which is what keeps this additive.
     */
    const agent = await agentForCampaign(ctx.db, input.campaignId);
    const agentOpeners = await openersFor(ctx.db, job.workspaceId, agent);
    // The note introduces the agent's brand when it speaks for one, never the
    // workspace's other product (`businessFor`'s overlay).
    const noteBusiness =
      withBrand(input.business, await brandOf(ctx.db, job.workspaceId, agent?.id ?? null)) ?? input.business;

    /*
     * The model the agent asked for, if this deployment can serve it.
     *
     * A deployment runs on whichever provider has a key, and a client built
     * for one cannot answer for the other — so an agent set to a Claude model
     * on an OpenAI-keyed deployment is not slower, it is a failed call and a
     * campaign with no notes. Falling back keeps the campaign; saying so keeps
     * the setting honest, because one that quietly does nothing is worse than
     * one that is missing.
     */
    const chosenModel = modelFor(ctx.agentsFor(job.workspaceId).client, agent);
    if (agent?.model && !chosenModel.honoured) {
      await recordEvent(ctx.db, {
        workspaceId: job.workspaceId,
        name: "agent.model.unavailable",
        subjectType: "campaign",
        subjectId: input.campaignId,
        payload: { asked: agent.model, used: chosenModel.model ?? "the deployment default" },
      });
    }

    const groups = groupByAngle(
      insertedProspects,
      variantByProspectId,
      providerIdByProspectId,
      input,
      await loadHooks(ctx, job.workspaceId, agentOpeners, agent?.id ?? null),
    );

    for (const group of groups) {
      const written = await personalizeInvites(ctx.agentsFor(job.workspaceId), {
        business: noteBusiness,
        profile: input.profile,
        // The name a prospect reads is the agent's when it has one. A full
        // legal name reads like a signature block; a first name reads like a
        // person, and that is the whole difference between a note and a
        // mailshot.
        repName: agent?.fromName?.trim() || input.repName,
        campaignAngle: group.angle,
        // The openers a person approved, with this angle's own leading.
        //
        // Read from `hooks` rather than from the strategy's jsonb: a line that
        // reaches real people has to be approvable, retirable and attachable
        // on its own, and inside a spec none of those are possible. The
        // strategy's own hooks are the fallback, so a workspace that has not
        // written openers yet keeps exactly the behaviour it had.
        hooks: group.hooks.length ? group.hooks : input.profile.hooks,
        voice: voiceOf(agent),
        model: chosenModel.model,
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

  const { error: attachError } = await db.from("campaign_prospects").upsert(
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
  if (attachError) {
    /*
     * Rule 27: a prospect row with no campaign is an exclusion spent on an
     * outreach that never happened — that person is filtered out of every
     * future search and appears on no list. This write's error used to be
     * ignored, so a failure here did exactly that while the run went on to
     * report the campaign built. The rows this run created are removed again
     * (never one that is on a campaign or has been contacted), and the throw
     * gets the run retried and recorded.
     */
    const ids = insertedProspects.map((p) => p.id);
    const { data: attached } = await db.from("campaign_prospects").select("prospect_id").in("prospect_id", ids);
    const keep = new Set((attached ?? []).map((row) => row.prospect_id));
    const orphans = ids.filter((id) => !keep.has(id));
    if (orphans.length) {
      await db
        .from("prospects")
        .delete()
        .in("id", orphans)
        .eq("workspace_id", job.workspaceId)
        .is("last_contacted_at", null);
    }
    throw new Error(`could not put the prospects on the campaign: ${attachError.message}`);
  }

  /*
   * How many people actually got a note, not just whether the writer threw.
   *
   * `writerFailed` is set from a caught exception, so it only ever described
   * the all-or-nothing case. A run where the writer returns fewer notes than
   * it was given prospects throws nothing — and that is the case this
   * deployment actually hit: a live campaign built with ten people on it and
   * three personalised notes. Seven real people queued to receive the generic
   * template under a real rep's name, with no event, no count and nothing on
   * the campaign header.
   *
   * Rule 27 is explicit that degrading silently is the other way this goes
   * wrong. Per-prospect the screen is honest — each one carries a "campaign
   * template" pill — but that is ten cards to scroll to learn a number, and
   * the number is the thing somebody needs before pressing Launch.
   *
   * Recorded whenever anybody was missed, with the reason when there was one
   * and `partial` when the writer simply came back short. Nobody missed is
   * the ordinary case and writes nothing.
   */
  const missed = insertedProspects.length - notes.size;
  if (writerFailed || missed > 0) {
    await recordEvent(db, {
      workspaceId: job.workspaceId,
      name: "campaign.notes_missing",
      actorUserId: job.userId,
      subjectType: "campaign",
      subjectId: input.campaignId,
      payload: {
        reason: writerFailed ?? "partial",
        prospects: insertedProspects.length,
        written: notes.size,
        // The number the review screen reads. Derivable from the two above,
        // and stated anyway: a consumer that has to subtract is a consumer
        // that can subtract wrongly.
        missing: Math.max(0, missed),
      },
    });
  }

  return insertedProspects.length;
}

/**
 * Which of these candidates the workspace already has, by address and by
 * provider id.
 *
 * Asks about the candidates rather than downloading every prospect the
 * workspace has ever seen: the old query pulled up to 50,000 rows to filter a
 * page of fifty, so its cost grew with the customer's history rather than with
 * the work being done.
 *
 * Both keys, because either alone misses people. A search result for somebody
 * outside the viewer's network carries `linkedin.com/in/<provider id>`, which
 * matches no stored address; a stored prospect written before provider ids
 * were kept matches on nothing else.
 */
interface KnownPeople {
  urls: Set<string>;
  providerIds: Set<string>;
}

async function loadKnown(
  ctx: WorkerContext,
  workspaceId: string,
  candidates: ReadonlyArray<Pick<ProspectCandidate, "linkedinUrl" | "providerId">>,
): Promise<KnownPeople> {
  const urls = [...new Set(candidates.map((c) => normalizeLinkedInUrl(c.linkedinUrl)))];
  const providerIds = [...new Set(candidates.map((c) => c.providerId).filter(Boolean))];
  if (urls.length === 0) return { urls: new Set(), providerIds: new Set() };

  const [byUrl, byProviderId] = await Promise.all([
    ctx.db.from("prospects").select("linkedin_url").eq("workspace_id", workspaceId).in("linkedin_url", urls),
    providerIds.length
      ? ctx.db.from("prospects").select("provider_id").eq("workspace_id", workspaceId).in("provider_id", providerIds)
      : Promise.resolve({ data: [] as Array<{ provider_id: string | null }>, error: null }),
  ]);
  // Unanswered is not "nobody". A dedupe that silently reads an error as an
  // empty list is how somebody already contacted is put on a second campaign.
  if (byUrl.error) throw new Error(`could not check who is already known: ${byUrl.error.message}`);
  if (byProviderId.error) throw new Error(`could not check who is already known: ${byProviderId.error.message}`);

  return {
    urls: new Set((byUrl.data ?? []).map((p) => normalizeLinkedInUrl(p.linkedin_url))),
    providerIds: new Set(
      (byProviderId.data ?? []).map((p) => p.provider_id).filter((id): id is string => Boolean(id)),
    ),
  };
}

function isKnown(known: KnownPeople, candidate: Pick<ProspectCandidate, "linkedinUrl" | "providerId">): boolean {
  return (
    known.urls.has(normalizeLinkedInUrl(candidate.linkedinUrl)) ||
    (Boolean(candidate.providerId) && known.providerIds.has(candidate.providerId))
  );
}

/**
 * The workspace's default agent, or its oldest live one, or nobody.
 *
 * The same answer `/app/campaigns/new` preselects, so a campaign built from a
 * strategy and one built by hand start on the same agent.
 */
async function defaultAgentId(ctx: WorkerContext, workspaceId: string): Promise<string | null> {
  const { data } = await ctx.db
    .from("agents")
    .select("id, is_default, created_at")
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  const agents = data ?? [];
  return (agents.find((a) => a.is_default) ?? agents[0])?.id ?? null;
}

/**
 * Removes a campaign this run created and could not finish, before anybody
 * was put on it.
 */
async function discardCampaign(ctx: WorkerContext, workspaceId: string, campaignId: string): Promise<void> {
  await ctx.db.from("campaign_steps").delete().eq("campaign_id", campaignId).eq("workspace_id", workspaceId);
  await ctx.db.from("campaign_variants").delete().eq("campaign_id", campaignId).eq("workspace_id", workspaceId);
  const { error } = await ctx.db.from("campaigns").delete().eq("id", campaignId).eq("workspace_id", workspaceId);
  if (error) console.error("could not remove an unfinished campaign", { campaignId, reason: error.message });
}

/**
 * What identifies one search: the filters, the tier and the seat. A cursor is
 * only meaningful inside the result set that produced it.
 */
function strategySearchKey(filters: unknown, tier: string, accountId: string): string {
  return JSON.stringify({ filters, tier, accountId });
}

/**
 * The cursor a fresh search should start from, or null for the first page.
 *
 * A position stored for a different search (edited filters, another tier or
 * seat) starts again from the beginning. So does one at the end of LinkedIn's
 * answer: people change jobs and titles, and a strategy that could never be
 * searched again would be a worse dead end than a re-read page.
 */
function strategyPositionCursor(stored: unknown, key: string): string | null {
  if (!stored || typeof stored !== "object") return null;
  const position = stored as { key?: unknown; cursor?: unknown };
  if (position.key !== key) return null;
  return typeof position.cursor === "string" && position.cursor ? position.cursor : null;
}

/**
 * Stores where a fresh search stopped, on the strategy (migration 0042).
 *
 * Written whatever the run goes on to find, for the reason a campaign's is
 * (rule 20): a page read is a page spent, and the run that builds nothing is
 * exactly the one that used to leave the next press on the same page.
 */
async function rememberStrategyPosition(
  ctx: WorkerContext,
  job: TargetingJob,
  customerProfileId: string,
  key: string,
  cursor: string | null,
): Promise<void> {
  const { error } = await ctx.db
    .from("customer_profiles")
    .update({ search_position: { key, cursor, at: new Date().toISOString() } as never })
    .eq("id", customerProfileId)
    .eq("workspace_id", job.workspaceId);
  // Loud, and never fatal, exactly as for a campaign's position.
  if (error) console.error("could not store the strategy's search position", { customerProfileId, reason: error.message });
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
  options: { salesNavigator?: boolean } = {},
): Promise<Record<string, string> | undefined> {
  const provider = ctx.linkedin as {
    probeSearch?: (
      id: string,
      options?: { salesNavigator?: boolean },
    ) => Promise<Array<{ label: string; count: number | null; error?: string }>>;
  };
  if (typeof provider.probeSearch !== "function") return undefined;

  try {
    const rows = await provider.probeSearch(accountId, options);
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

/**
 * The delay stored against a step.
 *
 * Step 1 waits for the acceptance and nothing else (rule 43), so whatever the
 * model wrote for it is discarded rather than stored. Discarded at the write
 * rather than only honoured at the read, because a campaign screen showing
 * "3 days" for something that happens in an hour is a second reading of the
 * rule, and the screen's is the one somebody believes.
 *
 * Every later step keeps its number in full: those are measured from a message
 * that really was sent, and pacing a follow-up is the rep's call.
 */
function stepDelay(stepNumber: number, written: number): number {
  return stepNumber === 1 ? FIRST_STEP_DELAY_DAYS : written;
}

const SALES_NAVIGATOR_PROBE_EVENT = "targeting.sales_navigator_probe";

async function probeSalesNavigatorOnce(
  ctx: WorkerContext,
  workspaceId: string,
  profileId: string,
  accountId: string,
): Promise<void> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: recent, error } = await ctx.db
    .from("events")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", SALES_NAVIGATOR_PROBE_EVENT)
    .gte("created_at", since)
    .limit(1);
  // A read that failed is not "never probed": every request comes off a seat.
  if (error || recent?.length) return;
  const rows = await probeProvider(ctx, accountId, { salesNavigator: true });
  if (!rows) return;
  await recordEvent(ctx.db, {
    workspaceId,
    name: SALES_NAVIGATOR_PROBE_EVENT,
    subjectType: "customer_profile",
    subjectId: profileId,
    payload: rows,
  }).catch(() => undefined);
}
