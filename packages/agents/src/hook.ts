import { HOOK_MAX_CHARS, HookSetSchema, type BusinessProfile, type CustomerProfile, type HookSet } from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import { HOOK_PROMPT_VERSION, HOOK_SYSTEM } from "./prompts/hook.js";

export interface HookInput {
  business: BusinessProfile;
  /** Who is being written to. An opener is about them or it is about nobody. */
  profiles: Array<Pick<CustomerProfile, "name" | "summary" | "pains">>;
  repName?: string;
  /** What the person editing the last set asked for. */
  instruction?: string;
  /** The lines being rewritten, when there are any. */
  current?: string[];
}

/**
 * Writes this workspace's openers: several short lines, not one.
 *
 * The same shape as `writePitch`, and for the same reasons. One opener is an
 * opinion nobody can check; several are a test. An angle owns its prospect end
 * to end (rule 28), so the line that opens a conversation and the line that
 * makes the offer belong to the same bet — otherwise somebody accepts because
 * one pain was named and then hears about another.
 *
 * The agent writes them. It approves none: `approved_at` is set on the screen
 * and nowhere else, exactly as rule 9 holds for customer profiles.
 */
export async function writeHooks(ctx: AgentContext, input: HookInput): Promise<HookSet> {
  const set = await callStructured(ctx, {
    agent: "hook",
    model: ctx.client.models.writer,
    promptVersion: HOOK_PROMPT_VERSION,
    schema: HookSetSchema,
    system: [{ text: HOOK_SYSTEM, cached: true }],
    userContent: [
      `Business profile:\n${JSON.stringify(input.business, null, 2)}`,
      input.repName ? `\nSent by ${input.repName}, in the first person.` : "",
      `\nWho these open a conversation with:\n${JSON.stringify(input.profiles, null, 2)}`,
      input.current?.length
        ? `\nThe current openers, which you are rewriting:\n${input.current.map((line) => `- ${line}`).join("\n")}`
        : "",
      input.instruction ? `\nWhat they asked you to change:\n"""\n${input.instruction}\n"""` : "",
      "\nWrite the openers.",
    ]
      .filter(Boolean)
      .join("\n"),
    effort: "medium",
    maxTokens: 4000,
  });

  /*
   * The length is checked here, not left to the schema.
   *
   * `callStructured` casts its result; it does not parse it. The schema shapes
   * the JSON at the provider and a structured-output subset does not enforce
   * `maxLength` on a string, so `.max()` above is documentation for the model
   * and nothing more. This is the hole that sent LinkedIn a 222-character note
   * and had the whole invitation refused.
   *
   * Dropped rather than truncated: an opener cut mid-clause is a question with
   * no question mark, arriving from a stranger.
   */
  const variants = set.variants.filter((hook) => hook.body.trim().length <= HOOK_MAX_CHARS);
  if (variants.length === 0) {
    throw new Error(
      `hook: every opener came back over ${HOOK_MAX_CHARS} characters, so there is nothing safe to send`,
    );
  }
  return { variants };
}
