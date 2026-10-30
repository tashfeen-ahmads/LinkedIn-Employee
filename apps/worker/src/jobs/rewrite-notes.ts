import { personalizeInvites } from "@le/agents";
import {
  campaignNameWithoutCta,
  parseCustomerProfile,
  type ProspectCandidate,
} from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { agentForCampaign, modelFor, openersFor, voiceOf } from "../agent.js";
import { businessFor } from "../brand.js";

/**
 * Write the connection notes again, for the people a campaign has not invited yet.
 *
 * The notes are written once, when the campaign is built, and that is right:
 * a human reviews them before launch, and a model on the send path turns a
 * slow response into a missed send rather than a visible problem. But it left
 * a campaign's copy frozen at the moment it was created, and there was no way
 * back to it.
 *
 * Which made the agent a settings page that changed nothing for anybody who
 * already had a campaign. A rep whose openers were written for the wrong
 * audience — asking a business owner about "your chapter" — could fix the
 * agent, watch the campaign screen show the same eighteen notes, and correctly
 * conclude the product had ignored them. The alternative is editing eighteen
 * notes by hand, which is the work the agent exists to do.
 *
 * Three things it must not do.
 *
 * It never touches a prospect who is not still `queued`. An invited person has
 * had their note delivered; rewriting it would change the record of what they
 * were actually sent, and every screen reading that column would then be
 * reporting words nobody received.
 *
 * It never reassigns an angle. Assignment is fixed when the list is built
 * (rule 28) — rewriting the copy is not a reason to move somebody into another
 * arm of a test, and an outcome attributed to an angle that did not produce it
 * is the one way a test is worse than no test.
 *
 * And a writer failure leaves every existing note where it is. The campaign
 * degrades to the copy it already had, which is the behaviour rule 27 asks
 * for, rather than to no copy at all.
 */

export interface RewriteNotesInput {
  workspaceId: string;
  userId: string;
  campaignId: string;
  /**
   * Only the people who have no note of their own — the ones the writer
   * missed when the campaign was built. Everybody else keeps the copy they
   * have, which a human may already have read or rewritten.
   */
  onlyMissing?: boolean;
}

export type RewriteNotesResult =
  | { ok: true; rewritten: number; unanswered: number }
  | { ok: false; reason: string };

