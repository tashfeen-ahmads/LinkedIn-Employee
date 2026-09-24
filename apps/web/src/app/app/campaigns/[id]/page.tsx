import { revalidatePath } from "next/cache";
import { PageHeader } from "@/components/page";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  BOOT_BEAT,
  CLICKS_ARE_INVISIBLE,
  CTA_DEFINITIONS,
  effectiveCta,
  FIRST_STEP_TIMING_LABEL,
  LINKEDIN_LIMITS,
  PACING_LOOP,
  countFunnel,
  stagesFor,
} from "@le/shared";
import { ACCOUNT_USAGE_COLUMNS } from "@le/linkedin";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery } from "@/lib/worker";
import { SubmitButton } from "@/components/submit-button";
import { describeSearch } from "./search-state";
import { describePacing } from "@/lib/pacing";
import { MIN_SENDS_TO_COMPARE, comparisonReady, standings } from "@le/shared";
import { PageNotice, type NoticeParams } from "@/components/page-notice";
import { CONNECTION_NOTE_MAX, daysToSendAll, launchBlockers } from "@/lib/campaign";

/**
 * How many people one press of "Find more" reads.
 *
 * The same size as the first search, deliberately. A list grows in pages a
 * person can actually review — a button that added a thousand names at once
 * would produce a list nobody reads, which is the review step this product is
 * built around quietly becoming a rubber stamp.
 */
const FIND_MORE_BATCH = 50;

/**
 * The review screen. The product's central claim is that a person reads the
 * list and the copy before a single message reaches a stranger, and until this
 * page existed that claim was made by a Launch button on a card showing one of
 * the four messages a campaign sends.
 */

async function saveCampaign(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const supabase = await createClient();

  const note = String(formData.get("connectionNote") ?? "").trim();
  const cap = Number(formData.get("dailyInviteCap"));
  const replyMode = String(formData.get("replyMode"));
  // Absent is not the same as cleared: a form that does not carry the field at
  // all (no agents in this workspace) must leave the column alone rather than
  // detaching the agent a campaign is already running on.
  const agentField = formData.get("agentId");

  await supabase
    .from("campaigns")
    .update({
      connection_note: note,
      ...(agentField === null ? {} : { agent_id: String(agentField) || null }),
      // Clamped rather than rejected: the caps are product rules, and a typo in
      // this box must not be able to raise them. Rule 2 in CLAUDE.md.
      daily_invite_cap: Math.max(1, Math.min(LINKEDIN_LIMITS.invitesPerDayMax, Math.round(cap) || 1)),
      ...(replyMode === "autopilot" || replyMode === "approval"
        ? { reply_mode: replyMode as "autopilot" | "approval" }
        : {}),
    })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId);

  // Step messages come back as step-<id> fields so one save covers the whole
  // sequence: editing four messages in four round trips invites a half-edited
  // campaign going live.
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("step-")) continue;
    await supabase
      .from("campaign_steps")
      .update({ message: String(value) })
      .eq("id", key.slice("step-".length))
      .eq("workspace_id", session.workspaceId);
  }

  revalidatePath(`/app/campaigns/${campaignId}`);
}

async function removeFromCampaign(formData: FormData) {
  "use server";
  const campaignProspectId = String(formData.get("campaignProspectId"));
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const supabase = await createClient();

  // Closed, not deleted. The row is how we know not to target this person
  // again, and the reason is what a rep reads later.
  await supabase
    .from("campaign_prospects")
    .update({
      status: "closed",
      status_reason: "removed during review",
      closed_at: new Date().toISOString(),
      next_action_at: null,
    })
    .eq("id", campaignProspectId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "queued");

  revalidatePath(`/app/campaigns/${campaignId}`);
}

/**
 * A rep rewriting the note the agent wrote for one person.
 *
 * `invite_note_edited` is what stops the agent overwriting it later. A rep who
 * rewrote a note and watched it revert would stop trusting the screen, and then
 * stop reading the notes at all — which is the failure this review step exists
 * to prevent.
 *
 * Only while queued. After the invitation is sent the note is a record of what
 * was said, not a draft.
 */
async function saveInviteNote(formData: FormData) {
  "use server";
  const campaignProspectId = String(formData.get("campaignProspectId"));
  const campaignId = String(formData.get("campaignId"));
  const note = String(formData.get("note") ?? "").trim();
  const session = await requireSession();
  const supabase = await createClient();

  // LinkedIn refuses a longer note outright rather than truncating it, so a
  // silent save here would produce an invitation that never sends.
  if (note.length > CONNECTION_NOTE_MAX) {
    redirect(
      errorQuery(
        `/app/campaigns/${campaignId}`,
        `That note is ${note.length} characters. LinkedIn refuses anything over ${CONNECTION_NOTE_MAX}.`,
      ),
    );
  }

  await supabase
    .from("campaign_prospects")
    .update({
      invite_note: note || null,
      invite_note_edited: true,
      // It is the rep's sentence now, so the agent's account of where it came
      // from no longer describes it.
      invite_note_grounding: [],
      invite_note_thin: false,
    })
    .eq("id", campaignProspectId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "queued");

  revalidatePath(`/app/campaigns/${campaignId}`);
}

