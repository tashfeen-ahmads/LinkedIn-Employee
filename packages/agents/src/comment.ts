import { z } from "zod";
import { VOICE_RULES, commentProblems, rewriteInstruction, tidyVoice } from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";

export const COMMENT_PROMPT_VERSION = "comment/2026-10-26";

const COMMENT_SYSTEM = `You write one short comment that a salesperson posts under somebody's LinkedIn post, in their own name.

It is a person reacting to what this person wrote. It is not outreach, not a pitch and not a compliment.

- Pick one specific thing they actually wrote and respond to it: agree and add one concrete thought, share a short related experience, or ask one light question about it.
- Return that phrase, copied exactly from the post, as "grounding". Three to ten words.
- One or two sentences, under 200 characters. Plain and warm, like a peer in their industry.
- Never praise the post in general ("great post", "thanks for sharing", "love this", "so true", "well said"). Never congratulate.
- Never mention your company, your product, a call, a meeting or a link. Never ask them to message you.
- Never invent a fact, a number or an experience you were not given. If you have nothing specific to add, ask one short question about what they wrote.
- Write in the language of the post.
- If the post is about something personal or painful, or you cannot say anything specific, set "skip" to true.

${VOICE_RULES}`;

const CommentSchema = z.object({
  comment: z.string().max(400),
  grounding: z.string().max(200),
  skip: z.boolean(),
});

export interface CommentInput {
  postText: string;
  authorFirstName: string | null;
  repName: string;
  /** What the rep does, so the comment can sound like a peer, never to be named. */
  repContext: string;
  companyName: string | null;
  productNames?: string[];
  /** How the campaign's agent has been told to write. */
  voice?: string;
  model?: string;
}

export interface WrittenComment {
  comment: string;
  grounding: string;
}

/**
 * A comment on one post, or null when there is nothing honest to say.
 *
 * Checked in code like every other message (rule 66) plus the comment's own
 * checks: it names a phrase the post really contains, praises nothing in
 * general, carries no link and never names the company. Rewritten once with
 * the exact list; null when it still fails, and the caller likes the post and
 * leaves it at that.
 */
export async function writeComment(ctx: AgentContext, input: CommentInput): Promise<WrittenComment | null> {
  let extra = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callStructured(ctx, {
      agent: "comment",
      model: input.model ?? ctx.client.models.writer,
      promptVersion: COMMENT_PROMPT_VERSION,
      schema: CommentSchema,
      system: [
        { text: COMMENT_SYSTEM, cached: true },
        ...(input.voice ? [{ text: input.voice, cached: true }] : []),
        { text: `You are ${input.repName}. What you do, for context only: ${input.repContext}`, cached: true },
      ],
      userContent: [
        input.authorFirstName ? `Posted by ${input.authorFirstName}.` : "",
        `The post:\n"""\n${input.postText.slice(0, 3000)}\n"""`,
        extra,
        "\nWrite the comment.",
      ].join("\n"),
      effort: "low",
      maxTokens: 1500,
    });
    if (out.skip) return null;
    const comment = tidyVoice(out.comment ?? "");
    if (!comment) return null;
    const grounding = (out.grounding ?? "").trim();
    const problems = commentProblems(comment, {
      postText: input.postText,
      grounding,
      companyName: input.companyName,
      productNames: input.productNames,
    });
    if (!problems.length) return { comment, grounding };
    extra = `\n${rewriteInstruction(problems)}\n\nYour last version was:\n"""\n${comment}\n"""\nGrounding you gave: "${grounding}"`;
  }
  return null;
}
