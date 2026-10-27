"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { IDLE_RELEASE_TAGLINE, INVITE_NOTE_MAX_CHARS, isIdleReleased, LINKEDIN_LIMITS } from "@le/shared";
import { restoreFromFailure } from "@/lib/retry-failed";
import { requireSession } from "@/lib/workspace";
import { createClient } from "@/lib/supabase-server";
import { callWorker, errorQuery, noticeQuery, startedNotice } from "@/lib/worker";
import { ctaPatchFor } from "./cta-choice";
import { FIND_MORE_BATCH } from "./data";
import { launchCampaign } from "./launch-campaign";
import { sectionFrom, sectionHref, type CampaignSection } from "./sections";

/**
 * Every action the campaign's sections take, in one place.
 *
 * They were defined inline in the one long page. The page is now a set of
 * sections, and each action redirects back to the section it was pressed on —
 * a note saved on People lands on People with "Saved", not on the overview
 * with the list nowhere in sight.
 *
 * File-level "use server", so only the actions below are exported. Helpers
 * that take a workspace id or a session (`applyCampaignEdits`,
 * `launchCampaign`) are not, because an exported function in this file is an
 * endpoint any form can post to, and a workspace id is never something a form
 * may name.
 */


/** Every section shows the header and the menu, so a change refreshes the layout too. */
function refresh(campaignId: string): void {
  revalidatePath(sectionHref(campaignId), "layout");
}

/**
 * Writes one section's form to the campaign.
 *
 * Shared by Save and by Save and launch, because Launch used to be its own
 * form with none of these fields in it — so somebody who edited the copy and
 * pressed Launch launched the version from before their edits, and the edits
 * were silently thrown away. Launching from a form that edits copy saves
 * first.
 *
 * Only the fields the form carries are written. The copy used to live in one
 * form, so every field was always present; it is now split across Follow-ups,
 * Replies and Settings, and a Follow-ups save that wrote a missing invitation
 * cap as `1` would have quietly throttled the campaign to one a day.
 */
async function applyCampaignEdits(
  formData: FormData,
  workspaceId: string,
): Promise<{ campaignId: string; section: CampaignSection }> {
  const campaignId = String(formData.get("campaignId"));
  const section = sectionFrom(formData.get("section"));
  const here = sectionHref(campaignId, section);
  const supabase = await createClient();

  // Absent is not the same as cleared: a form that does not carry a field at
  // all must leave its column alone. The agent picker most of all — a form
  // without it (no agents in this workspace, or another section's form) must
  // not detach the agent a campaign is already running on.
  const noteField = formData.get("connectionNote");
  const capField = formData.get("dailyInviteCap");
  const replyMode = String(formData.get("replyMode") ?? "");
  const agentField = formData.get("agentId");
  // A checkbox is absent when it is unticked, so the form says it carries one.
  const carriesWarmUp = formData.get("warm_up_field") === "1";

  const patch: Record<string, unknown> = {};
  if (noteField !== null) {
    const note = String(noteField).trim();
    // The template is what a prospect with no personalised note receives, so
    // it is held to the same cap as the send path. The textarea's maxLength
    // stops typing past it; this stops a form that never had one, and a
    // template stored under the old 300 being saved again unchanged.
    if (note.length > INVITE_NOTE_MAX_CHARS) {
      redirect(
        errorQuery(
          here,
          `The connection note is ${note.length} characters. LinkedIn refuses anything over ${INVITE_NOTE_MAX_CHARS}.`,
        ),
      );
    }
    patch.connection_note = note;
  }
  if (carriesWarmUp) patch.warm_up = formData.get("warm_up") === "on";
  if (agentField !== null) {
    const agentId = String(agentField) || null;
    if (agentId) {
      // The id came from a form: only this workspace's own, live agents.
      const { data: agent } = await supabase
        .from("agents")
        .select("id")
        .eq("id", agentId)
        .eq("workspace_id", workspaceId)
        .is("archived_at", null)
        .maybeSingle();
      if (!agent) redirect(errorQuery(here, "That agent is not available any more. Pick another."));
    }
    patch.agent_id = agentId;
  }
  if (capField !== null) {
    // Clamped rather than rejected: the caps are product rules, and a typo in
    // this box must not be able to raise them. Rule 2 in CLAUDE.md.
    patch.daily_invite_cap = Math.max(1, Math.min(LINKEDIN_LIMITS.invitesPerDayMax, Math.round(Number(capField)) || 1));
  }
  if (replyMode === "autopilot" || replyMode === "approval") patch.reply_mode = replyMode;

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("campaigns")
      .update(patch as never)
      .eq("id", campaignId)
      .eq("workspace_id", workspaceId);
    if (error) {
      console.error(`[campaign] save: ${error.message}`);
      redirect(errorQuery(here, "Your changes could not be saved. Nothing was sent. Try again."));
    }
  }

  // Step messages come back as step-<id> fields so one save covers the whole
  // sequence: editing four messages in four round trips invites a half-edited
  // campaign going live.
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("step-")) continue;
    const { error: stepError } = await supabase
      .from("campaign_steps")
      // A person's words now, so no prompt wrote them (migration 0059). Only a
      // step whose text changed: every step is posted on every save.
      .update({ message: String(value), prompt_version: null })
      .eq("id", key.slice("step-".length))
      .eq("workspace_id", workspaceId)
      .neq("message", String(value));
    if (stepError) {
      console.error(`[campaign] save step: ${stepError.message}`);
      redirect(
        errorQuery(here, "Some of the messages could not be saved. Nothing was sent. Check them and save again."),
      );
    }
  }

  refresh(campaignId);
  return { campaignId, section };
}

