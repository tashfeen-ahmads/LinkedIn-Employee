import { PitchSchema, type BusinessProfile, type Pitch } from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import { renderKnowledge } from "./knowledge.js";
import { PITCH_PROMPT_VERSION, PITCH_SYSTEM } from "./prompts/pitch.js";

export interface PitchInput {
  business: BusinessProfile;
  /** The customer's own words. The only place a specific claim may come from. */
  knowledge: Array<{ title: string; content: string }>;
  /** Who is sending it, so the voice is a person's rather than a brand's. */
  repName?: string;
  /** What the person editing the last draft asked for. */
  instruction?: string;
  /** The pitch being rewritten, when there is one. */
  current?: string;
}

/**
 * Writes the pitch: the offer this business makes once, to everybody.
 *
 * It is deliberately not per campaign. A campaign varies the angle it opens
 * with (rule 28) and the person the note is addressed to; what is being sold is
 * the same thing in all of them. A business making two different offers to two
 * halves of one market cannot read its own reply rate afterwards, because the
 * two halves were never answering the same question.
 *
 * The agent writes it. It does not approve it — `approved_at` is set on
 * `/app/pitch` and nowhere else, exactly as rule 9 holds for customer profiles.
 * This is the one piece of copy in the product that argues for the thing being
 * sold, and it goes to every prospect who ever replies.
 */
export async function writePitch(ctx: AgentContext, input: PitchInput): Promise<Pitch> {
  return callStructured(ctx, {
    agent: "pitch",
    model: ctx.client.models.writer,
    promptVersion: PITCH_PROMPT_VERSION,
    schema: PitchSchema,
    // Identical for every workspace, so it caches across all pitch runs rather
    // than only within one.
    system: [{ text: PITCH_SYSTEM, cached: true }],
    userContent: [
      `Business profile:\n${JSON.stringify(input.business, null, 2)}`,
      input.repName ? `\nThe pitch is sent by ${input.repName}, in the first person.` : "",
      `\nKnowledge base (the only product facts you may state):\n${renderKnowledge(input.knowledge)}`,
      // A rewrite is given what it is rewriting. Without it the instruction
      // "shorter" produces a different pitch that happens to be short, and the
      // sentence the person actually liked is gone.
      input.current ? `\nThe current pitch, which you are rewriting:\n"""\n${input.current}\n"""` : "",
      input.instruction
        ? `\nWhat they asked you to change:\n"""\n${input.instruction}\n"""`
        : "",
      "\nWrite the pitch.",
    ]
      .filter(Boolean)
      .join("\n"),
    effort: "medium",
    maxTokens: 4000,
  });
}