/**
 * Points a campaign at one of the workspace's calls to action.
 *
 * The CTA library was shipped without this and was therefore a page that did
 * nothing: destinations could be named and no campaign could use one. The
 * pointer is read at send time, so changing it here changes where every
 * message in this campaign points — including the ones already reviewed,
 * which is the point. The copy says "{{cta_link}}"; only the destination
 * moves.
 */
async function setCampaignCta(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const ctaId = String(formData.get("ctaId") ?? "");

  const session = await requireSession();
  const supabase = await createClient();

  // Empty means "use this campaign's own destination", which is what a
  // campaign built before the library has. Never a lookup for "".
  const { error } = await supabase
    .from("campaigns")
    .update({ cta_id: ctaId || null })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId);

  if (error) redirect(errorQuery(`/app/campaigns/${campaignId}`, `That did not save: ${error.message}`));

  revalidatePath(`/app/campaigns/${campaignId}`);
  redirect(
    noticeQuery(
      `/app/campaigns/${campaignId}`,
      ctaId
        ? "Pointed at that call to action. Every message in this campaign now sends its destination."
        : "Back to this campaign's own destination.",
    ),
  );
}

async function setStatus(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const status = String(formData.get("status"));
  if (status !== "running" && status !== "paused") return;

  const session = await requireSession();
  const supabase = await createClient();

  // The blockers are re-checked here and not only rendered as a disabled
  // button: a form can be submitted by anyone who can reach the route, and
  // launching is the action that reaches strangers.
  if (status === "running") {
    const state = await launchState(campaignId, session.workspaceId);
    if (!state || launchBlockers(state).length > 0) return;
  }

  await supabase
    .from("campaigns")
    .update({
      status,
      ...(status === "running" ? { launched_at: new Date().toISOString() } : {}),
    })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId);

  revalidatePath(`/app/campaigns/${campaignId}`);
  if (status !== "running") return;

  // Launching used to touch nothing but this row, and trust a loop somewhere
  // else to notice within five minutes. The one action in this product that
  // most needs the worker was the only one that never spoke to it: a worker
  // that was not running produced no error and no banner, and the page looked
  // exactly as it had before. That is how the first live launch went.
  //
  // Now it is a round trip. It also means the first invitation is paced from
  // the press rather than from whenever the schedule next comes round.
  const kicked = await callWorker("/jobs/campaign-tick", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    campaignId,
  });
  if (!kicked.ok) {
    // Launched, and said so: the campaign really is running and the loop will
    // pick it up if it comes back. What must not happen is this being silent.
    redirect(
      errorQuery(
        `/app/campaigns/${campaignId}`,
        `Launched, but the sending service did not answer: ${kicked.error}. Nothing will go out until it is back — check the system page.`,
      ),
    );
  }

  redirect(
    noticeQuery(
      `/app/campaigns/${campaignId}`,
      "Launched. Invitations are paced a few minutes apart, so the first one takes a little while to appear on LinkedIn — this page says where it is up to.",
    ),
  );
}

/**
 * Reads the next page of the same search and adds whoever is new to this list.
 *
 * A campaign used to be one search: about fifty people, and no way to reach the
 * fifty-first. Pressing "find prospects" again ran the identical query, got the
 * identical page, and reported every person on it as already known — so the
 * honest answer to "we need a thousand prospects" was that the product could
 * not do it.
 *
 * The campaign is what remembers the position, so continuing is a matter of
 * naming it. Everything else — which profile, which account, where the search
 * stopped — comes off its own row in the worker, which is also what stops this
 * form being a way to point one campaign's search at another profile.
 */
