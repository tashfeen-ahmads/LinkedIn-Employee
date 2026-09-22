import { z } from "zod";

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
  salesNavFilters: SalesNavFiltersSchema,
  hooks: z.array(z.string()).length(3).describe("Three opening angles for a connection note."),
  connectionNote: z.string().max(300).describe("Under 300 characters, no links, no pitch."),
  followUps: z
    .array(z.object({ delayDays: z.number().int().min(1).max(14), message: z.string().max(1200) }))
    .min(2)
    .max(3),
  priority: z.number().int().min(1).max(5).describe("1 = pursue first."),
});
export type CustomerProfile = z.infer<typeof CustomerProfileSchema>;

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
  body: z
    .string()
    .max(600)
    .describe("The offer in three to five sentences, in the company's own voice, no links."),
  factsUsed: z
    .array(z.string())
    .describe(
      "Each claim this pitch makes, quoted from the material supplied. What makes 'is this true' checkable rather than a matter of opinion.",
    ),
});
export type Pitch = z.infer<typeof PitchSchema>;

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
