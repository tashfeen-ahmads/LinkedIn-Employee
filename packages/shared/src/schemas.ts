import { z } from "zod";
import {
  HOOK_MAX_CHARS,
  HOOK_VARIANTS_MAX,
  HOOK_VARIANTS_MIN,
  PITCH_MAX_CHARS,
  PITCH_VARIANTS_MAX,
  PITCH_VARIANTS_MIN,
} from "./constants.js";

// ---------- Strategy Agent artifacts ----------

export const BusinessProfileSchema = z.object({
  companyName: z.string(),
  oneLiner: z.string().describe("One sentence: what the company sells and to whom."),
  offering: z.string().describe("Two to four sentences describing products or services."),
  pricingModel: z.string().describe("How they charge, or 'unknown'."),
  proofPoints: z.array(z.string()).describe("Concrete results, logos, awards, numbers."),
  toneOfVoice: z.string().describe("Three to six adjectives plus a sentence of guidance."),
  competitors: z.array(z.string()),
  commonObjections: z.array(z.string()),
  differentiators: z.array(z.string()),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const SalesNavFiltersSchema = z.object({
  titles: z.array(z.string()),
  seniorities: z.array(z.string()),
  industries: z.array(z.string()),
  companyHeadcount: z.array(z.string()).describe("Sales Navigator headcount buckets, e.g. '11-50', '51-200'."),
  geographies: z.array(z.string()),
  keywords: z.array(z.string()),
  excludeTitles: z.array(z.string()),
});
export type SalesNavFilters = z.infer<typeof SalesNavFiltersSchema>;

export const CustomerProfileSchema = z.object({
  name: z.string().describe("Short memorable name, e.g. 'Seed-stage SaaS founders'."),
  summary: z.string(),
  jobTitles: z.array(z.string()),
  seniority: z.array(z.string()),
  industries: z.array(z.string()),
  companySize: z.string(),
  geography: z.array(z.string()),
  triggerEvents: z.array(z.string()).describe("Observable events that make them ready to buy."),
  pains: z.array(z.string()),
  valueProposition: z.string(),
  /**
   * What this segment pays for, and what they do instead today.
   *
   * Two fields that a peer cannot fill honestly, which is the whole reason they
   * exist. Everything else on this schema reads identically whether the segment
   * buys this product or sells it: a title is a title, an industry is an
   * industry, and "referrals fall through the cracks" is a pain shared by the
   * people who need a referral engine and by the people building one. Asked for
   * "Customer Profiles" from a company's own website — which describes that
   * company's world in that company's vocabulary — a model returns the segments
   * that share the worldview, and those are the peers.
   *
   * Naming the purchase is the question a competitor fails. Somebody who sells
   * this does not buy it, and has nothing they do instead.
   *
   * `.nullable()` because a strategy written before these existed is still a
   * strategy a person approved, and refusing to read one would stop targeting
   * dead on every workspace. A null is reported on the screen as unsaid rather
   * than rendered as agreement — the same habit as rule 33.
   */
  whatTheyBuy: z
    .string()
    .nullable()
    .describe(
      "What this segment pays this company for, in the segment's own words. If they would sell this rather than buy it, they are a competitor and do not belong here.",
    ),
  insteadOfToday: z
    .string()
    .nullable()
    .describe(
      "What this segment does about this problem today: a tool they pay for, a manual process, somebody they hired, or nothing at all. This is the thing the purchase replaces.",
    ),
  salesNavFilters: SalesNavFiltersSchema,
  hooks: z
    .array(z.string())
    .min(3)
    .max(5)
    .describe(
      "Opening angles for a connection note — the line the invite writer leans on. Three to five, each naming a different pain.",
    ),
  connectionNote: z.string().max(300).describe("Under 300 characters, no links, no pitch."),
  followUps: z
    .array(z.object({ delayDays: z.number().int().min(1).max(14), message: z.string().max(1200) }))
    .min(2)
    .max(3),
  priority: z.number().int().min(1).max(5).describe("1 = pursue first."),
});
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

/**
 * Read a stored customer profile, whatever version of the schema wrote it.
 *
 * `whatTheyBuy` and `insteadOfToday` arrived after seven live strategies had
 * already been written and approved, and `targeting.ts` parses this spec with a
 * bare `.parse()` — so a new required key would have thrown on every existing
 * row and stopped prospecting on every workspace at once. A backfill would have
 * fixed the rows already there and left the window between the migration and
 * the deploy, where old code writes an old-shaped row that new code then
 * refuses to read.
 *
 * Defaulting at the read closes both. The spread order matters: a stored value
 * always wins, and the nulls only fill what was never written.
 */
export function parseCustomerProfile(
  spec: unknown,
): ReturnType<typeof CustomerProfileSchema.safeParse> {
  const filled =
    spec && typeof spec === "object"
      ? { whatTheyBuy: null, insteadOfToday: null, ...(spec as Record<string, unknown>) }
      : spec;
  return CustomerProfileSchema.safeParse(filled);
}

export const StrategyOutputSchema = z.object({
  businessProfile: BusinessProfileSchema,
  customerProfiles: z.array(CustomerProfileSchema).min(3).max(5),
});
export type StrategyOutput = z.infer<typeof StrategyOutputSchema>;

// ---------- The pitch ----------

/**
 * The offer, written once and made to everybody.
 *
 * Under 600 characters because it is spoken into a LinkedIn message, not a
 * landing page: the pitch is what somebody reads on a phone, in a chat window,
 * two sentences after they asked what this is. A pitch long enough to need
 * scrolling is a pitch that gets skimmed and then ignored.
 */
export const PitchSchema = z.object({
  /** Short enough to head a column on a results table. "Referral leakage". */
  name: z.string().max(40),
  body: z
    .string()
    .max(PITCH_MAX_CHARS)
    .describe(
      `The offer in one line, ${PITCH_MAX_CHARS} characters at the absolute most, in the company's own voice, no links.`,
    ),
  /**
   * Which pain this line names, so the four are visibly four different bets
   * rather than one sentence written four ways.
   */
  angle: z.string().max(200),
  factsUsed: z
    .array(z.string())
    .describe(
      "Each claim this pitch makes, quoted from the material supplied. What makes 'is this true' checkable rather than a matter of opinion.",
    ),
});
export type Pitch = z.infer<typeof PitchSchema>;

/**
 * What the agent returns: several pitches, not one.
 *
 * One pitch is an opinion nobody can check. Four are a test — and because an
 * angle owns its prospect end to end (rule 28), the pitch a person hears is the
 * one belonging to the angle their invitation was written for, so the acceptance
 * and the reply are finally measuring the same thing.
 */
export const PitchSetSchema = z.object({
  variants: z.array(PitchSchema).min(PITCH_VARIANTS_MIN).max(PITCH_VARIANTS_MAX),
});
export type PitchSet = z.infer<typeof PitchSetSchema>;

// ---------- The opener ----------

/**
 * One opening line, and the bet it places.
 *
 * Not a note. The note is written for the person receiving it (rule 16); this
 * is the shape it takes, and the question it leads with. A hook reproduced word
 * for word is the template it was meant to replace, and everybody in the batch
 * gets the same sentence.
 */
export const HookSchema = z.object({
  /** Short enough to head a column on a results table. "Measurement". */
  name: z.string().max(40),
  body: z
    .string()
    .max(HOOK_MAX_CHARS)
    .describe(
      `The opening line, ${HOOK_MAX_CHARS} characters at the absolute most. A question they can answer in one line, no pitch, no link.`,
    ),
  /** Which bet it places, written to the salesperson and not to the prospect. */
  angle: z.string().max(200),
});
export type Hook = z.infer<typeof HookSchema>;

export const HookSetSchema = z.object({
  variants: z.array(HookSchema).min(HOOK_VARIANTS_MIN).max(HOOK_VARIANTS_MAX),
});
export type HookSet = z.infer<typeof HookSetSchema>;

// ---------- Targeting Agent ----------

export const IntentSignalSchema = z.object({
  type: z.enum([
    "new_role",
    "company_hiring",
    "recent_funding",
    "posted_recently",
    "engaged_with_content",
    "viewed_profile",
    "follows_company",
    "open_to_work",
    "other",
  ]),
  detail: z.string(),
  observedAt: z.string().describe("ISO date"),
  weight: z.number().min(0).max(1),
});
export type IntentSignal = z.infer<typeof IntentSignalSchema>;

export const ProspectCandidateSchema = z.object({
  providerId: z.string(),
  linkedinUrl: z.url(),
  firstName: z.string(),
  lastName: z.string(),
  headline: z.string().optional(),
  title: z.string().optional(),
  company: z.string().optional(),
  companySize: z.string().optional(),
  industry: z.string().optional(),
  location: z.string().optional(),
  about: z.string().optional(),
  signals: z.array(IntentSignalSchema).default([]),
});
export type ProspectCandidate = z.infer<typeof ProspectCandidateSchema>;

export const FitScoreSchema = z.object({
  providerId: z.string(),
  fitScore: z.number().int().min(0).max(100),
  reasons: z.array(z.string()).max(3),
  disqualified: z.boolean(),
  disqualifyReason: z.string().nullable(),
});
export type FitScore = z.infer<typeof FitScoreSchema>;

export const FitScoreBatchSchema = z.object({ scores: z.array(FitScoreSchema) });

/**
 * The connection note written for one named person.
 *
 * `grounding` is not decoration. It names the prospect's own details the note
 * leaned on, which makes two things checkable that are otherwise a matter of
 * opinion: whether the note is actually about this person, and whether the
 * model made something up. An empty grounding means the note could have been
 * sent to anybody, and the campaign screen says so rather than letting it pass
 * as personalised.
 *
 * Model-facing, so `.nullable()` rather than `.optional()` — structured outputs
 * reject optional keys.
 */
export const InviteNoteSchema = z.object({
  providerId: z.string(),
  /** LinkedIn's hard ceiling for a connection request note. */
  note: z.string().max(300),
  /** Which of this prospect's details the note used, quoted from the input. */
  grounding: z.array(z.string()).max(3),
  /**
   * Set when the prospect's details were too thin to say anything specific.
   * Honest thinness beats invented familiarity: a note that guesses wrong is
   * worse than one that is merely polite.
   */
  tooThin: z.boolean(),
});
export type InviteNote = z.infer<typeof InviteNoteSchema>;

export const InviteNoteBatchSchema = z.object({ notes: z.array(InviteNoteSchema) });

/**
 * One angle a campaign is testing.
 *
 * The angle is the variable, not the words: every prospect gets a note written
 * from their own details, so what a group of them shares is the pain named and
 * the reason for reaching out. `connectionNote` here is this angle's fallback —
 * what somebody receives when the writer produced nothing for them — and it has
 * to carry the angle too, or a fallback quietly moves that person into an
 * unnamed fourth variant while still counting under this one.
 */
export const CampaignVariantSchema = z.object({
  /** Short enough to head a column on the results table. */
  name: z.string().max(40),
  /** What the writer leans on. Two or three sentences of instruction. */
  angle: z.string().max(600),
  /** The specific pain this angle names, or null when it names none. */
  painPoint: z.string().max(300).nullable(),
  connectionNote: z.string().max(300),
  /**
   * This angle's own follow-ups.
   *
   * An angle that stops at the connection request is only half tested. The
   * prospect accepted *because of* the angle; if the first message then arrives
   * in the campaign's generic voice, the acceptance is attributed to the angle
   * and the reply is not, and the two halves of the funnel are measuring
   * different things.
   */
  steps: z
    .array(
      z.object({
        delayDays: z.number().int().min(1).max(14),
        message: z.string().max(1200),
      }),
    )
    .min(2)
    .max(3),
});
export type CampaignVariantPlan = z.infer<typeof CampaignVariantSchema>;

export const CampaignPlanSchema = z.object({
  name: z.string(),
  connectionNote: z.string().max(300),
  /**
   * Two or three genuinely different angles, not rewordings.
   *
   * Capped at three because each one splits the same finite list: a campaign of
   * fifty across four angles gives twelve apiece, which cannot separate
   * anything and costs a week to find that out.
   */
  variants: z.array(CampaignVariantSchema).min(2).max(3),
  steps: z
    .array(
      z.object({
        kind: z.enum(["follow_up"]),
        delayDays: z.number().int().min(1).max(14),
        message: z.string().max(1200),
      }),
    )
    .min(2)
    .max(3),
  stopConditions: z.array(z.string()),
  dailyInviteCap: z.number().int().min(1).max(40),
});
export type CampaignPlan = z.infer<typeof CampaignPlanSchema>;

// ---------- Reply Agent ----------

export const ReplyIntentSchema = z.enum([
  "interested",
  "question",
  "objection",
  "not_now",
  "not_interested",
  "out_of_office",
  "referral",
  "spam",
  "other",
]);
export type ReplyIntent = z.infer<typeof ReplyIntentSchema>;

export const ReplyClassificationSchema = z.object({
  intent: ReplyIntentSchema,
  sentiment: z.enum(["positive", "neutral", "negative"]),
  needsHuman: z.boolean(),
  needsHumanReason: z.string().nullable(),
  mentionsPricing: z.boolean(),
  mentionsLegalOrCompliance: z.boolean(),
  asksForHuman: z.boolean(),
  optOut: z.boolean(),
  referralName: z.string().nullable(),
  followUpAfterDays: z.number().int().min(1).max(180).nullable(),
  confidence: z.number().min(0).max(1),
});
export type ReplyClassification = z.infer<typeof ReplyClassificationSchema>;

export const ReplyDraftSchema = z.object({
  message: z.string().max(1500),
  proposesMeeting: z.boolean(),
  proposedSlots: z.array(z.string()).max(3).describe("The slots you offered, copied verbatim from the list you were given."),
  usedKnowledge: z.array(z.string()).describe("Which knowledge-base snippets informed the answer."),
  unansweredQuestions: z.array(z.string()),
});
export type ReplyDraft = z.infer<typeof ReplyDraftSchema>;

export const RulesOfEngagementSchema = z.object({
  mode: z.enum(["approval", "autopilot"]).default("approval"),
  /**
   * How much the agent finishes on its own.
   *
   * `supervised` is the cautious default and what every campaign had: anything
   * the classifier felt uncertain about waits for a person.
   *
   * `autonomous` is for a workspace where nobody is watching the inbox, which
   * is most of them. The distinction matters because a hold is not a pause —
   * it is a full stop. A prospect who replies "how much is it?" on a Friday and
   * is never answered is not a conversation being handled carefully; it is a
   * warm lead lost, and the funnel reads 0% for a reason no screen explains.
   *
   * It does not loosen what the agent may *say*: the knowledge base is still
   * the only source of product facts (rule 11), the link check still holds an
   * invented URL (rule 30), and an opt-out still stops everything (rule 7).
   * It changes who finishes the sentence, never what the sentence may contain.
   */
  autonomy: z.enum(["supervised", "autonomous"]).default("supervised"),
  goal: z.enum(["book_meeting", "qualify_then_book", "nurture"]).default("book_meeting"),
  handOffOnPricing: z.boolean().default(true),
  handOffOnNegative: z.boolean().default(true),
  handOffOnLegal: z.boolean().default(true),
  handOffOnHumanRequest: z.boolean().default(true),
  minConfidence: z.number().min(0).max(1).default(0.75),
  workingHours: z
    .object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24), days: z.array(z.number().int().min(0).max(6)) })
    .default({ start: 8, end: 18, days: [1, 2, 3, 4, 5] }),
  timezone: z.string().default("UTC"),
  bookingLink: z.url().optional(),
});
export type RulesOfEngagement = z.infer<typeof RulesOfEngagementSchema>;

// ---------- Campaign prospect state machine ----------

export const CampaignProspectStatus = z.enum([
  "queued",
  "invited",
  "accepted",
  "messaged_1",
  "messaged_2",
  "messaged_3",
  "replied",
  "positive",
  "negative",
  "meeting_booked",
  "closed",
  "opted_out",
  "failed",
]);
export type CampaignProspectStatus = z.infer<typeof CampaignProspectStatus>;

/** Legal transitions. Anything not listed is rejected by the worker. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignProspectStatus, readonly CampaignProspectStatus[]> = {
  queued: ["invited", "closed", "failed"],
  invited: ["accepted", "closed", "failed", "replied"],
  accepted: ["messaged_1", "replied", "closed"],
  messaged_1: ["messaged_2", "replied", "closed"],
  messaged_2: ["messaged_3", "replied", "closed"],
  messaged_3: ["replied", "closed"],
  replied: ["positive", "negative", "opted_out", "closed", "meeting_booked"],
  positive: ["meeting_booked", "negative", "closed", "opted_out"],
  negative: ["closed", "positive"],
  meeting_booked: ["closed"],
  closed: [],
  opted_out: [],
  failed: ["queued"],
};

export function canTransition(from: CampaignProspectStatus, to: CampaignProspectStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}