async function findMore(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("customer_profile_id, linkedin_account_id, search_exhausted")
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!campaign?.customer_profile_id) {
    redirect(
      errorQuery(
        `/app/campaigns/${campaignId}`,
        "This campaign's customer profile has been deleted, so there is nothing left to search for.",
      ),
    );
  }
  if (campaign.search_exhausted) {
    redirect(
      errorQuery(
        `/app/campaigns/${campaignId}`,
        "This search has already reached the end of what LinkedIn returns for this profile.",
      ),
    );
  }

  const { data: account } = await supabase
    .from("linkedin_accounts")
    .select("status")
    .eq("id", campaign.linkedin_account_id)
    .maybeSingle();
  if (account?.status !== "active") {
    redirect(
      errorQuery(`/app/campaigns/${campaignId}`, "Reconnect the LinkedIn account on the Team page first."),
    );
  }

  const queued = await callWorker("/jobs/targeting", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    customerProfileId: campaign.customer_profile_id,
    linkedinAccountId: campaign.linkedin_account_id,
    campaignId,
    limit: FIND_MORE_BATCH,
  });
  if (!queued.ok) {
    redirect(errorQuery(`/app/campaigns/${campaignId}`, `Could not start the search: ${queued.error}`));
  }

  revalidatePath(`/app/campaigns/${campaignId}`);
  redirect(
    noticeQuery(
      `/app/campaigns/${campaignId}`,
      "Reading the next page of the same search. It takes about a minute — reload this page and the new names appear at the bottom of the list.",
    ),
  );
}

/**
 * Write the notes again, with whatever the agent says now.
 *
 * The notes are written once, when the campaign is built, and there was no way
 * back to them — so a rep who fixed their agent's openers watched this page go
 * on showing the copy written before the fix. That is the agent as a settings
 * page that changes nothing, and the only alternative on offer was editing
 * every note by hand, which is the work the agent exists to do.
 *
 * Queued people only, and the worker checks that again at the write: a note on
 * somebody already invited is the record of what they were sent, not a draft.
 */
async function rewriteNotes(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const here = `/app/campaigns/${campaignId}`;

  // Ninety seconds, as the other writer routes take: the model runs on this
  // request so the person who clicked sees the new notes, and a working agent
  // cut off at ten seconds reads as a broken one.
  const result = await callWorker<{ ok: boolean; reason?: string; rewritten?: number; unanswered?: number }>(
    "/jobs/rewrite-notes",
    { workspaceId: session.workspaceId, userId: session.userId, campaignId },
    90_000,
  );
  if (!result.ok) redirect(errorQuery(here, result.error));
  if (result.data && result.data.ok === false) {
    redirect(errorQuery(here, result.data.reason ?? "The notes could not be rewritten."));
  }

  revalidatePath(here);
  const unanswered = result.data?.unanswered ?? 0;
  redirect(
    noticeQuery(
      here,
      `Rewrote ${result.data?.rewritten ?? 0} notes.` +
        (unanswered > 0
          ? ` ${unanswered} kept the note they had — the writer did not answer for them.`
          : "") +
        " Read them before you launch.",
    ),
  );
}

/**
 * Puts failed prospects back in the queue.
 *
 * `failProspect` writes `status: "failed"` and `next_action_at: null`, and the
 * pacing loop reads `status = "queued"` and nothing else — so a failed row is
 * not waiting for anything. It is finished, for ever, and nothing in this
 * product moved one back. An expired Unipile subscription answered `401` to
 * five invitations one morning and stranded five real people permanently: a
 * campaign somebody had reviewed, with a list they had approved, that could
 * never send to them again whatever was fixed afterwards.
 *
 * Retrying is safe because a failure is not a contact. `runLinkedInAction`
 * returns on a provider error *before* `recordAction` and before stamping
 * `last_contacted_at`, so no daily allowance was spent and the prospect was
 * never written down as reached. Everything that refuses — the limiter, the
 * exclusion list, do-not-contact, the never-twice rule — is re-checked on the
 * way out, so this queues an attempt rather than forcing a send.
 *
 * It is a button and not a retry loop on purpose. "Cannot send invitation to
 * this member" is LinkedIn refusing that person and will fail identically for
 * ever; a lapsed key is a deployment problem that a human has just fixed.
 * Nothing here can reliably tell those apart, and the one that must not be
 * automatic is hammering a provider that is refusing us.
 */
