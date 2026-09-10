import {
  CampaignPlanSchema,
  FitScoreBatchSchema,
  type BusinessProfile,
  type CampaignPlan,
  type CustomerProfile,
  type FitScore,
  type ProspectCandidate,
} from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import {
  CAMPAIGN_PROMPT_VERSION,
  CAMPAIGN_SYSTEM,
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
