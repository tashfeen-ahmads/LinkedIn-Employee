import { z } from "zod";
import {
  VOICE_RULES,
  extractLinks,
  rewriteInstruction,
  tidyVoice,
  voiceProblems,
  type MessageKind,
} from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";

export const REVISE_PROMPT_VERSION = "revise/2026-10-27-deliverable";

const REVISE_SYSTEM = `You rewrite one LinkedIn message that a salesperson already wrote, so that it reads like a busy person typed it to one other person.

Keep what it is for: the same reason for writing and the same ask. Make it shorter and plainer. Write in the same language as the original.

- Keep {{first_name}}, {{cta_link}} and {{pitch}} exactly as written wherever the original has them. Never add any other placeholder, and replace any other placeholder ({{company}}, [Name] and the like) with plain words.
- Never add a fact, a number, a claim or a link that is not in the original.
- A first message after somebody accepts a connection does not pitch and does not name the product. It says why you wrote and asks one easy question.
- Never offer an example, a checklist, a guide, a template, an audit, a case study or a sample unless it is listed as something that exists. Where the original offers one that does not, ask a plain question instead.
- Write a call to action in plain lowercase words ("happy to grab 20 minutes?"), never as a Title Case label like "Book a Free Consultation".

${VOICE_RULES}`;

const ReviseSchema = z.object({ message: z.string().max(600) });

/** What a revision must keep from the original, or it has changed what the message is. */
function keeps(original: string, revised: string): boolean {
  for (const placeholder of ["{{cta_link}}", "{{pitch}}"]) {
    if (original.includes(placeholder) && !revised.includes(placeholder)) return false;
  }
  const allowed = new Set(extractLinks(original));
  return extractLinks(revised).every((link) => allowed.has(link));
}

/**
 * Rewrites a stored message that fails the voice check (rule 66), for copy
 * written before the check existed. Returns null when it cannot produce a
 * version that passes and keeps the original's placeholders and links — the
 * caller then leaves the original alone rather than storing something worse.
 */
export async function reviseForVoice(
  ctx: AgentContext,
  input: {
    text: string;
    kind: MessageKind;
    template: boolean;
    /** What exists to offer, and the CTA's label: the same checks the writers ran. */
    assets?: string[];
    ctaLabel?: string | null;
  },
): Promise<string | null> {
  const options = { template: input.template, assets: input.assets, ctaLabel: input.ctaLabel };
  let last = input.text;
  let problems = voiceProblems(tidyVoice(input.text), input.kind, options);
  if (!problems.length) return tidyVoice(input.text);

  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callStructured(ctx, {
      agent: "revise",
      model: ctx.client.models.writer,
      promptVersion: REVISE_PROMPT_VERSION,
      schema: ReviseSchema,
      system: [{ text: REVISE_SYSTEM, cached: true }],
      userContent: [
        `Kind of message: ${input.kind.replace("_", " ")}.`,
        input.assets?.length
          ? `What exists to send: ${input.assets.join("; ")}.`
          : "Nothing exists to send: offer no example, checklist, guide, template, audit or sample.",
        rewriteInstruction(problems),
        `\nThe message:\n"""\n${last}\n"""`,
      ].join("\n"),
      effort: "low",
      maxTokens: 2000,
    });
    const revised = tidyVoice(out.message ?? "");
    if (!revised) return null;
    problems = voiceProblems(revised, input.kind, options);
    if (!problems.length && keeps(input.text, revised)) return revised;
    last = revised;
  }
  return null;
}