async function retryFailed(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("campaign_prospects")
    .update({ status: "queued", status_reason: null, next_action_at: null })
    .eq("campaign_id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "failed")
    .select("id");

  revalidatePath(`/app/campaigns/${campaignId}`);
  if (error) {
    redirect(errorQuery(`/app/campaigns/${campaignId}`, `Could not requeue those: ${error.message}`));
  }
  const count = data?.length ?? 0;
  redirect(
    noticeQuery(
      `/app/campaigns/${campaignId}`,
      count === 0
        ? "Nothing to retry — no prospect on this campaign is in a failed state."
        : `${count} prospect${count === 1 ? "" : "s"} back in the queue. ${
            count === 1 ? "It goes" : "They go"
          } out at the campaign's normal pace; press Send one now to watch the first.`,
    ),
  );
}

/**
 * Sends the next queued invitation now, and puts the answer on the screen.
 *
 * Every other way of finding out whether a real invitation can leave this
 * deployment costs a quarter of an hour — five minutes for a tick, two to
 * eleven for the jittered gap — and answers with an unchanged page if anything
 * went wrong in between. Eight days went by that way without a single live
 * send, and none of the waiting was ever a safety rule: the limiter, the
 * exclusion list, the do-not-contact flag and the never-twice rule all still
 * apply, and all of them still refuse out loud.
 */
async function sendOneNow(formData: FormData) {
  "use server";
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();

  const result = await callWorker<{ ok: boolean; detail: string }>("/jobs/send-one", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    campaignId,
  });

  revalidatePath(`/app/campaigns/${campaignId}`);
  if (!result.ok) {
    redirect(errorQuery(`/app/campaigns/${campaignId}`, `Could not reach the sender: ${result.error}`));
  }
  // The worker's own sentence, verbatim. A paraphrase here is a second reading
  // of what happened, and this is the one screen where the exact words matter.
  const answer = result.data;
  if (!answer) {
    // A 200 with no body is not "it worked". Saying nothing here is how a
    // failed send became a page that looked exactly like a successful one.
    redirect(
      errorQuery(`/app/campaigns/${campaignId}`, "The sender answered without saying what happened."),
    );
  }
  redirect(
    answer.ok
      ? noticeQuery(`/app/campaigns/${campaignId}`, answer.detail)
      : errorQuery(`/app/campaigns/${campaignId}`, answer.detail),
  );
}

/** Reads exactly what launchBlockers needs, for the server-action re-check. */
async function launchState(campaignId: string, workspaceId: string) {
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("connection_note, daily_invite_cap, linkedin_account_id")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!campaign) return null;

  const [{ data: steps }, { count }, { data: account }] = await Promise.all([
    supabase.from("campaign_steps").select("message, delay_days").eq("campaign_id", campaignId),
    supabase
      .from("campaign_prospects")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "queued"),
    supabase
      .from("linkedin_accounts")
      .select("status")
      .eq("id", campaign.linkedin_account_id)
      .maybeSingle(),
  ]);

  return {
    connectionNote: campaign.connection_note,
    steps: (steps ?? []).map((s) => ({ message: s.message, delayDays: s.delay_days })),
    dailyInviteCap: campaign.daily_invite_cap,
    prospectCount: count ?? 0,
    accountStatus: account?.status ?? null,
  };
}

/**
 * What the search could not filter on, as the targeting job recorded it.
 *
 * Read defensively: `rules` is jsonb written by the worker, and a campaign
 * created before this existed has none. A crash on the campaign page would be a
 * worse outcome than a missing notice.
 */
