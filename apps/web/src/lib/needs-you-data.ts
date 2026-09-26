import "server-only";
import {
  CTA_PLACEHOLDER,
  MESSAGE_WEBHOOK_BEAT,
  PACING_LOOP,
  PACING_STALE_MS,
  effectiveCta,
  needsYou,
  type NeedsYouFacts,
  type NeedsYouItem,
} from "@le/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@le/db";

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
    { data: unlaunched },
    { data: thin },
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
      .from("campaigns")
      .select("id, cta_id, cta_kind, cta_label, cta_url")
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .limit(200),
    /*
     * Campaigns about to send a note that reads as personalised and is not.
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
      .eq("invite_note_thin", true)
      .limit(1000),
  ]);

  const stamped = beat?.beat_at ? Date.parse(beat.beat_at) : null;

  /*
   * Only a refusal counts. A delivery that verified, and an endpoint nobody has
   * ever called, are both "nothing to do here" — and reporting the second as a
   * fault would put a permanent red row on the screen of every workspace whose
   * first campaign has not had a reply yet.
   */
  const hook = (webhookBeat?.detail ?? null) as { ok?: boolean; hadSignature?: boolean } | null;
  const webhookRefused =
    hook && hook.ok === false ? (hook.hadSignature ? "bad_signature" : "no_signature") : null;

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
   * Read through `effectiveCta` rather than by testing the columns here: it is
   * the one definition of what a campaign's destination actually is, and rule 36
   * makes the linked library row win over the campaign's own. A second reading
   * would call a campaign broken that sends perfectly well.
   */
  const ctaIds = [...new Set((unlaunched ?? []).map((c) => c.cta_id).filter(Boolean))] as string[];
  const { data: ctaRows } = ctaIds.length
    ? await supabase.from("ctas").select("id, kind, label, url").in("id", ctaIds)
    : { data: [] };
  const ctaById = new Map((ctaRows ?? []).map((row) => [row.id, row]));

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
    const cta = effectiveCta(campaign.cta_id ? (ctaById.get(campaign.cta_id) ?? null) : null, {
      kind: campaign.cta_kind ?? undefined,
      label: campaign.cta_label,
      url: campaign.cta_url,
    } as Parameters<typeof effectiveCta>[1]);
    return !cta.url;
  }).length;

  const facts: NeedsYouFacts = {
    loopStalled: stamped === null || now.getTime() - stamped > PACING_STALE_MS,
    linkedInConnected: (account.count ?? 0) > 0,
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
    campaignsUnlaunched: (unlaunched ?? []).length,
    campaignsWithThinNotes: new Set((thin ?? []).map((row) => row.campaign_id)).size,
    campaignsMissingCta,
  };

  return { items: needsYou(facts), facts };
}
