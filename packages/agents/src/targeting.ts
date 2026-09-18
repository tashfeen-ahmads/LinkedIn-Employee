import {
  CTA_DEFINITIONS,
  CampaignPlanSchema,
  FitScoreBatchSchema,
  InviteNoteBatchSchema,
  type BusinessProfile,
  type CtaKind,
  type CampaignPlan,
  type CustomerProfile,
  type FitScore,
  type InviteNote,
  type ProspectCandidate,
} from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import {
  CAMPAIGN_PROMPT_VERSION,
  CAMPAIGN_SYSTEM,
  INVITE_NOTE_PROMPT_VERSION,
  INVITE_NOTE_SYSTEM,
  FIT_SCORE_PROMPT_VERSION,
  FIT_SCORE_SYSTEM,
} from "./prompts/targeting.js";
import { dedupeCandidates, intentScore, rankScore } from "./scoring.js";

export interface RankedProspect {
  candidate: ProspectCandidate;
  fitScore: number;
  fitReasons: string[];
  intentScore: number;
  rank: number;
  disqualified: boolean;
  disqualifyReason?: string;
}

const FIT_BATCH_SIZE = 25;
/* Smaller than the scoring batch: each note is written rather than scored, so
   the output per prospect is far larger and a big batch runs into max tokens. */
const NOTE_BATCH_SIZE = 10;

/**
 * Agent 2, part one. Scores candidates against a Customer Profile in batches
 * on the cheap model, then combines fit with the deterministic intent score.
 */