export async function saveCampaign(formData: FormData) {
  const session = await requireSession();
  const { campaignId, section } = await applyCampaignEdits(formData, session.workspaceId);
  redirect(noticeQuery(sectionHref(campaignId, section), "Saved."));
}

/** A copy form's Save and launch: save what is on screen, then launch exactly that. */
export async function saveAndLaunch(formData: FormData) {
  const session = await requireSession();
  const { campaignId } = await applyCampaignEdits(formData, session.workspaceId);
  await launchCampaign(campaignId, session);
}

export async function removeFromCampaign(formData: FormData) {
  const campaignProspectId = String(formData.get("campaignProspectId"));
  const campaignId = String(formData.get("campaignId"));
  const who = String(formData.get("prospectName") ?? "").trim().slice(0, 120) || "That person";
  const session = await requireSession();
  const supabase = await createClient();
  const here = sectionHref(campaignId, "people");

  // Closed, not deleted. The row is how we know not to target this person
  // again, and the reason is what a rep reads later.
  const { data: removed, error } = await supabase
    .from("campaign_prospects")
    .update({
      status: "closed",
      status_reason: "removed during review",
      closed_at: new Date().toISOString(),
      next_action_at: null,
    })
    .eq("id", campaignProspectId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "queued")
    .select("id");

  refresh(campaignId);
  if (error) {
    console.error(`[campaign] remove prospect: ${error.message}`);
    redirect(errorQuery(here, `${who} could not be removed. Try again.`));
  }
  // A row that had already been invited is not removed — the update matches
  // queued rows only — and saying "Removed" over it would be untrue.
  redirect(
    removed?.length
      ? noticeQuery(here, `Removed ${who} from this campaign. They will not be invited.`)
      : errorQuery(here, `${who} has already been invited, so they stay on the list.`),
  );
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
export async function saveInviteNote(formData: FormData) {
  const campaignProspectId = String(formData.get("campaignProspectId"));
  const campaignId = String(formData.get("campaignId"));
  const note = String(formData.get("note") ?? "").trim();
  const who = String(formData.get("prospectName") ?? "").trim().slice(0, 120) || "this person";
  const session = await requireSession();
  const supabase = await createClient();
  const here = sectionHref(campaignId, "people");

  // LinkedIn refuses a longer note outright rather than truncating it, so a
  // silent save here would produce an invitation that never sends.
  if (note.length > INVITE_NOTE_MAX_CHARS) {
    redirect(errorQuery(here, `That note is ${note.length} characters. LinkedIn refuses anything over ${INVITE_NOTE_MAX_CHARS}.`));
  }

  const { data: changed, error } = await supabase
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
    .eq("status", "queued")
    .select("id");

  refresh(campaignId);
  if (error) {
    console.error(`[campaign] save note: ${error.message}`);
    redirect(errorQuery(here, `The note for ${who} could not be saved. Try again.`));
  }
  // Nothing matched: the invitation went out since this page loaded, and the
  // note it carried is a record now, not a draft.
  if (!changed?.length) {
    redirect(errorQuery(here, `${who} has been invited since this page loaded, so their note can no longer change.`));
  }
  redirect(
    noticeQuery(here, note ? `Saved the note for ${who}.` : `Cleared the note for ${who}. They get the campaign template.`),
  );
}

/**
 * Points a campaign at one of the workspace's calls to action.
 *
 * The CTA library was shipped without this and was therefore a page that did
 * nothing: destinations could be named and no campaign could use one. The
 * pointer is read at send time, so changing it here changes where every
 * message in this campaign points — including the ones already reviewed,
 * which is the point. The copy says "{{cta_link}}"; only the destination
 * moves. What each card means, and the columns written beside the pointer,
 * are `ctaPatchFor`'s.
 */
export async function setCampaignCta(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const here = sectionHref(campaignId, "goal");

  const session = await requireSession();
  const supabase = await createClient();

  const chosen = await ctaPatchFor(supabase, session, formData);
  if (!chosen.ok) redirect(errorQuery(here, chosen.reason));
  const { patch } = chosen;
  const { error } = await supabase
    .from("campaigns")
    .update(patch)
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId);

  if (error) {
    console.error(`[campaign] set cta: ${error.message}`);
    redirect(errorQuery(here, "That did not save. Nothing changed. Try again."));
  }

  refresh(campaignId);
  redirect(
    noticeQuery(
      here,
      patch.cta_id
        ? "Pointed at that call to action. Every message in this campaign now sends its destination."
        : "Back to this campaign's own destination.",
    ),
  );
}

