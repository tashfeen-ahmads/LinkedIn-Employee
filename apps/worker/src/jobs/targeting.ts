import { buildCampaign, personalizeInvites, scoreProspects } from "@le/agents";
import type { ProspectCandidate } from "@le/shared";
import {
  BusinessProfileSchema,
  CustomerProfileSchema,
  LINKEDIN_LIMITS,
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
const TARGETING_BUILD = "2026-09-16.per-term-search";

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
    payload: { reason, build: TARGETING_BUILD, ...detail },
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
        threw: true,
      },
    });
    throw err;
  }
}

async function targeting(ctx: WorkerContext, job: TargetingJob): Promise<string | null> {
  const { db } = ctx;

  const { data: profileRow } = await db
    .from("customer_profiles")
    .select("id, spec, business_profile_id, do_not_pursue, approved_at")
    .eq("id", job.customerProfileId)
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
    .eq("id", job.linkedinAccountId)
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
    return giveUp(ctx, job, "The search returned nobody new to contact.", {
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
      rules: {
        searchTier,
        droppedFilters: page.droppedFilters,
        filterNotes: page.filterNotes ?? [],
      } as never,
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
    const notes = await personalizeInvites(ctx.agentsFor(job.workspaceId), {
      business,
      profile,
      repName: rep?.full_name ?? "the sender",
      campaignAngle: plan.connectionNote,
      prospects: shortlist.map((r) => r.candidate),
    });

    const providerIdByProspectId = new Map<string, string>();
    for (const [index, p] of insertedProspects.entries()) {
      const candidate = shortlist[index]?.candidate;
      if (candidate) providerIdByProspectId.set(p.id, candidate.providerId);
    }

    await db.from("campaign_prospects").insert(
      insertedProspects.map((p) => {
        const note = notes.get(providerIdByProspectId.get(p.id) ?? "");
        return {
          workspace_id: job.workspaceId,
          campaign_id: campaign.id,
          prospect_id: p.id,
          status: "queued" as const,
          // Absent is not an error: the send falls back to the campaign
          // template, which is exactly what happened before any of this.
          invite_note: note?.note ?? null,
          invite_note_prompt_version: note?.promptVersion ?? null,
          invite_note_grounding: (note?.grounding ?? []) as never,
          invite_note_thin: note?.tooThin ?? false,
        };
      }),
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
      filterNotes: page.filterNotes ?? [],
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
