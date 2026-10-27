import { z } from "zod";
import { VOICE_RULES, commentProblems, rewriteInstruction, tidyVoice } from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";

export const COMMENT_PROMPT_VERSION = "comment/2026-10-27-no-pitch";

/*
 * A comment is a person being friendly under somebody's post, and nothing
 * else. The first version was told what the rep sells "for context" and asked
 * to sound "like a peer in their industry", and it wrote shop talk: probing
 * questions about the poster's tools, metrics and process, which is a
 * discovery call held in public. So the writer is no longer told what the rep
 * does at all, asks nothing, and talks only about what the post says.
 */
const COMMENT_SYSTEM = `You write one short, friendly comment that somebody posts under a LinkedIn post, in their own name.

It is a warm, human reaction to what this person shared. It is never sales, never about your own work, and never a question.

- Pick one specific thing they wrote and react to it in your own words: say what you liked about it, agree with it, or wish them well on news they shared (a launch, a book, a milestone, a new role).
- Return that phrase, copied exactly from the post, as "grounding". Three to ten words.
- One or two sentences, under 160 characters. Plain and kind, like a friendly acquaintance.
- Never ask a question. Never give advice about how they run their work.
- Never talk about tools, methods, metrics, numbers, hiring or anything you or a company do. Never say "we", "our team", "our clients" or "I help".
- Never mention a company, a product, a call, a meeting or a link. Never ask them to message you.
- Never use stock lines like "great post", "thanks for sharing", "love this", "well said" or "so true".
- Never invent a fact, a number or an experience.
- Write in the language of the post.
- Set "skip" to true when the post is a job opening, an advert or promotion, something personal or painful, or says nothing you can react to warmly.

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
        { text: `You are ${input.repName}.`, cached: true },
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
