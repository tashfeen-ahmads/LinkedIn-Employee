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
  INVITE_NOTE_MAX_CHARS,
  campaignNameWithoutCta,
  clampFitScore,
  rewriteInstruction,
  tidyVoice,
  voiceProblems,
  type MessageKind,
  type VoiceOptions,
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
  input: {
    profile: CustomerProfile;
    candidates: ProspectCandidate[];
    /**
     * What the company sells, and who it competes with.
     *
     * The scorer's own rule has always said to disqualify a competitor, and
     * until now it was told nothing about the company — so "is this person a
     * competitor" was a question it had no way to answer, and it answered by
     * matching job titles against the profile instead. Nullable because one
     * caller scores against a profile with no business row loaded, and a scorer
     * that refused to run without it would stop prospecting to gain a hint.
     */
    business?: { oneLiner: string; competitors: string[] } | null;
  },
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
      // The two fields that make this a question about need rather than about
      // resemblance. Without them the scorer sees a list of titles and an
      // industry, which a competitor matches perfectly — they have the same
      // titles in the same industry, and they are the last people to write to.
      whatTheyBuy: input.profile.whatTheyBuy,
      insteadOfToday: input.profile.insteadOfToday,
    },
    null,
    2,
  );

  const businessText = input.business
    ? JSON.stringify(
        { sells: input.business.oneLiner, competesWith: input.business.competitors },
        null,
        2,
      )
    : null;

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
          // The ICP and the business are constant across every batch in this
          // run, so they are worth a cache breakpoint: only the prospect list
          // varies.
          ...(businessText
            ? [{ text: `The company you are prospecting for:\n${businessText}`, cached: true }]
            : []),
          { text: `Ideal customer profile:\n${profileText}`, cached: true },
        ],
        userContent: `Score every prospect below. Return one entry per providerId, no more, no fewer.\n\n${JSON.stringify(
          batch.map(toScoringView),
          null,
          2,
        )}`,
        /*
         * Scoring is applying a rubric, not thinking it through.
         *
         * It set no effort at all, so it took the default and spent an
         * average of 4,314 output tokens to return a number and a sentence
         * per prospect — three times what it was given to read. On a
         * reasoning model the thinking is billed as output, and output costs
         * about four times input, so this was the largest line on the bill.
         *
         * The rubric is in the prompt and the fields are in the schema. What
         * the extra reasoning bought was a longer path to the same shape.
         */
        effort: "minimal",
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
      // The model's number is cast, not parsed, so its bounds are enforced
      // here: an integer 0..100, and a score that is not a number at all is
      // nobody's score (0, disqualified) rather than a guess.
      const clamped = fit ? clampFitScore(fit.fitScore) : { score: 0, usable: false };
      const fitScore = clamped.score;
      return {
        candidate,
        fitScore,
        fitReasons: fit?.reasons ?? [],
        intentScore: intent.score,
        rank: rankScore(fitScore, intent.score),
        disqualified: !clamped.usable || (fit?.disqualified ?? !fit),
        disqualifyReason: !fit
          ? "not scored"
          : !clamped.usable
            ? "unreadable score"
            : (fit.disqualifyReason ?? undefined),
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
    /**
     * What exists to hand a prospect who says yes: the titles of the knowledge
     * documents this campaign's agent may read. The CTA is added here. An
     * offer of an example, a checklist or a guide is allowed only when one of
     * these names it, because a yes to "want a quick checklist?" with nothing
     * behind it is a promise nobody can keep.
     */
    assets?: string[];
    /**
     * How this workspace wants the agent to write, in the rep's own words
     * (`voiceOf`), exactly as the invitation writer is handed it. Appended
     * after the shipped rules, never instead of them. Without it the note was
     * written in the rep's voice and every follow-up in nobody's.
     */
    voice?: string;
    extraGuidance?: string;
  },
): Promise<CheckedCampaignPlan> {
  const assets = [
    ...(input.assets ?? []),
    ...(input.cta.label ? [input.cta.label] : []),
    ...(input.cta.url ? [input.cta.url] : []),
  ].filter((asset) => asset.trim());
  const context = [
    `Business profile:\n${JSON.stringify(input.business, null, 2)}`,
    `Customer profile being targeted:\n${JSON.stringify(input.profile, null, 2)}`,
    `The messages are sent by ${input.repName}${input.repTitle ? `, ${input.repTitle}` : ""}.`,
    ctaBrief(input.cta),
    assets.length
      ? `What exists to send (the only things a message may offer to hand over):\n${assets.map((a) => `- ${a}`).join("\n")}`
      : "What exists to send: nothing. Offer no example, checklist, guide, template, audit, case study or sample.",
  ].join("\n\n");
  const checks: VoiceOptions = { assets, ctaLabel: input.cta.label };

  const ask = (extra?: string) =>
    callStructured(ctx, {
      agent: "targeting.campaign",
      model: ctx.client.models.writer,
      promptVersion: CAMPAIGN_PROMPT_VERSION,
      schema: CampaignPlanSchema,
      system: [
        { text: CAMPAIGN_SYSTEM },
        // After the shipped rules and before the breakpoint: identical for
        // the first call and its one rewrite.
        ...(input.voice ? [{ text: input.voice, cached: true }] : []),
        { text: context, cached: true },
      ],
      userContent: [
        `Write the campaign. Daily invite cap is ${input.dailyInviteCap}; set dailyInviteCap to that number.`,
        input.extraGuidance ? `\nAdditional instruction from the rep:\n${input.extraGuidance}` : "",
        "\nStop conditions should cover at minimum: prospect replies, prospect opts out, meeting booked.",
        extra ? `\n\n${extra}` : "",
      ].join(""),
      // Writing, not reasoning. High effort on a copywriting task spent the whole
      // budget thinking and returned nothing -- a live campaign died on exactly
      // that -- and the extra thinking was never what made the copy good.
      effort: "medium",
      maxTokens: 16000,
    });

  /*
   * Every message is checked in code (`voiceProblems`), because the prompt
   * alone is never trusted: `callStructured` casts. A plan with problems gets
   * one rewrite, handed the exact list. What still fails after that is
   * returned, not hidden, so the campaign records it; a person reviews the
   * copy before launch, and the send path holds an unfilled placeholder.
   */
  const first = tidyPlan(await ask(), input.cta.label);
  const firstProblems = planVoiceProblems(first, checks);
  if (!firstProblems.length) return { ...first, voiceProblems: [] };
  let second: CampaignPlan;
  try {
    second = tidyPlan(
      await ask(
        `${rewriteInstruction(firstProblems)}\n\nRewrite only the messages named above and keep everything else. Your last version was:\n${JSON.stringify(first)}`,
      ),
      input.cta.label,
    );
  } catch {
    // The rewrite is an improvement, never a reason to lose the campaign.
    return { ...first, voiceProblems: firstProblems };
  }
  const secondProblems = planVoiceProblems(second, checks);
  return secondProblems.length > firstProblems.length
    ? { ...first, voiceProblems: firstProblems }
    : { ...second, voiceProblems: secondProblems };
}