export async function rewriteCampaignNotes(
  ctx: WorkerContext,
  input: RewriteNotesInput,
): Promise<RewriteNotesResult> {
  const { db } = ctx;

  const { data: campaign } = await db
    .from("campaigns")
    .select("id, name, agent_id, customer_profile_id, owner_user_id, rules, cta_label")
    .eq("id", input.campaignId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!campaign) return { ok: false, reason: "That campaign is not in this workspace." };

  // Queued only. Every other status has either already been sent to or has
  // been dealt with, and both are records rather than plans.
  let queuedQuery = db
    .from("campaign_prospects")
    .select("id, prospect_id, variant_id")
    .eq("campaign_id", campaign.id)
    .eq("workspace_id", input.workspaceId)
    .eq("status", "queued");
  // A note a person cleared on purpose is their choice, never a gap, and a
  // row being sent this minute is already going with what it has.
  if (input.onlyMissing) {
    queuedQuery = queuedQuery.is("invite_note", null).neq("invite_note_edited", true).is("invite_claimed_at", null);
  }
  const { data: queued } = await queuedQuery;

  if (!queued?.length) {
    return {
      ok: false,
      reason: "Nobody on this campaign is still waiting to be invited, so there is nothing to rewrite.",
    };
  }

  // The campaign's agent's brand when it speaks for one (`businessFor`).
  const business = await businessFor(db, input.workspaceId, campaign.agent_id ?? null);
  if (!business) {
    return { ok: false, reason: "Tell us what you sell first — the notes are written from your business profile." };
  }

  // Fetched separately rather than as an embedded join: PostgREST returns the
  // related row and the fake database used in the tests cannot, so a join here
  // is a query that behaves differently in the two places it runs.
  const { data: people } = await db
    .from("prospects")
    .select("id, provider_id, first_name, last_name, headline, title, company, location, linkedin_url, customer_profile_id")
    .eq("workspace_id", input.workspaceId)
    .in("id", queued.map((row) => row.prospect_id));

  /*
   * The segment each note is written for. A campaign built from a strategy
   * has one; a campaign built from people already in the workspace does not,
   * but each of those people was found by a strategy of their own (rule 26),
   * and their note is written against that one. Somebody nobody's strategy
   * found keeps the note they have: a note written without the segment is
   * written for nobody in particular, which is the copy this replaces.
   */
  const strategyIds = new Set<string>();
  if (campaign.customer_profile_id) strategyIds.add(campaign.customer_profile_id);
  else for (const person of people ?? []) if (person.customer_profile_id) strategyIds.add(person.customer_profile_id);
  const { data: customerRows } = strategyIds.size
    ? await db
        .from("customer_profiles")
        .select("id, spec")
        .eq("workspace_id", input.workspaceId)
        .in("id", [...strategyIds])
    : { data: [] as Array<{ id: string; spec: unknown }> };
  const profiles = new Map<string, NonNullable<ReturnType<typeof parseCustomerProfile>["data"]>>();
  for (const row of customerRows ?? []) {
    const parsed = parseCustomerProfile(row.spec);
    if (parsed.success) profiles.set(row.id, parsed.data);
  }
  if (campaign.customer_profile_id && !profiles.has(campaign.customer_profile_id)) {
    return {
      ok: false,
      reason: "This campaign's strategy could not be read, so there is nothing to say who these people are.",
    };
  }
  if (profiles.size === 0) {
    return {
      ok: false,
      reason: "None of these people came from a strategy, so there is nothing to say who they are.",
    };
  }

  const byProspectId = new Map((people ?? []).map((row) => [row.id, row]));

  const { data: rep } = await db
    .from("profiles")
    .select("full_name")
    .eq("id", campaign.owner_user_id)
    .maybeSingle();

  const agent = await agentForCampaign(db, campaign.id);
  const openers = await openersFor(db, input.workspaceId, agent);
  const chosenModel = modelFor(ctx.agentsFor(input.workspaceId).client, agent);

  const { data: variants } = await db
    .from("campaign_variants")
    .select("id, angle, hook_id")
    .eq("campaign_id", campaign.id)
    .eq("workspace_id", input.workspaceId);
  const variantById = new Map((variants ?? []).map((row) => [row.id, row]));

  // The angle the campaign was built around, for everybody assigned none. The
  // campaign-wide copy is not a leftover — it is the whole sequence for that
  // person (rule 28).
  const campaignAngle =
    (campaign.rules as { angle?: string } | null)?.angle?.trim() ||
    // Never the call to action: the name is handed to the writer as an angle.
    campaignNameWithoutCta(campaign.name, campaign.cta_label);

  const { data: hookRows } = await db
    .from("hooks")
    .select("id, body")
    .eq("workspace_id", input.workspaceId)
    .not("approved_at", "is", null)
    .limit(12);
  const hookById = new Map(
    (hookRows ?? [])
      .map((row) => [row.id, row.body?.trim() ?? ""] as const)
      .filter(([, body]) => body.length > 0),
  );
  // Openers attached to any angle in the workspace belong to that angle's
  // audience; the rest are this business's own lines (`groupByAngle`).
  const { data: workspaceVariants } = await db
    .from("campaign_variants")
    .select("hook_id")
    .eq("workspace_id", input.workspaceId);
  const attached = new Set(
    (workspaceVariants ?? [])
      .map((row) => (row.hook_id ? hookById.get(row.hook_id) : undefined))
      .filter((line): line is string => Boolean(line)),
  );

  /*
   * One call per angle, not one for everybody.
   *
   * The angle is the variable under test, so a single call covering all of
   * them would leave the writer choosing which to lean on per person — and the
   * group labels would then describe an assignment nobody made.
   */
  const groups = new Map<
    string,
    {
      profile: NonNullable<ReturnType<typeof parseCustomerProfile>["data"]>;
      angle: string;
      hooks: string[];
      otherOpeners: string[];
      sharedOpeners: string[];
      rows: Array<{ id: string }>;
      prospects: ProspectCandidate[];
    }
  >();
  let withoutStrategy = 0;

  for (const row of queued) {
    const person = byProspectId.get(row.prospect_id);
    if (!person?.provider_id) continue;
    const strategyId = campaign.customer_profile_id ?? person.customer_profile_id ?? null;
    const profile = strategyId ? profiles.get(strategyId) : undefined;
    if (!profile) {
      withoutStrategy += 1;
      continue;
    }
    // The strategy's own openers were written for these people; the agent's
    // are tied to no strategy and go over only as optional shapes, exactly as
    // a new campaign's notes are written (`groupByAngle` in targeting.ts).
    const strategyOpeners = (profile.hooks ?? []).map((line) => line.trim()).filter(Boolean);
    const variant = row.variant_id ? variantById.get(row.variant_id) : undefined;
    const own = variant?.hook_id ? hookById.get(variant.hook_id) : undefined;
    const key = `${strategyId}|${variant?.id ?? "none"}`;
    const lead = own ? [own, ...strategyOpeners.filter((line) => line !== own)] : strategyOpeners;
    const group =
      groups.get(key) ??
      {
        profile,
        angle: variant?.angle ?? campaignAngle,
        hooks: lead,
        otherOpeners: openers.filter((line) => attached.has(line) && !lead.includes(line)),
        sharedOpeners: openers.filter((line) => !attached.has(line) && !lead.includes(line)),
        rows: [],
        prospects: [],
      };
    group.rows.push({ id: row.id });
    group.prospects.push({
      providerId: person.provider_id,
      firstName: person.first_name ?? "",
      lastName: person.last_name ?? "",
      headline: person.headline ?? undefined,
      title: person.title ?? undefined,
      company: person.company ?? undefined,
      location: person.location ?? undefined,
      linkedinUrl: person.linkedin_url ?? "",
      signals: [],
    } as ProspectCandidate);
    groups.set(key, group);
  }

  if (groups.size === 0) {
    return { ok: false, reason: "None of the people still queued has a LinkedIn id to write a note against." };
  }

  const notes = new Map<string, { note: string; promptVersion: string; grounding: string[]; tooThin: boolean }>();
  try {
    for (const group of groups.values()) {
      const written = await personalizeInvites(ctx.agentsFor(input.workspaceId), {
        business,
        profile: group.profile,
        repName: agent?.fromName?.trim() || rep?.full_name || business.companyName,
        campaignAngle: group.angle,
        hooks: group.hooks.length ? group.hooks : group.profile.hooks,
        otherOpeners: group.otherOpeners,
        sharedOpeners: group.sharedOpeners,
        voice: voiceOf(agent),
        model: chosenModel.model,
        prospects: group.prospects,
      });
      for (const [providerId, note] of written) {
        notes.set(providerId, {
          note: note.note,
          promptVersion: note.promptVersion,
          grounding: note.grounding ?? [],
          tooThin: note.tooThin ?? false,
        });
      }
    }
  } catch (err) {
    // Handed back verbatim rather than logged on a host the person who pressed
    // the button cannot reach. Nothing has been written, so the campaign still
    // holds the copy it had.
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  let rewritten = 0;
  // Nobody's strategy found these people, so they keep the note they have.
  let unanswered = withoutStrategy;
  for (const group of groups.values()) {
    for (const [index, candidate] of group.prospects.entries()) {
      const row = group.rows[index];
      const note = notes.get(candidate.providerId);
      // Matched by provider id, never by position (rule 16): the failure mode
      // of index matching is the wrong person receiving a paragraph about
      // somebody else, under a real rep's name. The index is only used to find
      // this candidate's own row, which this loop built side by side.
      if (!row || !note?.note?.trim()) {
        unanswered += 1;
        continue;
      }
      let write = db
        .from("campaign_prospects")
        .update({
          invite_note: note.note,
          invite_note_prompt_version: note.promptVersion,
          invite_note_grounding: note.grounding as never,
          invite_note_thin: note.tooThin,
        })
        .eq("id", row.id)
        .eq("workspace_id", input.workspaceId)
        // Checked again at the write, because minutes pass between reading the
        // list and finishing the model call, and a tick may have invited
        // somebody in between. Rewriting what they were sent would leave every
        // screen reporting words nobody received.
        .eq("status", "queued");
      // Filling a gap never overwrites a note somebody wrote in the meantime,
      // nor one being sent this minute: the record has to say what went.
      if (input.onlyMissing) write = write.is("invite_note", null).is("invite_claimed_at", null);
      const { data: changed, error } = await write.select("id");
      if (error) return { ok: false, reason: error.message };
      // Counted only when the row really changed: one invited or claimed in
      // the meantime is not a note anybody will receive.
      if (changed?.length) rewritten += 1;
      else unanswered += 1;
    }
  }

  await recordEvent(db, {
    workspaceId: input.workspaceId,
    name: "campaign.notes_rewritten",
    actorUserId: input.userId,
    subjectType: "campaign",
    subjectId: campaign.id,
    payload: { rewritten, unanswered, agent: agent?.id ?? null, openers: openers.length },
  }).catch((err) => console.error("could not record campaign.notes_rewritten", err));

  return { ok: true, rewritten, unanswered };
}

/** How long a campaign rests after a fill before it is asked again. */
export const FILL_RETRY_MS = 6 * 60 * 60_000;

/**
 * Write the notes that are missing, on every campaign still inviting people.
 *
 * A note goes missing three ways: the writer comes back short when a list is
 * built or refilled (`campaign.notes_missing`), the nightly copy repair clears
 * one it could not fix (rule 66), or a refill adds people to a campaign that
 * is already running. Each of those people would otherwise get the
 * campaign's standard line, and Needs you told the owner so every day.
 *
 * This used to run on unlaunched campaigns only, on the reading that a launch
 * approves the copy as it stood. But the gap is what was never meant to be
 * sent: rule 16 makes the template a fallback for a writer outage, and the
 * people a refill adds were never in front of anybody. On 27 October the
 * repair cleared 92 notes across five running campaigns, nothing could fill
 * them, and every one of those people was about to be invited with the
 * standard line. So every live campaign is filled, by the same writer and
 * the same checks a new list gets.
 *
 * Only a blank note is written: a note somebody wrote or cleared is theirs,
 * and a row being sent this minute is left alone. Hourly, and a campaign that
 * was just tried rests `FILL_RETRY_MS`, so a person the writer cannot write
 * for costs a call a few times a day rather than every hour. A failed fill
 * leaves the template in place, exactly as before.
 */
export async function fillMissingNotes(ctx: WorkerContext, now: Date = new Date()): Promise<number> {
  const { data: gaps } = await ctx.db
    .from("campaign_prospects")
    .select("campaign_id")
    .eq("status", "queued")
    .is("invite_note", null)
    .neq("invite_note_edited", true)
    .limit(2000);
  const campaignIds = [...new Set((gaps ?? []).map((row) => row.campaign_id))];
  if (!campaignIds.length) return 0;

  const { data: campaigns } = await ctx.db
    .from("campaigns")
    .select("id, workspace_id, owner_user_id")
    .in("id", campaignIds)
    .in("status", ["draft", "running", "paused"]);
  if (!campaigns?.length) return 0;

  // Campaigns written for in the last few hours, by this job or by a person
  // pressing Rewrite. An unreadable history skips nobody: a fill is a no-op
  // once there is nothing blank, and waiting would send the standard line.
  const { data: recent } = await ctx.db
    .from("events")
    .select("subject_id")
    .eq("name", "campaign.notes_rewritten")
    .in("subject_id", campaigns.map((c) => c.id))
    .gte("created_at", new Date(now.getTime() - FILL_RETRY_MS).toISOString());
  const resting = new Set((recent ?? []).map((row) => row.subject_id));

  let written = 0;
  for (const campaign of campaigns) {
    if (!campaign.owner_user_id || resting.has(campaign.id)) continue;
    const result = await rewriteCampaignNotes(ctx, {
      workspaceId: campaign.workspace_id,
      userId: campaign.owner_user_id,
      campaignId: campaign.id,
      onlyMissing: true,
    }).catch((err) => {
      // One campaign's failure never costs another its notes.
      console.error("could not fill missing notes", { campaignId: campaign.id, err });
      return null;
    });
    if (result?.ok) written += result.rewritten;
  }
  return written;
}
