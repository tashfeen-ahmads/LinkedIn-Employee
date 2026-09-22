import {
  PITCH_MAX_CHARS,
  PitchSetSchema,
  type BusinessProfile,
  type PitchSet,
} from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import { renderKnowledge } from "./knowledge.js";
import { PITCH_PROMPT_VERSION, PITCH_SYSTEM } from "./prompts/pitch.js";

export interface PitchInput {
  business: BusinessProfile;
  /** The customer's own words. The only place a specific claim may come from. */
  knowledge: Array<{ title: string; content: string }>;
  /** Who is sending it, so the voice is a person's rather than a brand's. */
  repName?: string;
  /**
   * The opening angles a human already approved on /app/strategy.
   *
   * A pitch has to sound like the same person who sent the invitation. Written
   * without them, the four pitches are four bets nobody placed, and a prospect
   * who accepted because of one pain hears an offer arguing a different one.
   */
  hooks?: string[];
  /** What the person editing the last set asked for. */
  instruction?: string;
  /** The lines being rewritten, when there are any. */
  current?: string[];
}

/**
 * Writes this workspace's pitches: several short lines, not one paragraph.
 *
 * One pitch is an opinion nobody can check. Several are a test — and because an
 * angle owns its prospect end to end (rule 28), the line a person hears is the
 * one belonging to the angle their invitation was written for, so the
 * acceptance and the reply are at last measuring the same thing.
 *
 * The agent writes them. It approves none — `approved_at` is set on
 * `/app/pitch` and nowhere else, exactly as rule 9 holds for customer profiles.
 */
export async function writePitch(ctx: AgentContext, input: PitchInput): Promise<PitchSet> {
  const set = await callStructured(ctx, {
    agent: "pitch",
    model: ctx.client.models.writer,
    promptVersion: PITCH_PROMPT_VERSION,
    schema: PitchSetSchema,
    // Identical for every workspace, so it caches across all pitch runs rather
    // than only within one.
    system: [{ text: PITCH_SYSTEM, cached: true }],
    userContent: [
      `Business profile:\n${JSON.stringify(input.business, null, 2)}`,
      input.repName ? `\nThe pitch is sent by ${input.repName}, in the first person.` : "",
      `\nKnowledge base (the only product facts you may state):\n${renderKnowledge(input.knowledge)}`,
      input.hooks?.length
        ? `\nThe opening angles this workspace already approved. Each pitch should be the natural second line to one of these, so the offer sounds like the person who sent the invitation:\n${input.hooks
            .map((hook) => `- ${hook}`)
            .join("\n")}`
        : "",
      // A rewrite is shown what it is rewriting. Without it, "shorter" produces
      // a different set that happens to be short, and the line the person
      // actually liked is gone.
      input.current?.length
        ? `\nThe current pitches, which you are rewriting:\n${input.current.map((line) => `- ${line}`).join("\n")}`
        : "",
      input.instruction ? `\nWhat they asked you to change:\n"""\n${input.instruction}\n"""` : "",
      "\nWrite the pitches.",
    ]
      .filter(Boolean)
      .join("\n"),
    effort: "medium",
    maxTokens: 4000,
  });

  /*
   * The length is checked here, not left to the schema.
   *
   * `callStructured` casts its result; it does not parse it. The schema goes to
   * the provider to shape the JSON, and a provider's structured-output subset
   * enforces the *shape* — it does not enforce `maxLength` on a string. So
   * `.max()` above is documentation for the model and nothing more.
   *
   * This is the same hole that sent a 222-character connection note to LinkedIn
   * and had the whole invitation refused, which is why `personalizeInvites`
   * carries the identical second check. A long pitch is worse in one way: it is
   * not refused, it is delivered, and then skimmed and ignored — which looks
   * exactly like a pitch that was never sent.
   *
   * Dropped rather than truncated, for rule 11's reason: half a sentence is
   * answered from confidently, and cutting one mid-clause reaches a prospect as
   * a broken message under a real rep's name.
   */
  const variants = set.variants.filter((pitch) => pitch.body.trim().length <= PITCH_MAX_CHARS);
  if (variants.length === 0) {
    throw new Error(
      `pitch: every line came back over ${PITCH_MAX_CHARS} characters, so there is nothing safe to offer`,
    );
  }
  return { variants };
}
