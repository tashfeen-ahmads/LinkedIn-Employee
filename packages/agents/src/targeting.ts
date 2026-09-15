import {
  CampaignPlanSchema,
  FitScoreBatchSchema,
  InviteNoteBatchSchema,
  type BusinessProfile,
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
    extraGuidance?: string;
  },
): Promise<CampaignPlan> {
  const context = [
    `Business profile:\n${JSON.stringify(input.business, null, 2)}`,
    `Customer profile being targeted:\n${JSON.stringify(input.profile, null, 2)}`,
    `The messages are sent by ${input.repName}${input.repTitle ? `, ${input.repTitle}` : ""}.`,
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
    effort: "high",
    maxTokens: 8000,
  });
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