function ruleStrings(rules: unknown, key: "droppedFilters" | "filterNotes"): string[] {
  if (!rules || typeof rules !== "object") return [];
  const value = (rules as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function listInWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: NoticeParams;
}) {
  const notice = await searchParams;
  const { id } = await params;
  const session = await requireSession();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select(
      "id, name, status, connection_note, daily_invite_cap, reply_mode, launched_at, linkedin_account_id, rules, customer_profile_id, search_exhausted, searched_at, owner_user_id, agent_id, cta_id, cta_kind, cta_label, cta_url",
    )
    .eq("id", id)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!campaign) notFound();

  const [{ data: steps }, { data: members }, { data: account }, { data: lastSearch }, { data: heartbeat }, { data: boot }, { data: owner }, { data: variantRows }, { data: agents }] =
    await Promise.all([
    supabase
      .from("campaign_steps")
      .select("id, step_number, delay_days, message")
      .eq("campaign_id", id)
      .order("step_number"),
    supabase
      .from("campaign_prospects")
      .select("id, status, status_reason, invited_at, accepted_at, replied_at, variant_id, invite_note, invite_note_grounding, invite_note_thin, invite_note_edited, prospects (id, first_name, last_name, headline, title, company, location, linkedin_url, fit_score, fit_reasons)")
      .eq("campaign_id", id)
      .order("created_at"),
    // Every column the rate limiter reads, not only the two the header shows:
    // this page now answers "when does the next invitation go out", and it
    // answers it by asking the same limiter the sending loop asks.
    supabase
      .from("linkedin_accounts")
      .select(`${ACCOUNT_USAGE_COLUMNS}, display_name`)
      .eq("id", campaign.linkedin_account_id)
      .maybeSingle(),
    // How the last press of Find more went. The work happens in the worker, so
    // this page never learns the outcome of the job it started — and a search
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
    supabase.from("worker_heartbeats").select("beat_at").eq("name", PACING_LOOP).maybeSingle(),
    // The worker's own account of itself, written as it started and without
    // going through the queue — which is what makes it readable in exactly the
    // failures that erase everything else.
    supabase.from("worker_heartbeats").select("beat_at, detail").eq("name", BOOT_BEAT).maybeSingle(),
    // Working hours are evaluated in the rep's zone, so the same clock time is
    // inside them for one person and outside for another.
    supabase.from("profiles").select("timezone").eq("id", campaign.owner_user_id).maybeSingle(),
    supabase
      .from("campaign_variants")
      .select("id, name, angle, pain_point, enabled")
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
  ]);

  const rows = members ?? [];
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
  });
  const days = daysToSendAll(queued.length, campaign.daily_invite_cap);
  const dropped = ruleStrings(campaign.rules, "droppedFilters");
  // What the words in the customer profile actually became. LinkedIn searches
  // places and industries by id, so every one of them was translated first.
  const filterNotes = ruleStrings(campaign.rules, "filterNotes");
  const running = campaign.status === "running";
  // Judged on what this campaign was asking for. A link campaign has no
  // meetings and never will; ending its funnel in a permanent zero reports a
  // working campaign as a failed one.
  // The library, and what this campaign is actually sending. One resolver, the
  // same one the worker uses at send time — a screen that read the columns
  // directly would show a destination the send path does not use.
  const { data: ctaLibrary } = await supabase
    .from("ctas")
    .select("id, name, kind, label, url")
    .eq("workspace_id", session.workspaceId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  const linked = (ctaLibrary ?? []).find((c) => c.id === campaign.cta_id) ?? null;
  const cta = effectiveCta(linked, {
    kind: campaign.cta_kind,
    label: campaign.cta_label,
    url: campaign.cta_url,
  });

  const reached = stagesFor(cta.kind).filter((stage) => counts[stage.key] > 0);
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

  const pacing = describePacing({
    status: campaign.status,
    queued: queued.length,
    account: account ?? null,
    timezone: owner?.timezone ?? "UTC",
    lastBeatAt: heartbeat?.beat_at ?? null,
    boot: boot ?? null,
  });

  return (
    <>
      <PageNotice error={notice.error} notice={notice.notice} />
      <PageHeader
        eyebrow="Campaign"
        title={campaign.name}
        lede={
          <>
            <span className={`pill ${running ? "positive" : ""}`}>{campaign.status}</span>{" "}
            {queued.length} still to invite of {rows.length}
            {days ? ` · about ${days} working ${days === 1 ? "day" : "days"} at ${campaign.daily_invite_cap} a day` : ""}
            {account?.display_name ? ` · sending as ${account.display_name}` : ""}
          </>
        }
        actions={
          <>
          {/*
            Proof, on demand. A campaign that has sent nothing is otherwise
            indistinguishable from one that cannot, and the difference took
            eight days to establish once.
          */}
          {running && queued.length > 0 ? (
            <form action={sendOneNow}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <SubmitButton className="btn secondary" pendingLabel="Sending…">
                Send one now
              </SubmitButton>
            </form>
          ) : null}
          {/*
            A failed row is not waiting for anything — the loop reads `queued`
            and nothing else — so without this the only way back is rebuilding
            the campaign, which spends the invitation allowance again on people
            who were never actually reached.
          */}
          {failed.length > 0 ? (
            <form action={retryFailed}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              <SubmitButton className="btn secondary" pendingLabel="Requeueing…">
                Retry {failed.length} failed
              </SubmitButton>
            </form>
          ) : null}
          <form action={setStatus}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="status" value={running ? "paused" : "running"} />
            <SubmitButton pendingLabel={running ? "Pausing…" : "Launching…"} disabled={!running && blockers.length > 0}>
              {running ? "Pause" : "Launch campaign"}
            </SubmitButton>
          </form>
          </>
        }
      />

      {/*
        What the sending loop is doing, first on the page and above every other
        notice. A launched campaign that has sent nothing looks identical
        whether it is pacing itself, waiting for working hours, or running
        against a worker that is not there — and a rep watching a launch reads
        the top of this page, not the bottom.
      */}
      {pacing ? (
        <div className={pacing.tone === "danger" ? "notice danger" : "notice"}>
          <strong>{pacing.title}</strong>
          <p className="small">{pacing.body}</p>
        </div>
      ) : null}

      {dropped.length > 0 ? (
        <div className="notice">
          <strong>This list was built without Sales Navigator</strong>
          <p className="small">
            Classic LinkedIn search cannot filter on {listInWords(dropped)}, so{" "}
            {dropped.length === 1 ? "that part" : "those parts"} of your customer profile
            {dropped.length === 1 ? " was" : " were"} not applied. Everyone below still matched on
            title, industry and location, and each was scored against the full profile — read the
            names before launching, and expect more of them to be wrong than usual.
          </p>
        </div>
      ) : null}

      {filterNotes.length > 0 ? (
        <div className="notice">
          <strong>How your customer profile was searched</strong>
          <p className="small">
            LinkedIn searches locations and industries by its own identifiers, not by name, so each
            one had to be looked up first. Read these before the names below — a term that was left
            out is a filter this list does not have.
          </p>
          <ul className="bullets">
            {filterNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {blockers.length > 0 && !running ? (
        <div className="notice danger">
          <strong>Not ready to launch</strong>
          <ul className="bullets">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="card">
        <p className="small">
          <strong>This campaign asks for: {CTA_DEFINITIONS[cta.kind].label}</strong>
          {cta.label ? ` — “${cta.label}”` : ""}
        </p>
        <p className="tiny subtle">
          Judged on {CTA_DEFINITIONS[cta.kind].conversion}.
          {cta.kind === "link" ? ` ${CLICKS_ARE_INVISIBLE}` : ""}
        </p>
        {cta.url ? (
          <p className="tiny subtle">
            Sends to{" "}
            <a href={cta.url} target="_blank" rel="noreferrer noopener">
              {cta.url}
            </a>
            {cta.fromLibrary
              ? ". Changing it on the Calls to action page changes it here."
              : ". Carried on this campaign, set when it was built."}
          </p>
        ) : null}

        {/* The picker. Without it the library was a page that did nothing:
            destinations could be named and no campaign could use one. */}
        {ctaLibrary?.length ? (
          <form action={setCampaignCta} className="form-row">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <label className="field grow">
              <span className="tiny">Use a saved call to action</span>
              <select name="ctaId" defaultValue={campaign.cta_id ?? ""}>
                <option value="">This campaign&rsquo;s own destination</option>
                {ctaLibrary.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} — {CTA_DEFINITIONS[option.kind].label}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton className="btn secondary small" pendingLabel="Saving…">
              Use this
            </SubmitButton>
          </form>
        ) : (
          <p className="tiny subtle">
            <Link href="/app/cta">Save a call to action</Link> and every campaign can point at it,
            so correcting a URL once corrects it everywhere.
          </p>
        )}
      </section>

      {reached.length > 0 ? (
        <section className="card">
          <div className="meter-group">
            {reached.map((stage) => (
              <div key={stage.key}>
                <p className="small muted">
                  {stage.label}
                </p>
                <p className="mono lead-number">
                  {counts[stage.key]}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <form action={saveCampaign}>
        <input type="hidden" name="campaignId" value={campaign.id} />

        <section className="card">
          <h3>What gets sent</h3>
          <p className="small muted">
            {"Read all of it. {{first_name}}, {{company}}, {{title}} and {{rep_name}} are filled in per person; anything else stays literal."}
            {running ? " Edits apply to everyone who has not been reached yet." : ""}
          </p>

          {(agents ?? []).length > 0 ? (
            <label className="field">
              <span>Written by</span>
              <select name="agentId" defaultValue={campaign.agent_id ?? ""}>
                <option value="">No agent — the workspace&rsquo;s own copy</option>
                {(agents ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.is_default ? " (default)" : ""}
                  </option>
                ))}
              </select>
              <span className="small muted">
                The agent carries the openers, the offer and the voice. Changing it here does not
                rewrite the notes below — press Rewrite notes for that.
              </span>
            </label>
          ) : null}

          <label className="field">
            <span>
              Connection request · at most {CONNECTION_NOTE_MAX} characters
            </span>
            <textarea
              name="connectionNote"
              rows={3}
              defaultValue={campaign.connection_note}
              maxLength={CONNECTION_NOTE_MAX}
            />
          </label>

          {(steps ?? []).map((step) => (
            <label className="field" key={step.id}>
              <span>
                Follow-up {step.step_number} ·{" "}
                {/* Step 1 has no previous message — what precedes it is the
                    acceptance, and it is sent inside the hour (rule 43). Saying
                    "0 days after the previous message" described neither. */}
                {step.step_number === 1
                  ? FIRST_STEP_TIMING_LABEL
                  : `${step.delay_days} ${step.delay_days === 1 ? "day" : "days"} after the previous message`}
              </span>
              <textarea name={`step-${step.id}`} rows={3} defaultValue={step.message} />
            </label>
          ))}

          <div className="form-row">
            <label className="field compact-wide">
              <span>Invites a day</span>
              <input
                type="number"
                name="dailyInviteCap"
                min={1}
                max={LINKEDIN_LIMITS.invitesPerDayMax}
                defaultValue={campaign.daily_invite_cap}
              />
            </label>
            <label className="field compact-wide">
              <span>Replies</span>
              <select name="replyMode" defaultValue={campaign.reply_mode}>
                <option value="approval">Hold for my approval</option>
                <option value="autopilot">Send clean replies for me</option>
              </select>
            </label>
            <button className="btn secondary" type="submit">
              Save
            </button>
          </div>
          <p className="small muted">
            Pricing, legal and anything negative always waits for a person, on either setting. The
            ceiling of {LINKEDIN_LIMITS.invitesPerDayMax} a day is a safety limit, not a preference.
          </p>
        </section>
      </form>

      {variantStandings.length > 0 ? (
        <section className="stack-4">
          <div className="between">
            <h2>Angles being tested</h2>
            <p className="tiny subtle">
              {readyToCompare
                ? "Enough sent to compare."
                : `Too early to compare — each angle needs ${MIN_SENDS_TO_COMPARE} invitations.`}
            </p>
          </div>

          {/*
            The variable under test is the angle, not the words. Every prospect
            already receives a note written from their own headline and company,
            so a test of literal text would be comparing one-off sentences.
          */}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Angle</th>
                  <th>Pain it names</th>
                  <th>Sent</th>
                  <th>Accepted</th>
                  <th>Replied</th>
                </tr>
              </thead>
              <tbody>
                {variantStandings.map((standing) => {
                  const variant = (variantRows ?? []).find((v) => v.id === standing.id);
                  return (
                    <tr key={standing.id}>
                      <td>
                        <strong>{standing.name}</strong>
                        {!variant?.enabled ? <span className="pill"> retired</span> : null}
                        <span className="tiny subtle block">{variant?.angle}</span>
                      </td>
                      <td className="small muted">{variant?.pain_point ?? "—"}</td>
                      <td className="mono">{standing.sent}</td>
                      <td className="mono">
                        {standing.accepted}
                        {/*
                          The rate is only shown once there is enough behind it
                          to mean anything. Three acceptances from four
                          invitations reads as 75% and is worth almost nothing —
                          and a rep who kills the better angle on that has lost
                          more than the test could ever have won.
                        */}
                        {standing.sent >= MIN_SENDS_TO_COMPARE && standing.acceptanceRate !== null ? (
                          <span className="tiny subtle block">
                            {Math.round(standing.acceptanceRate * 100)}% ({Math.round(standing.low * 100)}–
                            {Math.round(standing.high * 100)}%)
                          </span>
                        ) : (
                          <span className="tiny subtle block">
                            {standing.sent === 0 ? "not sent yet" : "too few to rate"}
                          </span>
                        )}
                      </td>
                      <td className="mono">{standing.replied}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="tiny subtle">
            {readyToCompare && variantStandings.some((standing) => !standing.leading)
              ? "The ranges are the spread the true rate plausibly sits in. An angle is only called behind when its whole range sits below another's."
              : "Every angle here is still level: none of their ranges separate yet, which is the correct reading of a test this young."}
          </p>
        </section>
      ) : null}

      <section className="stack-4">
        <div className="between">
          <h2>Who is on the list</h2>
          <p className="tiny subtle">
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </p>
        </div>

        {searchNotice ? (
          <div className={searchNotice.tone === "danger" ? "notice danger" : "notice"}>
            <strong>{searchNotice.title}</strong>
            <p className="small">{searchNotice.body}</p>
          </div>
        ) : null}

        {/*
          One list grown a page at a time, rather than a new campaign per page.
          Everyone already on it is excluded from the next read, so the list
          only ever gets longer and nobody appears on it twice.
        */}
        {/*
          `className="between card"` here was the invitation form's bug again.
          `.card` declares `flex-direction: column` and `.between` declares
          `row`; both are one class, so source order decides and `.card` is
          written later — the row never happened and the button sat under the
          text instead of opposite it. A card is the surface and `between` is
          the arrangement inside it, so they go on different elements.
        */}
        <form action={findMore} className="card">
          <div className="between">
            <div>
            <p className="small">
              <strong>Need more people?</strong>
              {campaign.searched_at && !searchNotice ? (
                <span className="muted">
                  {" "}Last read {new Date(campaign.searched_at).toLocaleDateString()}.
                </span>
              ) : null}
            </p>
            <p className="tiny subtle">
              {campaign.search_exhausted
                ? "LinkedIn has no more profiles matching this customer profile. Widen the profile on the Strategy page to reach more people."
                : !campaign.customer_profile_id
                  ? "The customer profile this list was built from has been deleted, so there is nothing left to search for."
                  : `Reads the next ${FIND_MORE_BATCH} profiles from where this search stopped and adds whoever is new. Everyone already on your prospect list is skipped, so nobody is contacted twice.`}
            </p>
            </div>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <SubmitButton
              className="btn ghost"
              pendingLabel="Searching…"
              disabled={campaign.search_exhausted || !campaign.customer_profile_id}
            >
              Find {FIND_MORE_BATCH} more
            </SubmitButton>
          </div>
        </form>

        {/*
          The way back to the copy. Without it the agent is a settings page
          that changes nothing for anybody who already has a campaign: the
          openers are fixed, the notes on this page stay as they were written,
          and the only other route is editing every one of them by hand.
        */}
        <form action={rewriteNotes} className="card">
          <div className="between">
            <div>
              <p className="small">
                <strong>Rewrite the notes with your agent</strong>
              </p>
              <p className="tiny subtle">
                Writes a new note for everybody still waiting to be invited, using whatever your
                agent&rsquo;s openers say now. People already invited keep the note they were
                actually sent.
              </p>
            </div>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <SubmitButton className="btn ghost" pendingLabel="Writing…">
              Rewrite notes
            </SubmitButton>
          </div>
        </form>

        {rows.length === 0 ? (
          <p className="small muted">Nobody yet.</p>
        ) : (
          <ul className="prospect-list">
            {rows.map((row) => {
              const prospect = row.prospects as unknown as {
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
              } | null;
              if (!prospect) return null;

              const name = [prospect.first_name, prospect.last_name].filter(Boolean).join(" ") || "—";
              const grounding = (row.invite_note_grounding ?? []) as string[];
              const queued = row.status === "queued";

              return (
                <li key={row.id} className="card prospect-card">
                  <div className="between">
                    <div className="stack-1 grow">
                      <div className="cluster">
                        <a
                          href={`https://${prospect.linkedin_url.replace(/^https?:\/\//, "")}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <strong>{name}</strong>
                        </a>
                        {prospect.fit_score !== null ? (
                          <span className="pill plain tiny mono">fit {prospect.fit_score}</span>
                        ) : null}
                        <span className={`pill tiny ${row.status === "meeting_booked" ? "positive" : "plain"}`}>
                          {row.status.replaceAll("_", " ")}
                        </span>
                      </div>
                      <p className="small muted">
                        {prospect.title ?? prospect.headline ?? "—"}
                        {prospect.company ? ` · ${prospect.company}` : ""}
                        {prospect.location ? ` · ${prospect.location}` : ""}
                      </p>
                    </div>
                    {queued ? (
                      <form action={removeFromCampaign}>
                        <input type="hidden" name="campaignProspectId" value={row.id} />
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <button className="btn ghost small" type="submit">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </div>

                  {prospect.fit_reasons?.length ? (
                    <div className="stack-1">
                      <p className="tiny subtle">Why this person</p>
                      <ul className="bullets small muted">
                        {prospect.fit_reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {/* What this person actually receives. Until notes existed
                      everyone in a campaign got identical words, and this is
                      the screen where that is now visible before it is sent. */}
                  <div className="stack-2">
                    <div className="cluster">
                      <p className="tiny subtle">Their connection note</p>
                      {row.invite_note_edited ? (
                        <span className="pill plain tiny">edited by you</span>
                      ) : row.invite_note_thin ? (
                        <span className="pill warning tiny">too little to go on</span>
                      ) : !row.invite_note ? (
                        <span className="pill warning tiny">campaign template</span>
                      ) : null}
                    </div>

                    {queued ? (
                      <form action={saveInviteNote} className="stack-2">
                        <input type="hidden" name="campaignProspectId" value={row.id} />
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <label className="field">
                          <span className="sr-only">Connection note for {name}</span>
                          <textarea
                            name="note"
                            rows={3}
                            maxLength={CONNECTION_NOTE_MAX}
                            defaultValue={row.invite_note ?? ""}
                            placeholder={campaign.connection_note}
                          />
                        </label>
                        <div className="between">
                          <p className="tiny subtle">
                            {row.invite_note
                              ? `${row.invite_note.length}/${CONNECTION_NOTE_MAX}`
                              : "Empty sends the campaign template."}
                          </p>
                          <button className="btn secondary small" type="submit">
                            Save note
                          </button>
                        </div>
                      </form>
                    ) : (
                      <blockquote className="quote small">{row.invite_note ?? campaign.connection_note}</blockquote>
                    )}

                    {grounding.length ? (
                      <p className="tiny subtle">
                        Grounded in: {grounding.join(" · ")}
                      </p>
                    ) : row.invite_note && !row.invite_note_edited ? (
                      <p className="tiny warning-text">
                        Nothing specific to this person — this note could have gone to anybody.
                      </p>
                    ) : null}
                  </div>

                  {row.status_reason ? <p className="tiny muted">{row.status_reason}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
