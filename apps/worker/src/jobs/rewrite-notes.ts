import { personalizeInvites } from "@le/agents";
import {
  BusinessProfileSchema,
  parseCustomerProfile,
  type ProspectCandidate,
} from "@le/shared";
import type { WorkerContext } from "../context.js";
import { recordEvent } from "../context.js";
import { agentForCampaign, modelFor, openersFor, voiceOf } from "../agent.js";

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
    .select("id, name, agent_id, customer_profile_id, owner_user_id, rules")
    .eq("id", input.campaignId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (!campaign) return { ok: false, reason: "That campaign is not in this workspace." };

  // Queued only. Every other status has either already been sent to or has
  // been dealt with, and both are records rather than plans.
  const { data: queued } = await db
    .from("campaign_prospects")
    .select("id, prospect_id, variant_id")
    .eq("campaign_id", campaign.id)
    .eq("workspace_id", input.workspaceId)
    .eq("status", "queued");

  if (!queued?.length) {
    return {
      ok: false,
      reason: "Nobody on this campaign is still waiting to be invited, so there is nothing to rewrite.",
    };
  }

  const { data: profileRow } = await db
    .from("business_profiles")
    .select("spec")
    .eq("workspace_id", input.workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const business = BusinessProfileSchema.safeParse(profileRow?.spec);
  if (!business.success) {
    return { ok: false, reason: "Tell us what you sell first — the notes are written from your business profile." };
  }

  const { data: customerRow } = campaign.customer_profile_id
    ? await db
        .from("customer_profiles")
        .select("spec")
        .eq("id", campaign.customer_profile_id)
        .eq("workspace_id", input.workspaceId)
        .maybeSingle()
    : { data: null };
  const customer = parseCustomerProfile(customerRow?.spec);
  if (!customer.success) {
    // Named rather than guessed at: a note written without the segment is
    // written for nobody in particular, which is the generic copy this exists
    // to replace.
    return {
      ok: false,
      reason: "This campaign is not attached to a strategy, so there is nothing to say who these people are.",
    };
  }

  // Fetched separately rather than as an embedded join: PostgREST returns the
  // related row and the fake database used in the tests cannot, so a join here
  // is a query that behaves differently in the two places it runs.
  const { data: people } = await db
    .from("prospects")
    .select("id, provider_id, first_name, last_name, headline, title, company, location, linkedin_url")
    .eq("workspace_id", input.workspaceId)
    .in("id", queued.map((row) => row.prospect_id));

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
    (campaign.rules as { angle?: string } | null)?.angle?.trim() || campaign.name;

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

  /*
   * One call per angle, not one for everybody.
   *
   * The angle is the variable under test, so a single call covering all of
   * them would leave the writer choosing which to lean on per person — and the
   * group labels would then describe an assignment nobody made.
   */
  const groups = new Map<
    string,
    { angle: string; hooks: string[]; rows: Array<{ id: string }>; prospects: ProspectCandidate[] }
  >();

  for (const row of queued) {
    const person = byProspectId.get(row.prospect_id);
    if (!person?.provider_id) continue;
    const variant = row.variant_id ? variantById.get(row.variant_id) : undefined;
    const own = variant?.hook_id ? hookById.get(variant.hook_id) : undefined;
    const key = variant?.id ?? "none";
    const group =
      groups.get(key) ??
      {
        angle: variant?.angle ?? campaignAngle,
        hooks: own ? [own, ...openers.filter((line) => line !== own)] : openers,
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
        business: business.data,
        profile: customer.data,
        repName: agent?.fromName?.trim() || rep?.full_name || business.data.companyName,
        campaignAngle: group.angle,
        hooks: group.hooks.length ? group.hooks : customer.data.hooks,
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
  let unanswered = 0;
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
      const { error } = await db
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
      if (error) return { ok: false, reason: error.message };
      rewritten += 1;
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
