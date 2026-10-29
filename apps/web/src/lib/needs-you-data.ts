import "server-only";
import {
  IDLE_RELEASE_DETAIL,
  CTA_PLACEHOLDER,
  MESSAGE_WEBHOOK_BEAT,
  PACING_LOOP,
  PACING_STALE_MS,
  ctaLinkMissing,
  needsYou,
  readWebhookRefusal,
  type NeedsYouFacts,
  type NeedsYouItem,
} from "@le/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@le/db";
import { localMonth, localMonthStart, noteAllowance, planOf } from "@le/linkedin";
import { CAMPAIGN_CTA_COLUMNS, campaignCtas, type CampaignCtaColumns } from "./campaign-cta";
import { readWorkspaceEntitlement } from "./entitlement";
import { chargesOnChoosing } from "./plans";

/**
 * The facts behind "what needs you", gathered for one workspace.
 *
 * The prose and the ordering live in `@le/shared`; this is the reading. Same
 * split as the daily report, for the same reason: the words are the part three
 * callers must never disagree about, and the queries are a handful of counts.
 *
 * Nothing here is new instrumentation. Every row was already being written —
 * held conversations since the reply gate, unapproved lines since pitches,
 * unlaunched campaigns since week one. The product has been recording what it
 * needs from a person for months and only ever mentioned it one dot at a time.
 *
 * Read from the layout on every page load, so it stays counts and small selects.
 */
export interface NeedsYouResult {
  items: NeedsYouItem[];
  facts: NeedsYouFacts;
}