export async function scoreProspects(
  ctx: AgentContext,
  input: { profile: CustomerProfile; candidates: ProspectCandidate[] },
): Promise<RankedProspect[]> {
  const candidates = dedupeCandidates(input.candidates);
  if (candidates.length === 0) return [];

  const profileText = JSON.stringify(
    {
      name: input.profile.name,
      summary: input.profile.summary,
      jobTitles: input.profile.jobTitles,
      seniority: input.profile.seniority,
      industries: input.profile.industries,
      companySize: input.profile.companySize,
      geography: input.profile.geography,
      pains: input.profile.pains,
    },
    null,
    2,
  );

  const batches: ProspectCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += FIT_BATCH_SIZE) {
    batches.push(candidates.slice(i, i + FIT_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map((batch) =>
      callStructured(ctx, {
        agent: "targeting.fit",
        model: ctx.client.models.classifier,
        promptVersion: FIT_SCORE_PROMPT_VERSION,
        schema: FitScoreBatchSchema,
        system: [
          { text: FIT_SCORE_SYSTEM },
          // The ICP is constant across every batch in this run, so it is worth
          // a cache breakpoint: only the prospect list varies.
          { text: `Ideal customer profile:\n${profileText}`, cached: true },
        ],
        userContent: `Score every prospect below. Return one entry per providerId, no more, no fewer.\n\n${JSON.stringify(
          batch.map(toScoringView),
          null,
          2,
        )}`,
        maxTokens: 8000,
      }),
    ),
  );

  const byId = new Map<string, FitScore>();
  for (const batch of results) {
    for (const score of batch.scores) byId.set(score.providerId, score);
  }

  return candidates
    .map((candidate): RankedProspect => {
      const fit = byId.get(candidate.providerId);
      const intent = intentScore(candidate.signals ?? []);
      const fitScore = fit?.fitScore ?? 0;
      return {
        candidate,
        fitScore,
        fitReasons: fit?.reasons ?? [],
        intentScore: intent.score,
        rank: rankScore(fitScore, intent.score),
        disqualified: fit?.disqualified ?? !fit,
        disqualifyReason: fit ? (fit.disqualifyReason ?? undefined) : "not scored",
      };
    })
    .sort((a, b) => b.rank - a.rank);
}

function toScoringView(c: ProspectCandidate) {
  return {
    providerId: c.providerId,
    name: `${c.firstName} ${c.lastName}`.trim(),
    headline: c.headline,
    title: c.title,
    company: c.company,
    companySize: c.companySize,
    industry: c.industry,
    location: c.location,
    about: c.about?.slice(0, 400),
  };
}

/**
 * Agent 2, part two. Writes the launch-ready campaign: connection note plus two
 * or three follow-ups, in the company's voice.
 */
export async function buildCampaign(
  ctx: AgentContext,
  input: {
    business: BusinessProfile;
    profile: CustomerProfile;
    repName: string;
    repTitle?: string;
    dailyInviteCap: number;
    /**
     * What this campaign is asking for. Not always a meeting — and a sequence
     * written toward the wrong ask is a campaign that cannot convert whatever
     * it does to the copy.
     */
    cta: { kind: CtaKind; label: string | null; url: string | null };
    extraGuidance?: string;
  },
): Promise<CampaignPlan> {
  const context = [
    `Business profile:\n${JSON.stringify(input.business, null, 2)}`,
    `Customer profile being targeted:\n${JSON.stringify(input.profile, null, 2)}`,
    `The messages are sent by ${input.repName}${input.repTitle ? `, ${input.repTitle}` : ""}.`,
    ctaBrief(input.cta),
  ].join("\n\n");

  return callStructured(ctx, {
    agent: "targeting.campaign",
    model: ctx.client.models.writer,
    promptVersion: CAMPAIGN_PROMPT_VERSION,
    schema: CampaignPlanSchema,
    system: [
      { text: CAMPAIGN_SYSTEM },
      { text: context, cached: true },
    ],
    userContent: [
      `Write the campaign. Daily invite cap is ${input.dailyInviteCap}; set dailyInviteCap to that number.`,
      input.extraGuidance ? `\nAdditional instruction from the rep:\n${input.extraGuidance}` : "",
      "\nStop conditions should cover at minimum: prospect replies, prospect opts out, meeting booked.",
    ].join(""),
    // Writing, not reasoning. High effort on a copywriting task spent the whole
    // budget thinking and returned nothing -- a live campaign died on exactly
    // that -- and the extra thinking was never what made the copy good.
    effort: "medium",
    maxTokens: 16000,
  });
}

/**
 * What this campaign is asking for, in the writer's terms.
 *
 * The ask is the last line of the sequence, so it has to be in the prompt
 * rather than bolted on afterwards: a sequence written toward a call and then
 * edited to carry a link is a sequence whose first two messages were building
 * to something else.
 */
function ctaBrief(cta: { kind: CtaKind; label: string | null; url: string | null }): string {
  const definition = CTA_DEFINITIONS[cta.kind];
  const lines = [`The call to action for this campaign is: ${definition.label}.`, `Ask for ${definition.asks}.`];

  if (cta.label) lines.push(`Name it as "${cta.label}" when the copy needs a phrase for it.`);
  if (cta.kind === "link") {
    lines.push(
      "Write {{cta_link}} where the address goes — never the address itself, and never before the final step.",
    );
  }
  if (cta.kind === "meeting") {
    lines.push("Do not propose specific times; the product offers them and the prospect picks.");
  }
  if (cta.kind === "reply") {
    lines.push("There is no link and no meeting. The ask is a reply, so make replying easy and specific.");
  }
  return lines.join(" ");
}

export interface PersonalizedInvite extends InviteNote {
  /** The prompt that produced it, so a bad note traces to the version. */
  promptVersion: string;
}

/**
 * One connection note per prospect, written from that prospect's own details.
 *
 * The campaign's own `connectionNote` is a template with `{{first_name}}` in
 * it, and for a long time it was the only thing anyone received: every person
 * in a campaign got identical words. Everything the Targeting Agent had
 * learned about them was collected, scored, stored, shown on screen, and then
 * dropped at the moment it would have mattered.
 *
 * Written when the campaign is built rather than at send time, for two reasons.
 * A human reviews and launches the campaign, and they cannot review copy that
 * does not exist yet; and a send-time call puts a model on the path of an
 * action the rate limiter has already scheduled, where a slow or failed
 * response becomes a missed send rather than a visible problem.
 *
 * Returns notes only for prospects the model actually answered for. A missing
 * one is not an error — the caller falls back to the campaign template, which
 * is exactly the behaviour that existed before.
 */
export async function personalizeInvites(
  ctx: AgentContext,
  input: {
    business: BusinessProfile;
    profile: CustomerProfile;
    repName: string;
    campaignAngle: string;
    prospects: ProspectCandidate[];
  },
): Promise<Map<string, PersonalizedInvite>> {
  const byId = new Map<string, PersonalizedInvite>();
  if (input.prospects.length === 0) return byId;

  // Constant for every batch in this run, so it sits before the cache
  // breakpoint and only the people vary after it.
  const context = JSON.stringify(
    {
      rep: input.repName,
      sellerCompany: input.business.companyName,
      whatTheySell: input.business.oneLiner,
      // Tone is the one part of the business profile that should shape how a
      // note sounds. Offering and proof points deliberately stay out: a
      // connection request that pitches is the thing the prompt forbids.
      toneOfVoice: input.business.toneOfVoice,
      pursuing: { name: input.profile.name, summary: input.profile.summary, pains: input.profile.pains },
      angle: input.campaignAngle,
    },
    null,
    2,
  );

  const batches: ProspectCandidate[][] = [];
  for (let i = 0; i < input.prospects.length; i += NOTE_BATCH_SIZE) {
    batches.push(input.prospects.slice(i, i + NOTE_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map((batch) =>
      callStructured(ctx, {
        agent: "targeting.invite-note",
        // The writer, not the classifier: these words reach a real person under
        // a real rep's name.
        model: ctx.client.models.writer,
        promptVersion: INVITE_NOTE_PROMPT_VERSION,
        schema: InviteNoteBatchSchema,
        system: [
          { text: INVITE_NOTE_SYSTEM },
          { text: `Who is sending, and why:\n${context}`, cached: true },
        ],
        userContent: `Write one note per person below. Return one entry per providerId, no more, no fewer.\n\n${JSON.stringify(
          batch.map(toScoringView),
          null,
          2,
        )}`,
        maxTokens: 4000,
      }),
    ),
  );

  for (const batch of results) {
    for (const note of batch.notes) {
      // The 300-character ceiling is LinkedIn's, and a note over it is not
      // truncated by them — it is refused. The schema already caps it; this is
      // the second check, because a note that fails to send is indistinguishable
      // from a prospect who was never contacted.
      if (note.note.length > 300) continue;
      byId.set(note.providerId, { ...note, promptVersion: INVITE_NOTE_PROMPT_VERSION });
    }
  }
  return byId;
}
