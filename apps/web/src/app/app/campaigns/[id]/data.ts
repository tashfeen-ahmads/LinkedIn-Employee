import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  BOOT_BEAT,
  CTA_PLACEHOLDER,
  ctaLinkMissing,
  effectiveCta,
  PACING_LOOP,
  countFunnel,
  queuedFromLoop,
  isIdleReleased,
  comparisonReady,
  standings,
} from "@le/shared";
import { ACCOUNT_USAGE_COLUMNS, dailyInviteCap, localDayStart, parseWorkingHours, planOf } from "@le/linkedin";
import { notesLeftThisMonth } from "@/lib/invite-notes";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { describeSearch } from "./search-state";
import { describePacing } from "@/lib/pacing";
import { campaignCtas } from "@/lib/campaign-cta";
import { campaignBookingUrl } from "@/lib/booking-link";
import { actionableQueue, launchBlockers, sendEstimate } from "@/lib/campaign";
import { isPlatformAdmin } from "@/lib/admin";
import { readWorkspaceEntitlement, replyPlanNote } from "@/lib/entitlement";

/**
 * How many people one press of "Find more" reads.
 *
 * The same size as the first search, deliberately. A list grows in pages a
 * person can actually review — a button that added a thousand names at once
 * would produce a list nobody reads, which is the review step this product is
 * built around quietly becoming a rubber stamp.
 */
export const FIND_MORE_BATCH = 50;

/**
 * Everything the campaign screen knows about one campaign, read once.
 *
 * The screen used to be one page of 1,800 lines that read all of this at the
 * top and rendered every part of the campaign underneath. It is now a set of
 * sections, each its own route, and they all answer from the same facts: the
 * header and the menu say "142 queued" and the People section lists the 142.
 * Two readings of one campaign drift, and the reader believes whichever they
 * looked at, so there is one loader.
 *
 * `cache` makes it one read per request: the layout (header and menu) and the
 * section underneath it both call it and the second call is free.
 */