export type CheckedCampaignPlan = CampaignPlan & {
  /** What still did not read like a person after the one rewrite, by message. */
  voiceProblems: string[];
};

/** Which kind of message a step is: the first after an acceptance is held to the shortest limit. */
function stepKind(index: number): MessageKind {
  return index === 0 ? "first_message" : "follow_up";
}

function tidyPlan(plan: CampaignPlan, ctaLabel: string | null): CampaignPlan {
  return {
    ...plan,
    // Never the call to action in the name (`campaignNameWithoutCta`).
    name: campaignNameWithoutCta(plan.name ?? "", ctaLabel),
    connectionNote: tidyVoice(plan.connectionNote),
    steps: plan.steps.map((step) => ({ ...step, message: tidyVoice(step.message) })),
    variants: plan.variants.map((variant) => ({
      ...variant,
      connectionNote: tidyVoice(variant.connectionNote),
      steps: variant.steps.map((step) => ({ ...step, message: tidyVoice(step.message) })),
    })),
  };
}

/**
 * Every message in a plan, checked, each problem prefixed with where it is.
 * `options` carries what exists to offer and the CTA's label, so an
 * undeliverable offer or a pasted label is a problem like a dash is.
 */
export function planVoiceProblems(plan: CampaignPlan, options: Omit<VoiceOptions, "template"> = {}): string[] {
  const out: string[] = [];
  const check = (where: string, text: string, kind: MessageKind) => {
    // Templates: {{first_name}} is filled per person at send time.
    for (const problem of voiceProblems(text, kind, { ...options, template: true })) out.push(`${where}: ${problem}`);
  };
  check("Connection note", plan.connectionNote, "invite_note");
  plan.steps.forEach((step, i) => check(`Follow-up ${i + 1}`, step.message, stepKind(i)));
  for (const variant of plan.variants) {
    check(`Angle "${variant.name}" connection note`, variant.connectionNote, "invite_note");
    variant.steps.forEach((step, i) => check(`Angle "${variant.name}" follow-up ${i + 1}`, step.message, stepKind(i)));
  }
  return out;
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

  // The label is what the business calls the button. Told to "name it as" the
  // label, the writer pasted it in title case into the last step and the
  // campaign's name: "If yes, Book a Free Consultation and pick a time".
  if (cta.label) {
    lines.push(
      `The business calls it "${cta.label}". That is a button's name, not a phrase for a sentence: say what they get in plain lowercase words, the way a person texting would ("happy to grab 20 minutes?"), and never put it in the campaign name.`,
    );
  }
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
    /**
     * The opening lines a person approved on /app/strategy.
     *
     * The Strategy Agent has written these since the first week and nothing
     * ever consumed one: written, stored, approved, rendered under "Opening
     * angles", and then dropped at the single moment they mattered — exactly
     * what rule 16 says happened to the prospect research before this function
     * existed. They are shapes to lean on, never text to copy: the note is
     * still written for the person receiving it.
     */
    hooks?: string[];
    /**
     * Openers a person approved for the agent or the workspace, not for this
     * strategy or angle.
     *
     * Offered as optional shapes and nothing more. They used to replace the
     * strategy's own openers outright, so one line written for founders went
     * to every strategy the workspace ran and recruiters received "Quick yes
     * or no Maria: do founders still run outbound where you hire". The writer
     * is told to use one only when its question applies to this person, and a
     * note that borrows its words is rewritten (`openerProblems`).
     */
    otherOpeners?: string[];
    /**
     * Approved openers tied to no audience: the agent's or the workspace's
     * own, attached to no angle. They are this business's lines rather than
     * another audience's, so the note may lean on one's shape where it fits;
     * it is only checked for pasting, never for borrowing.
     */
    sharedOpeners?: string[];
    /**
     * How this workspace wants the agent to write, in the rep's own words.
     *
     * Appended to the shipped prompt rather than replacing it. That prompt
     * carries the rules that keep a note inside LinkedIn's limit, keep a link
     * out of a connection request and keep the agent from stating a fact
     * nobody gave it — a rep's opinion about voice is worth a great deal and
     * is not worth any of those.
     *
     * Before an agent could carry this, the voice was a constant in the repo:
     * a rep who wanted the notes to sound like them had no way to say so, and
     * the result read as software because it was written by software with
     * nobody's instructions in it.
     */
    voice?: string;
    /**
     * The model the campaign's agent selected, when this deployment can serve
     * it. Absent falls back to the deployment's own writer, which is what
     * every campaign used before an agent could choose.
     */
    model?: string;
    prospects: ProspectCandidate[];
  },
): Promise<Map<string, PersonalizedInvite>> {
  const byId = new Map<string, PersonalizedInvite>();
  if (input.prospects.length === 0) return byId;
  const ownOpeners = input.hooks ?? [];
  const foreignOpeners = (input.otherOpeners ?? []).filter((line) => !ownOpeners.includes(line));
  const sharedOpeners = (input.sharedOpeners ?? []).filter(
    (line) => !ownOpeners.includes(line) && !foreignOpeners.includes(line),
  );

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
      // Named `openingAngles` rather than `hooks` because the model is being
      // told what they are for: shapes the note may take, not lines to paste.
      openingAngles: input.hooks?.length ? input.hooks : undefined,
      otherApprovedOpeners: foreignOpeners.length ? foreignOpeners : undefined,
      sharedOpeners: sharedOpeners.length ? sharedOpeners : undefined,
    },
    null,
    2,
  );

  const batches: ProspectCandidate[][] = [];
  for (let i = 0; i < input.prospects.length; i += NOTE_BATCH_SIZE) {
    batches.push(input.prospects.slice(i, i + NOTE_BATCH_SIZE));
  }

  const write = (batch: ProspectCandidate[], extra?: string) =>
    callStructured(ctx, {
      agent: "targeting.invite-note",
      // The writer, not the classifier: these words reach a real person under
      // a real rep's name. The agent's own choice when it has one this
      // deployment can actually serve.
      model: input.model ?? ctx.client.models.writer,
      promptVersion: INVITE_NOTE_PROMPT_VERSION,
      schema: InviteNoteBatchSchema,
      system: [
        { text: INVITE_NOTE_SYSTEM },
        // After the shipped rules, never instead of them, and before the
        // cache breakpoint: it is identical for every batch in this run.
        ...(input.voice ? [{ text: input.voice, cached: true }] : []),
        { text: `Who is sending, and why:\n${context}`, cached: true },
      ],
      userContent: `Write one note per person below. Return one entry per providerId, no more, no fewer.${extra ? `\n\n${extra}` : ""}\n\n${JSON.stringify(
        batch.map(toScoringView),
        null,
        2,
      )}`,
      // One sentence per person, from details already selected and handed
      // over. The judgement went into the prompt and the grounding; what is
      // left is writing, and it was costing 2,818 output tokens a batch.
      effort: "low",
      maxTokens: 4000,
    });

  const results = await Promise.all(batches.map((batch) => write(batch)));

  // What is wrong with a note, or why it cannot be sent at all. Empty is a
  // note that may go. LinkedIn refuses the whole invitation over its ceiling,
  // so length is a second check on top of the schema's, because a note that
  // fails to send is indistinguishable from a prospect who was never contacted.
  //
  // Nothing exists to send from a connection request (no assets), and the
  // openers are checked so an approved line is a shape and never the text.
  const problemsOf = (text: string) =>
    text.length > INVITE_NOTE_MAX_CHARS
      ? [`It is ${text.length} characters. Keep it under ${INVITE_NOTE_MAX_CHARS}.`]
      : voiceProblems(text, "invite_note", { openers: { own: [...ownOpeners, ...sharedOpeners], foreign: foreignOpeners } });

  const failed = new Map<string, string[]>();
  for (const batch of results) {
    for (const raw of batch.notes) {
      const note = { ...raw, note: tidyVoice(raw.note) };
      const problems = problemsOf(note.note);
      if (problems.length) failed.set(note.providerId, problems);
      else byId.set(note.providerId, { ...note, promptVersion: INVITE_NOTE_PROMPT_VERSION });
    }
  }

  /*
   * A note that reads like a template (a quoted job title, a pitch, a dash)
   * gets one rewrite, told exactly what was wrong with it. What still fails
   * is left out, and the caller falls back to the angle's own note, which a
   * person reviews before launch — never a flawed note sent anyway.
   */
  const retry = input.prospects.filter((p) => failed.has(p.providerId));
  if (retry.length) {
    const instruction = [
      "These notes were written once and did not read like a person wrote them. Write each again so none of its problems is true:",
      ...retry.map((p) => `- ${p.providerId}: ${failed.get(p.providerId)!.join(" ")}`),
    ].join("\n");
    for (let i = 0; i < retry.length; i += NOTE_BATCH_SIZE) {
      let again;
      try {
        again = await write(retry.slice(i, i + NOTE_BATCH_SIZE), instruction);
      } catch {
        continue;
      }
      for (const raw of again.notes) {
        if (!failed.has(raw.providerId) || byId.has(raw.providerId)) continue;
        const note = { ...raw, note: tidyVoice(raw.note) };
        if (problemsOf(note.note).length) continue;
        byId.set(note.providerId, { ...note, promptVersion: INVITE_NOTE_PROMPT_VERSION });
      }
    }
  }
  return byId;
}
