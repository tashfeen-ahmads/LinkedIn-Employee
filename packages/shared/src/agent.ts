import { z } from "zod";
import { MODEL_PRICING } from "./pricing.js";
import { MERGE_FIELDS } from "./merge-fields.js";

/**
 * An agent is the one place a rep changes what a prospect reads.
 *
 * Before this the same decision was spread over three screens and a constant in
 * the repo: the opener under "Opener & pitch", the offer beside it, the product
 * facts under "Knowledge base", and the voice that used all three hard-coded
 * where nobody outside the codebase could reach it. A rep who wanted the
 * messages to sound different had nowhere to go, and no way to see what a
 * change would produce until a stranger had already read it.
 *
 * So the agent gathers them. It does not replace the rules those parts carry —
 * `hooks` and `pitches` keep their approval, their retirement and their
 * defaults (rule 40), because those are what stand between an unapproved line
 * and a real person. What changes is only that a line can belong to an agent
 * rather than to the workspace at large.
 */

/**
 * The models a rep may choose from.
 *
 * Drawn from the price table rather than written again here. A model missing
 * from `MODEL_PRICING` costs `null` and never zero, which means a deployment
 * could otherwise be run on a model whose spend no screen can report — and
 * "free" is the one wrong answer about cost that nobody investigates.
 */
export const SELECTABLE_MODELS = Object.keys(MODEL_PRICING);

/** Whether this string is a model this deployment can price, and therefore run. */
export function isSelectableModel(model: string | null | undefined): boolean {
  return typeof model === "string" && model in MODEL_PRICING;
}

/**
 * A question the agent is trying to get answered before it hands over.
 *
 * `required` is what separates a playbook from a wish list. An agent that
 * treats every question as optional books the meeting having learned nothing,
 * and one that treats every question as required interrogates a stranger who
 * asked a simple thing — both are worse than no playbook.
 */
export const QualificationQuestionSchema = z.object({
  /** What the rep needs to know, in their words: "Do they run a chapter?" */
  ask: z.string().min(1).max(200),
  /** Whether a handover may happen without an answer. */
  required: z.boolean().default(false),
});
export type QualificationQuestion = z.infer<typeof QualificationQuestionSchema>;

/**
 * Everything the agent does once somebody replies.
 *
 * Deliberately small. Each field here is a sentence a rep can hold in their
 * head and check against a real conversation; a playbook nobody can read is a
 * playbook nobody can tell is wrong.
 */
export const AgentPlaybookSchema = z.object({
  /** What this agent is for, in one line, written to the model. */
  objective: z.string().max(500).default(""),
  /** What it needs to learn before the conversation is worth a human's time. */
  qualification: z.array(QualificationQuestionSchema).max(10).default([]),
  /**
   * When it stops and asks for a person.
   *
   * Never the only thing that stops it. The reply gate's own holds (rule 41)
   * still apply on top — a message below the confidence floor and a prospect
   * who asks for a human are held whatever this says, because the first is the
   * agent not knowing what was said and the second is the prospect's own wish.
   */
  handOver: z.string().max(500).default(""),
  /** Lines it must never use, in the rep's words. */
  avoid: z.string().max(500).default(""),
});
export type AgentPlaybook = z.infer<typeof AgentPlaybookSchema>;

/**
 * A merge field this workspace fills from its own prospect data.
 *
 * `first_name` and `company` are universal and live in `MERGE_FIELDS`. These
 * are the extra ones a particular business knows about its own list, and they
 * are stored so two screens can offer the same set: the editor, which warns
 * when copy uses a field the data cannot fill, and the test area, which shows
 * what actually resolves. An unresolved placeholder reaching a prospect is the
 * failure both exist to prevent.
 */
export const CustomFieldSchema = z.object({
  /** The token, without braces: `chapter_name`. */
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, "lower case letters, digits and underscores, starting with a letter"),
  /** What it means, for the person writing copy against it. */
  label: z.string().min(1).max(80),
  /** Used when a prospect has no value for it — blank means leave it visible. */
  fallback: z.string().max(120).default(""),
});
export type CustomField = z.infer<typeof CustomFieldSchema>;

/** A field name nobody may redefine, because the product already fills it. */
export function isReservedFieldKey(key: string): boolean {
  return (MERGE_FIELDS as readonly string[]).includes(key);
}

export const AgentSchema = z.object({
  name: z.string().min(1).max(80),
  model: z.string().nullable(),
  /** How it writes: voice, audience, what to avoid. The rep's own words. */
  systemPrompt: z.string().max(4000).nullable(),
  /**
   * Who the message appears to come from.
   *
   * Not always the account holder's full name — "Tashfeen" reads like a person
   * and "Tashfeen Ahmad Khan" reads like a signature block, and the difference
   * is the difference between a note and a mailshot.
   */
  fromName: z.string().max(80).nullable(),
  playbook: AgentPlaybookSchema,
  customFields: z.array(CustomFieldSchema).max(20),
});
export type Agent = z.infer<typeof AgentSchema>;

/**
 * What a brand new agent starts as.
 *
 * Not empty. An agent with no voice and no objective produces exactly the
 * unanchored copy this rework exists to replace, and a rep who opens a blank
 * form has been handed the problem rather than a starting point.
 */
export function blankAgent(repName: string | null): Agent {
  return {
    name: "New agent",
    model: SELECTABLE_MODELS[0] ?? null,
    systemPrompt:
      "Write like one person messaging another on LinkedIn. Short sentences, no marketing language, " +
      "no exclamation marks, and never more than you would actually type on a phone. " +
      "Say one specific thing about the person you are writing to.",
    fromName: repName,
    playbook: {
      objective: "",
      qualification: [],
      handOver: "",
      avoid: "Buzzwords, flattery, and any claim that is not in the agent's own notes.",
    },
    customFields: [],
  };
}

/**
 * The opener shape this product was asked for, and the one it should have had.
 *
 * A rep's own words: `Hi {{first_name}}, Tashfeen here regarding {{company}} —
 * are you getting referrals accordingly?` The agent-written openers that
 * replaced it read as generic because they were written to be clever rather
 * than to be recognisable, and a stranger recognises a person naming their
 * company faster than they recognise a good line.
 *
 * Kept as a template rather than a sentence so the fields resolve per prospect
 * (rule 16), and offered as the starting point on a new agent rather than
 * imposed: a rep who has a better opener should not have to delete ours first.
 */
export const DEFAULT_OPENER_TEMPLATE =
  "Hi {{first_name}}, {{rep_name}} here regarding {{company}} —";

/**
 * Whether an agent is complete enough to put in front of a stranger.
 *
 * Returned as a list of what is missing rather than a boolean, because "not
 * ready" with no reason is the message that sends somebody hunting through four
 * sections of a form.
 */
export function agentGaps(
  agent: Agent,
  counts: { approvedOpeners: number; approvedPitches: number },
): string[] {
  const gaps: string[] = [];
  if (!agent.name.trim()) gaps.push("a name");
  if (!isSelectableModel(agent.model)) gaps.push("a model this deployment can price");
  if (!agent.systemPrompt?.trim()) gaps.push("a description of how it should write");
  if (counts.approvedOpeners === 0) gaps.push("at least one approved opener");
  // Not a gap for every goal: a campaign that only asks for a reply never sends
  // an offer, and demanding one would hold up a campaign that cannot use it.
  if (counts.approvedPitches === 0) gaps.push("an approved offer line, if this agent will pitch");
  return gaps;
}