export const loadCampaign = cache(async (id: string) => {
  const session = await requireSession();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select(
      "id, name, status, connection_note, daily_invite_cap, reply_mode, launched_at, created_at, linkedin_account_id, rules, customer_profile_id, search_exhausted, searched_at, owner_user_id, agent_id, warm_up, cta_id, cta_kind, cta_label, cta_url",
    )
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!campaign) notFound();

  const [{ data: steps }, { data: members }, { data: account }, { data: lastSearch }, { data: heartbeat }, { data: boot }, { data: owner }, { data: variantRows }, { data: agents }, { data: viewer }, { data: exclusionRows }, { data: siblings }, { data: strategy }] =
    await Promise.all([
    supabase
      .from("campaign_steps")
      .select("id, step_number, delay_days, message")
      .eq("campaign_id", id)
      .order("step_number"),
    supabase
      .from("campaign_prospects")
      .select("id, status, status_reason, invited_at, accepted_at, replied_at, variant_id, invite_note, invite_note_grounding, invite_note_thin, invite_note_edited, prospects (id, first_name, last_name, headline, title, company, location, linkedin_url, fit_score, fit_reasons, do_not_contact, last_contacted_at)")
      .eq("campaign_id", id)
      .order("created_at"),
    // Every column the rate limiter reads, not only the two the header shows:
    // this screen answers "when does the next invitation go out", and it
    // answers it by asking the same limiter the sending loop asks.
    supabase
      .from("linkedin_accounts")
      .select(`${ACCOUNT_USAGE_COLUMNS}, display_name, status_detail`)
      .eq("id", campaign.linkedin_account_id)
      .maybeSingle(),
    // How the last press of Find more went. The work happens in the worker, so
    // this screen never learns the outcome of the job it started — and a search
    // that stopped early looks exactly like one that is still running, which is
    // the ambiguity that had somebody pressing a button over and over.
    supabase
      .from("events")
      .select("name, payload, created_at")
      .eq("workspace_id", session.workspaceId)
      .in("name", ["targeting.queued", "targeting.stopped", "campaign.extended"])
      .eq("payload->>campaignId", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Whether the thing that sends the messages is running at all. Without it
    // a dead worker and a paced one are the same unchanged page.
    supabase.from("worker_heartbeats").select("beat_at, detail").eq("name", PACING_LOOP).maybeSingle(),
    // The worker's own account of itself, written as it started and without
    // going through the queue — which is what makes it readable in exactly the
    // failures that erase everything else.
    supabase.from("worker_heartbeats").select("beat_at, detail").eq("name", BOOT_BEAT).maybeSingle(),
    // Working hours are evaluated in the rep's zone, so the same clock time is
    // inside them for one person and outside for another.
    supabase.from("profiles").select("timezone").eq("id", campaign.owner_user_id).maybeSingle(),
    supabase
      .from("campaign_variants")
      .select("id, name, angle, pain_point, enabled, pitch_id, hook_id")
      .eq("campaign_id", id)
      .order("created_at", { ascending: true }),
    // Who writes this campaign's copy. A campaign built before agents existed
    // carries none, and it kept behaving exactly as it did — which is what
    // made the whole feature additive, and also what left those campaigns with
    // no way ever to reach an agent.
    supabase
      .from("agents")
      .select("id, name, is_default")
      .eq("workspace_id", session.workspaceId)
      .is("archived_at", null)
      .order("is_default", { ascending: false }),
    // Dates shown to whoever is reading, in their own timezone.
    supabase.from("profiles").select("timezone").eq("id", session.userId).maybeSingle(),
    // The exclusion list, so "still to invite" leaves out the people the send
    // path will close instead of inviting (rule 14).
    supabase.from("exclusions").select("kind, value, raw_value, reason").eq("workspace_id", session.workspaceId),
    // Other running campaigns on the same account share its daily and weekly
    // allowance, which the days estimate has to say.
    supabase
      .from("campaigns")
      .select("id")
      .eq("workspace_id", session.workspaceId)
      .eq("linkedin_account_id", campaign.linkedin_account_id)
      .eq("status", "running")
      .neq("id", campaign.id),
    // The strategy this list came from, named under the title (rule 26): a fit
    // score means nothing without the profile it was scored against.
    campaign.customer_profile_id
      ? supabase
          .from("customer_profiles")
          .select("id, name")
          .eq("id", campaign.customer_profile_id)
          .eq("workspace_id", session.workspaceId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const viewerTimezone = viewer?.timezone ?? null;
  // Whether this reader may see the deployment's half of a fault (rule 54).
  // False on error, because the privilege is the thing being asked about.
  const operator = await isPlatformAdmin();
  // What survives on this campaign's replies. Under autonomy pricing, legal
  // and negative replies are answered rather than held (rule 41), so the
  // sentence under the reply setting has to say which rules are in force.
  const autonomous = (campaign.rules as { autonomy?: string } | null)?.autonomy === "autonomous";
  // Pro holds every reply whatever this campaign says (`rulesForPlan`), so
  // "Send clean replies for me" on Pro is said to do nothing, not left to look
  // like it took.
  const planNote = replyPlanNote(await readWorkspaceEntitlement(supabase, session.workspaceId));

  const rows = members ?? [];
  /*
   * How many of these are getting the campaign's generic template.
   *
   * Every card already says so on its own — "campaign template" — and that is
   * ten cards to scroll to learn a number somebody needs *before* pressing
   * Launch. A live campaign here was built with ten people on it and three
   * personalised notes; nothing above the list said so, so it read as a
   * personalised campaign, which is precisely what rule 27 says must not
   * happen.
   *
   * Counted from the rows rather than from the event the worker records: the
   * rows are the thing being sent, a human may have written a note by hand
   * since, and a count taken from anywhere else can disagree with the list
   * underneath it.
   */
  const onTemplate = rows.filter((row) => !row.invite_note).length;
  const queued = rows.filter((row) => row.status === "queued");
  // A failed row is finished as far as the pacing loop is concerned — it reads
  // `queued` and nothing else — so these need a way back or they are stranded.
  const failed = rows.filter((row) => row.status === "failed");
  const counts = countFunnel(rows);
  const blockers = launchBlockers({
    connectionNote: campaign.connection_note,
    steps: (steps ?? []).map((s) => ({ message: s.message, delayDays: s.delay_days })),
    dailyInviteCap: campaign.daily_invite_cap,
    prospectCount: queued.length,
    accountStatus: account?.status ?? null,
    accountReleasedIdle: isIdleReleased(account),
    inviteNotes: queued.map((row) => row.invite_note),
  });
  // The rate the loop will actually keep: the campaign's cap, or the account's
  // ramp if that is lower — a new account starts at ten whatever the campaign
  // asks for (rule 3), and "4 days at 35 a day" on an account allowed ten is a
  // promise the loop will not keep. Today's ramp, so the estimate only ever
  // errs long as the ramp climbs.
  const perDay = Math.min(
    campaign.daily_invite_cap,
    account ? dailyInviteCap(account.first_action_at ? new Date(account.first_action_at) : null) : campaign.daily_invite_cap,
  );
  /*
   * Who on the queue will actually be invited. The send path closes somebody
   * marked do not contact, somebody already contacted, and somebody on the
   * exclusion list rather than inviting them, so counting them promised
   * invitations that were never going out.
   */
  const exclusions = (exclusionRows ?? []).map((row) => ({
    kind: row.kind,
    value: row.value,
    rawValue: row.raw_value,
    reason: row.reason,
  }));
  const { actionable, skipped } = actionableQueue(
    queued.map((row) => ({
      invited_at: row.invited_at,
      prospect: row.prospects as unknown as {
        do_not_contact: boolean | null;
        last_contacted_at: string | null;
        company: string | null;
        linkedin_url: string | null;
      } | null,
    })),
    exclusions,
  );
  const sharedWith = siblings?.length ?? 0;
  const estimate = sendEstimate({
    remaining: actionable,
    perDay,
    workingDaysPerWeek: parseWorkingHours(account?.working_hours).days.length,
    otherRunningOnAccount: sharedWith,
  });
  const running = campaign.status === "running";
  // The account's plan, said before launch: a free account's notes run out
  // after a few invitations a month (migration 0045), and finding that out
  // from a campaign that goes quiet is the failure this replaces.
  const sendingPlan = account ? planOf(account) : null;
  const notesLeft = account ? await notesLeftThisMonth(supabase, account, owner?.timezone ?? "UTC") : null;
  // The library, and what this campaign is actually sending. One resolver, the
  // same one the worker uses at send time — a screen that read the columns
  // directly would show a destination the send path does not use.
  const [{ data: ctaLibrary }, resolved] = await Promise.all([
    supabase
      .from("ctas")
      .select("id, name, kind, label, url")
      .eq("workspace_id", session.workspaceId)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    // Resolved like the send path, archived entries included: the list above
    // is what may be picked, not what this campaign points at.
    campaignCtas(supabase, session.workspaceId, [campaign]),
  ]);
  const cta = resolved.get(campaign.id) ?? effectiveCta(null, { kind: campaign.cta_kind, label: campaign.cta_label, url: campaign.cta_url });
  // `{{cta_link}}` in the copy with nothing to fill it: the same reading as
  // the overview's "link that is not set" row.
  const ctaMissing =
    ctaLinkMissing(cta) && (steps ?? []).some((step) => (step.message ?? "").includes(CTA_PLACEHOLDER));
  // Rule 31: a meeting campaign whose replies offer the rep's own scheduling
  // link books some meetings where this screen cannot see them.
  const bookingUrl = cta.kind === "meeting" ? await campaignBookingUrl(supabase, session.workspaceId, campaign) : null;
  const ownBookingLink = Boolean(bookingUrl);

  const searchNotice = describeSearch(lastSearch);
  // How each angle is doing, and whether anything can yet be said about it.
  //
  // Counted from the rows rather than stored, so the table cannot drift from
  // the campaign it describes. `sent` is invitations that actually went out —
  // the denominator has to be sends, not assignments, or an angle looks weak
  // purely because its half of the list has not been reached yet.
  const outcomes = (variantRows ?? []).map((v) => {
    const mine = rows.filter((r) => r.variant_id === v.id);
    return {
      id: v.id,
      name: v.name,
      enabled: v.enabled,
      sent: mine.filter((r) => r.invited_at).length,
      accepted: mine.filter((r) => r.accepted_at).length,
      replied: mine.filter((r) => r.replied_at).length,
      meetings: 0,
    };
  });
  const variantStandings = standings(outcomes);
  const readyToCompare = comparisonReady(outcomes);

  // What this campaign has already sent since the rep's own midnight, so the
  // pace on screen is the one the loop keeps once part of today's cap is spent.
  const dayStart = localDayStart(new Date(), owner?.timezone ?? "UTC").getTime();
  const sentToday = rows.filter((r) => r.invited_at && Date.parse(r.invited_at) >= dayStart).length;
  // What the loop's last run says is already queued on this account, so "more
  // today" is net of it exactly as the loop's own budget is (`inviteRoom`).
  // Read through `pacing_in_flight` (migration 0059): the loop's per-account
  // counts name every workspace's accounts, so a member is handed their own
  // account's entry and nothing else.
  const { data: ownInFlight } = campaign.linkedin_account_id
    ? await supabase.rpc("pacing_in_flight" as never, { p_account_id: campaign.linkedin_account_id } as never)
    : { data: null };
  const queuedNow = queuedFromLoop(
    ownInFlight && campaign.linkedin_account_id ? { inFlight: { [campaign.linkedin_account_id]: ownInFlight } } : null,
    campaign.id,
    campaign.linkedin_account_id,
    (siblings ?? []).map((c) => c.id),
  );
  const pacing = describePacing({
    status: campaign.status,
    queued: actionable,
    sentToday,
    queuedOnAccount: queuedNow?.account,
    queuedOnCampaign: queuedNow?.campaign,
    account: account ?? null,
    timezone: owner?.timezone ?? "UTC",
    lastBeatAt: heartbeat?.beat_at ?? null,
    // The loop says in its own stamp when the operator's kill switch is
    // holding every send; a fresh beat alone would read as "Sending".
    outreachPaused: Boolean((heartbeat?.detail as { paused?: unknown } | null)?.paused),
    boot: boot ?? null,
    dailyCap: campaign.daily_invite_cap,
  });

  const agent = (agents ?? []).find((a) => a.id === campaign.agent_id) ?? null;

  return {
    session,
    supabase,
    campaign,
    steps: steps ?? [],
    rows,
    account: account ?? null,
    strategy: strategy ?? null,
    variantRows: variantRows ?? [],
    agents: agents ?? [],
    agent,
    viewerTimezone,
    operator,
    autonomous,
    planNote,
    onTemplate,
    queued,
    failed,
    counts,
    blockers,
    actionable,
    skipped,
    estimate,
    running,
    sendingPlan,
    notesLeft,
    ctaLibrary: ctaLibrary ?? [],
    cta,
    ctaMissing,
    bookingUrl,
    ownBookingLink,
    searchNotice,
    variantStandings,
    readyToCompare,
    pacing,
  };
});

export type CampaignView = Awaited<ReturnType<typeof loadCampaign>>;

/** A prospect as the embed returns it. The generated types carry no relationships. */
export interface CampaignPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  linkedin_url: string;
  fit_score: number | null;
  fit_reasons: string[] | null;
}

export function personOf(row: CampaignView["rows"][number]): CampaignPerson | null {
  return row.prospects as unknown as CampaignPerson | null;
}

/** "Ava Chen", never an empty string. */
export function nameOf(person: Pick<CampaignPerson, "first_name" | "last_name">): string {
  return [person.first_name, person.last_name].filter(Boolean).join(" ") || "Unnamed";
}

/**
 * What the search could not filter on, as the targeting job recorded it.
 *
 * Read defensively: `rules` is jsonb written by the worker, and a campaign
 * created before this existed has none. A crash on the campaign screen would be
 * a worse outcome than a missing notice.
 */
export function ruleStrings(rules: unknown, key: "droppedFilters" | "filterNotes"): string[] {
  if (!rules || typeof rules !== "object") return [];
  const value = (rules as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function listInWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