export async function setStatus(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const status = String(formData.get("status"));
  // The campaigns list pauses from its cards; a pause pressed there is
  // answered there rather than by opening the campaign.
  const back = formData.get("back") === "list" ? "/app/campaigns" : sectionHref(campaignId);
  if (status !== "running" && status !== "paused") {
    redirect(errorQuery(back, "That did not change anything. Reload the page and try again."));
  }

  const session = await requireSession();
  if (status === "running") {
    await launchCampaign(campaignId, session);
    return;
  }

  const supabase = await createClient();
  const { data: paused, error } = await supabase
    .from("campaigns")
    .update({ status })
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .select("id");
  refresh(campaignId);
  revalidatePath("/app/campaigns");
  // Checked by the rows it changed: "Paused" over a campaign that is still
  // sending is the one wrong sentence this button can say.
  if (error || !paused?.length) {
    if (error) console.error(`[campaign] pause: ${error.message}`);
    redirect(errorQuery(back, "The campaign could not be paused. Try again."));
  }
  // Said, because a paused campaign and a running one that is waiting out its
  // gap look the same from everywhere else on this screen.
  redirect(noticeQuery(back, "Paused. Nothing more goes out from this campaign until you launch it again."));
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
export async function findMore(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const supabase = await createClient();
  const here = sectionHref(campaignId, "people");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("customer_profile_id, linkedin_account_id, search_exhausted")
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!campaign?.customer_profile_id) {
    redirect(errorQuery(here, "This campaign's customer profile has been deleted, so there is nothing left to search for."));
  }
  if (campaign.search_exhausted) {
    redirect(errorQuery(here, "This search has already reached the end of what LinkedIn returns for this profile."));
  }

  const { data: account } = await supabase
    .from("linkedin_accounts")
    .select("status, status_detail")
    .eq("id", campaign.linkedin_account_id)
    .maybeSingle();
  if (account?.status !== "active") {
    redirect(
      errorQuery(
        here,
        isIdleReleased(account)
          ? IDLE_RELEASE_TAGLINE
          : "Reconnect your LinkedIn account on your profile first. Nothing can be searched until it is connected.",
      ),
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
    redirect(errorQuery(here, `The search has not started. ${queued.error}`));
  }

  refresh(campaignId);
  redirect(
    noticeQuery(
      here,
      startedNotice(
        queued.data,
        "Reading the next page of the same search. It takes about a minute. Reload this page and the new names appear at the bottom of the list.",
      ),
    ),
  );
}

/**
 * Write the notes again, with whatever the agent says now.
 *
 * The notes are written once, when the campaign is built, and there was no way
 * back to them — so a rep who fixed their agent's openers watched this screen
 * go on showing the copy written before the fix. That is the agent as a
 * settings page that changes nothing, and the only alternative on offer was
 * editing every note by hand, which is the work the agent exists to do.
 *
 * Queued people only, and the worker checks that again at the write: a note on
 * somebody already invited is the record of what they were sent, not a draft.
 */
export async function rewriteNotes(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const here = sectionHref(campaignId, "opener");

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

  refresh(campaignId);
  const unanswered = result.data?.unanswered ?? 0;
  redirect(
    noticeQuery(
      here,
      `Rewrote ${result.data?.rewritten ?? 0} notes.` +
        (unanswered > 0 ? ` ${unanswered} kept the note they had, because the writer did not answer for them.` : "") +
        " Read them on People before you launch.",
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
 * `last_contacted_at`, so no daily allowance was spent and the message that
 * failed was never written down as sent. Everything that refuses — the
 * limiter, the exclusion list, do-not-contact, the never-twice rule — is
 * re-checked on the way out, so this queues an attempt rather than forcing a
 * send.
 *
 * Each row goes back to the state it failed *from* (`restoreFromFailure`),
 * never to the queue wholesale. A failed follow-up belongs to somebody who
 * already accepted; requeued for an invitation, the never-twice check closed
 * them as "already contacted", and the button meant to rescue the campaign's
 * one acceptance wrote it off instead.
 *
 * It is a button and not a retry loop on purpose. "Cannot send invitation to
 * this member" is LinkedIn refusing that person and will fail identically for
 * ever; a lapsed key is a deployment problem that a human has just fixed.
 * Nothing here can reliably tell those apart, and the one that must not be
 * automatic is hammering a provider that is refusing us.
 */
export async function retryFailed(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const supabase = await createClient();
  const here = sectionHref(campaignId, "people");

  const { data: failedRows, error: readError } = await supabase
    .from("campaign_prospects")
    .select("id, invited_at, accepted_at, last_step_sent")
    .eq("campaign_id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "failed");
  if (readError) {
    console.error(`[campaign] retry read: ${readError.message}`);
    redirect(errorQuery(here, "Could not requeue those. Nothing changed. Try again."));
  }

  // One write per destination state rather than per row: a campaign's failures
  // land in two or three states at most.
  const now = new Date();
  const groups = new Map<string, { restored: ReturnType<typeof restoreFromFailure>; ids: string[] }>();
  for (const row of failedRows ?? []) {
    const restored = restoreFromFailure(row, now);
    const key = `${restored.status}|${restored.next_action_at ?? ""}`;
    const group = groups.get(key) ?? { restored, ids: [] };
    group.ids.push(row.id);
    groups.set(key, group);
  }

  let invitations = 0;
  let followUps = 0;
  for (const { restored, ids } of groups.values()) {
    const { data, error } = await supabase
      .from("campaign_prospects")
      .update({ status: restored.status, status_reason: null, next_action_at: restored.next_action_at })
      .in("id", ids)
      .eq("workspace_id", session.workspaceId)
      // Only rows still failed: anything that moved since the read is left.
      .eq("status", "failed")
      .select("id");
    if (error) {
      console.error(`[campaign] retry write: ${error.message}`);
      refresh(campaignId);
      redirect(errorQuery(here, "Could not requeue all of those. Reload the page to see which went back, then try again."));
    }
    if (restored.status === "queued") invitations += data?.length ?? 0;
    else followUps += data?.length ?? 0;
  }

  refresh(campaignId);
  const count = invitations + followUps;
  const parts: string[] = [];
  if (invitations) parts.push(`${invitations} back in the invitation queue`);
  if (followUps) parts.push(`${followUps} back where their sequence stopped`);
  redirect(
    noticeQuery(
      here,
      count === 0
        ? "Nothing to retry: no prospect on this campaign is in a failed state."
        : `${parts.join(", ")}. ${
            count === 1 ? "It goes" : "They go"
          } out at the campaign's normal pace${invitations ? "; press Send one now to watch the first invitation" : ""}.`,
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
export async function sendOneNow(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const here = sectionHref(campaignId);

  const result = await callWorker<{ ok: boolean; detail: string }>("/jobs/send-one", {
    workspaceId: session.workspaceId,
    userId: session.userId,
    campaignId,
  });

  refresh(campaignId);
  if (!result.ok) {
    redirect(errorQuery(here, `Nothing was sent. ${result.error}`));
  }
  // The worker's own sentence, verbatim. A paraphrase here is a second reading
  // of what happened, and this is the one screen where the exact words matter.
  const answer = result.data;
  if (!answer) {
    // A 200 with no body is not "it worked". Saying nothing here is how a
    // failed send became a page that looked exactly like a successful one.
    redirect(errorQuery(here, "The sender answered without saying what happened."));
  }
  redirect(answer.ok ? noticeQuery(here, answer.detail) : errorQuery(here, answer.detail));
}

/**
 * Deletes a campaign that never reached anybody.
 *
 * Only a draft, never launched, with nobody on it invited. Once one invitation
 * has gone, the campaign's rows are the record of who was contacted, by which
 * angle and with which words (rules 24 and 28), and deleting them would erase
 * that record along with the campaign. Such a campaign is paused, not deleted.
 *
 * The people on a deleted draft stay in the workspace's prospect list, never
 * contacted, so a later campaign can still be built over them.
 */
export async function deleteCampaign(formData: FormData) {
  const campaignId = String(formData.get("campaignId"));
  const session = await requireSession();
  const supabase = await createClient();
  const here = sectionHref(campaignId, "settings");

  const { count: reached, error: readError } = await supabase
    .from("campaign_prospects")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .not("invited_at", "is", null);
  if (readError) {
    console.error(`[campaign] delete read: ${readError.message}`);
    redirect(errorQuery(here, "The campaign could not be deleted. Nothing changed. Try again."));
  }
  if ((reached ?? 0) > 0) {
    redirect(errorQuery(here, "Somebody on this campaign has already been invited, so it is kept as the record of who was contacted. Pause it instead."));
  }

  // The same conditions again in the delete itself: a launch pressed in
  // another tab between the read and this line must not be erased by it.
  const { data: deleted, error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("workspace_id", session.workspaceId)
    .eq("status", "draft")
    .is("launched_at", null)
    .select("id");
  if (error || !deleted?.length) {
    if (error) console.error(`[campaign] delete: ${error.message}`);
    redirect(errorQuery(here, "Only a draft that has never been launched can be deleted. Nothing changed."));
  }

  revalidatePath("/app/campaigns");
  redirect(noticeQuery("/app/campaigns", "Deleted the draft. The people on it are still in your prospect list."));
}