export async function loadNeedsYou(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  now: Date = new Date(),
  /** The reader, whose own profile's posts are counted. */
  userId?: string,
): Promise<NeedsYouResult> {
  const head = { count: "exact" as const, head: true };

  const [
    { data: beat },
    { data: webhookBeat },
    account,
    { data: holds },
    pitches,
    hooks,
    strategies,
    approvedStrategies,
    { data: unlaunched },
    { data: thin },
    released,
    launched,
    posts,
    entitlement,
    { data: trial },
  ] = await Promise.all([
    supabase.from("worker_heartbeats").select("beat_at").eq("name", PACING_LOOP).maybeSingle(),
    // What the webhook endpoint itself recorded, not whether a secret is set
    // (rule 46). A check that asks about configuration passes while every
    // delivery is being refused.
    supabase
      .from("worker_heartbeats")
      .select("detail")
      .eq("name", MESSAGE_WEBHOOK_BEAT)
      .maybeSingle(),
    supabase
      .from("linkedin_accounts")
      .select("id", head)
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    /*
     * The holds themselves rather than a count, because the kind decides which
     * row a hold belongs to and which button it carries. A null kind is an
     * older row from before kinds existed, and it is read as a reply — that is
     * what those were.
     */
    supabase
      .from("conversations")
      .select("needs_human_kind")
      .eq("workspace_id", workspaceId)
      .eq("needs_human", true)
      .limit(500),
    supabase
      .from("pitches")
      .select("id", head)
      .eq("workspace_id", workspaceId)
      .is("approved_at", null),
    supabase.from("hooks").select("id", head).eq("workspace_id", workspaceId).is("approved_at", null),
    // A strategy somebody has explicitly set aside is not waiting for them.
    supabase
      .from("customer_profiles")
      .select("id", head)
      .eq("workspace_id", workspaceId)
      .is("approved_at", null)
      .eq("do_not_pursue", false),
    supabase
      .from("customer_profiles")
      .select("id", head)
      .eq("workspace_id", workspaceId)
      .not("approved_at", "is", null),
    supabase
      .from("campaigns")
      .select(`id, ${CAMPAIGN_CTA_COLUMNS}`)
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .limit(200),
    /*
     * Campaigns about to send a note that is not written for the person: one
     * the writer marked thin, or none at all, which falls back to the
     * campaign's template (rule 16). A note a person cleared on purpose
     * (`invite_note_edited`) is their choice and is not raised.
     *
     * `queued` only: a note already sent cannot be rewritten, and listing it
     * would put a row on this screen with no action behind it. Distinct in
     * memory because PostgREST has no `distinct` and the alternative is a view.
     */
    supabase
      .from("campaign_prospects")
      .select("campaign_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "queued")
      .or("invite_note_thin.eq.true,and(invite_note.is.null,invite_note_edited.eq.false)")
      .limit(1000),
    // Released after a fortnight unused (rule 63): the row says reconnect to
    // start campaigns rather than reading as a fault.
    supabase
      .from("linkedin_accounts")
      .select("id", head)
      .eq("workspace_id", workspaceId)
      .eq("status", "disconnected")
      .eq("status_detail", IDLE_RELEASE_DETAIL),
    // Nothing launched yet: somebody who opened the app before launching
    // (rule 65) still has setup to finish, and the list says so.
    supabase.from("campaigns").select("id", head).eq("workspace_id", workspaceId).not("launched_at", "is", null),
    // The reader's own unread posts: a post goes on one person's profile.
    userId
      ? supabase
          .from("linkedin_posts")
          .select("id", head)
          .eq("workspace_id", workspaceId)
          .eq("user_id", userId)
          .eq("status", "draft")
          .is("approved_at", null)
      : Promise.resolve({ count: 0, error: null }),
    // Read through the worker's own rule, so the list never says paused while
    // the campaigns are sending, or the reverse.
    readWorkspaceEntitlement(supabase, workspaceId),
    supabase.from("workspaces").select("trial_ends_at").eq("id", workspaceId).maybeSingle(),
  ]);

  const stamped = beat?.beat_at ? Date.parse(beat.beat_at) : null;

  // One reading, shared with the operator console. Two copies of this
  // expression is one rule with two answers, and the screen somebody happens
  // to be looking at becomes the true one.
  const webhookRefused = readWebhookRefusal(webhookBeat?.detail ?? null);

  let heldReplies = 0;
  let heldBookings = 0;
  let heldForCopy = 0;
  for (const row of holds ?? []) {
    if (row.needs_human_kind === "booking") heldBookings += 1;
    else if (row.needs_human_kind === "copy") heldForCopy += 1;
    else heldReplies += 1;
  }

  /*
   * A campaign asking somebody to click a link it does not have.
   *
   * Read through `campaignCtas` and `ctaLinkMissing` rather than by testing the
   * columns here: the linked library row wins over the campaign's own (rule
   * 36), and a meeting campaign with no URL of its own still sends one — the
   * rep's scheduling link or this product's booking page — so it is never
   * missing a destination. The campaign page reads the same two.
   */
  const unlaunchedCtas = await campaignCtas(supabase, workspaceId, (unlaunched ?? []) as CampaignCtaColumns[]);

  const unlaunchedIds = (unlaunched ?? []).map((c) => c.id);
  const { data: steps } = unlaunchedIds.length
    ? await supabase
        .from("campaign_steps")
        .select("campaign_id, message")
        .in("campaign_id", unlaunchedIds)
        .limit(1000)
    : { data: [] };

  const usesPlaceholder = new Set(
    (steps ?? [])
      .filter((step) => (step.message ?? "").includes(CTA_PLACEHOLDER))
      .map((step) => step.campaign_id),
  );

  const campaignsMissingCta = (unlaunched ?? []).filter((campaign) => {
    if (!usesPlaceholder.has(campaign.id)) return false;
    const cta = unlaunchedCtas.get(campaign.id);
    return cta ? ctaLinkMissing(cta) : false;
  }).length;

  /*
   * Meeting campaigns running on hours nobody chose: an owner with neither
   * saved availability nor their own scheduling link (rule 31). "Meeting" is
   * what the campaign actually asks for, through its library entry.
   */
  const { data: runningCampaigns } = await supabase
    .from("campaigns")
    .select(`id, owner_user_id, ${CAMPAIGN_CTA_COLUMNS}`)
    .eq("workspace_id", workspaceId)
    .eq("status", "running");
  const runningCtas = await campaignCtas(supabase, workspaceId, (runningCampaigns ?? []) as CampaignCtaColumns[]);
  const meetingCampaigns = (runningCampaigns ?? []).filter((c) => runningCtas.get(c.id)?.kind === "meeting");
  const owners = [...new Set(meetingCampaigns.map((c) => c.owner_user_id).filter(Boolean))] as string[];
  let meetingHoursUnset = false;
  if (owners.length) {
    const [{ data: set, error: setError }, { data: links, error: linkError }] = await Promise.all([
      supabase.from("availability").select("user_id").eq("workspace_id", workspaceId).in("user_id", owners),
      supabase.from("profiles").select("id, booking_url").in("id", owners),
    ]);
    // A read that failed says nothing either way, so it raises nothing.
    if (!setError && !linkError) {
      const covered = new Set([
        ...(set ?? []).map((row) => row.user_id),
        ...(links ?? []).filter((row) => row.booking_url).map((row) => row.id),
      ]);
      meetingHoursUnset = owners.some((owner) => !covered.has(owner));
    }
  }

  const thinNotes = await thinNoteCampaigns(
    supabase,
    workspaceId,
    [...new Set((thin ?? []).map((row) => row.campaign_id))],
    now,
  );

  const facts: NeedsYouFacts = {
    loopStalled: stamped === null || now.getTime() - stamped > PACING_STALE_MS,
    linkedInConnected: (account.count ?? 0) > 0,
    linkedInReleasedIdle: (released.count ?? 0) > 0,
    webhookRefused,
    heldReplies,
    heldBookings,
    // A conversation held for copy is the follow-up itself waiting, which is
    // why it is counted here and not as a reply: the action is on the Agents
    // screen, and there is no draft in the inbox to read.
    heldForCopy,
    pitchesUnapproved: pitches.count ?? 0,
    hooksUnapproved: hooks.count ?? 0,
    strategiesUnapproved: strategies.count ?? 0,
    strategiesApproved: approvedStrategies.count ?? 0,
    meetingHoursUnset,
    campaignsUnlaunched: (unlaunched ?? []).length,
    campaignsWithThinNotes: thinNotes.total,
    campaignsWithThinNotesDraft: thinNotes.drafts,
    campaignsMissingCta,
    // A read that failed is not "never launched": that would put a setup row
    // on a workspace with live campaigns.
    setupUnfinished: !launched.error && (launched.count ?? 0) === 0,
    postsWaiting: posts.error ? 0 : (posts.count ?? 0),
    plan: entitlement
      ? {
          stopped: !entitlement.canSend,
          trialDaysLeft: entitlement.trialDaysLeft,
          chargesNow: chargesOnChoosing(trial?.trial_ends_at ?? null, now),
        }
      : null,
  };

  return { items: needsYou(facts), facts };
}

/**
 * Which of the campaigns with generic or thin queued notes are worth raising.
 *
 * Only campaigns that can still send: a draft, a running or a paused one.
 * And not one whose account's free notes are spent for the month: LinkedIn
 * then takes the invitation without any note (rule 62), so nobody reads the
 * note whatever it says, and rewriting it would be work with no effect. The
 * month is read through `noteAllowance`, the send path's own reading, in the
 * account owner's zone.
 */
async function thinNoteCampaigns(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  ids: string[],
  now: Date,
): Promise<{ total: number; drafts: number }> {
  if (!ids.length) return { total: 0, drafts: 0 };
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, status, linkedin_account_id")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  const live = (campaigns ?? []).filter((c) => ["draft", "running", "paused"].includes(c.status));
  const accountIds = [...new Set(live.map((c) => c.linkedin_account_id).filter(Boolean))] as string[];
  const { data: accounts } = accountIds.length
    ? await supabase
        .from("linkedin_accounts")
        .select("id, user_id, has_premium, has_sales_navigator, notes_exhausted_month")
        .eq("workspace_id", workspaceId)
        .in("id", accountIds)
    : { data: [] as Array<{ id: string; user_id: string; has_premium: boolean | null; has_sales_navigator: boolean | null; notes_exhausted_month: string | null }> };
  const userIds = [...new Set((accounts ?? []).map((a) => a.user_id).filter(Boolean))];
  const { data: owners } = userIds.length
    ? await supabase.from("profiles").select("id, timezone").in("id", userIds)
    : { data: [] as Array<{ id: string; timezone: string | null }> };
  const zone = new Map((owners ?? []).map((o) => [o.id, o.timezone || "UTC"]));
  const zoneOf = (userId: string) => {
    const tz = zone.get(userId) ?? "UTC";
    try {
      localMonth(now, tz);
      return tz;
    } catch {
      return "UTC";
    }
  };
  const verdicts = await Promise.all(
    (accounts ?? []).map(async (a) => {
      const tz = zoneOf(a.user_id);
      const plan = planOf(a);
      // The send path's own count: invitations this month that carried a note.
      const sent = plan === "basic" ? await notesSentThisMonth(supabase, a.id, tz, now) : 0;
      const allowance = noteAllowance({
        plan,
        notesSentThisMonth: sent,
        exhaustedMonth: a.notes_exhausted_month,
        month: localMonth(now, tz),
      });
      return allowance.allowed ? null : a.id;
    }),
  );
  const spent = new Set(verdicts.filter((id): id is string => Boolean(id)));
  const raised = live.filter((c) => !c.linkedin_account_id || !spent.has(c.linkedin_account_id));
  return { total: raised.length, drafts: raised.filter((c) => c.status === "draft").length };
}

/**
 * Invitations an account sent this month with a note, in its owner's month.
 * The same reading as the send path's (`notesSentThisMonth` in the worker's
 * `linkedin-action.ts`): invited this month, less those that went without one.
 */
async function notesSentThisMonth(
  supabase: SupabaseClient<Database>,
  accountId: string,
  timezone: string,
  now: Date,
): Promise<number> {
  const { data: campaigns } = await supabase.from("campaigns").select("id").eq("linkedin_account_id", accountId);
  const ids = (campaigns ?? []).map((c) => c.id);
  if (!ids.length) return 0;
  const since = localMonthStart(now, timezone).toISOString();
  const [{ count: invited }, { count: withoutNote }] = await Promise.all([
    supabase.from("campaign_prospects").select("id", { count: "exact", head: true }).in("campaign_id", ids).gte("invited_at", since),
    supabase
      .from("campaign_prospects")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", ids)
      .gte("invited_at", since)
      .eq("invite_note_sent", false),
  ]);
  return Math.max(0, (invited ?? 0) - (withoutNote ?? 0));
}
