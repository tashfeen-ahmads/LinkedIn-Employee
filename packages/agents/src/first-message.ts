import { z } from "zod";
import {
  VOICE_RULES,
  containsLink,
  rewriteInstruction,
  tidyVoice,
  voiceProblems,
  type BusinessProfile,
} from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";

export const FIRST_MESSAGE_PROMPT_VERSION = "first-message/2026-10-20";

const FIRST_MESSAGE_SYSTEM = `You write the first LinkedIn message a salesperson sends to one person who has just accepted their connection request.

This is the message that decides whether a conversation starts. It is not a pitch. The goal is one reply.

- Write to this one person. Use something real from their details: what their company does, their role, where they are, what they posted about in their headline. Say it in your own words, never by pasting their title or headline.
- Thank them for connecting in a few words or not at all, then say the one reason you wrote, then ask one easy question they can answer in a breath.
- Never name the product, never describe what the company sells, never offer a call or a link. That comes after they reply.
- Use only details you were given. Never invent a shared connection, a post, a mutual interest or a fact about their business.
- One or two short sentences, under 200 characters. Use their first name once at the start.
- Write in the language of the note they accepted.

${VOICE_RULES}`;

const FirstMessageSchema = z.object({ message: z.string().max(400) });

export interface FirstMessageInput {
  business: Pick<BusinessProfile, "companyName" | "toneOfVoice">;
  repName: string;
  /** What this campaign or angle leans on: the reason for writing. */
  angle: string;
  /** The note they accepted, so the message sounds like the same person. */
  inviteNote?: string | null;
  /** How the campaign's agent has been told to write. */
  voice?: string;
  model?: string;
  prospect: {
    firstName: string;
    headline?: string | null;
    title?: string | null;
    company?: string | null;
    location?: string | null;
  };
}

/**
 * The first message after an acceptance, written for the person who accepted.
 *
 * Step 1 was one template for everyone ("Thanks for connecting, Keon. How are
 * inquiries passed from your marketing channels…"), so every acceptance got the
 * same sentence and the replies did not come. Checked in code like every other
 * message (rule 66) and rewritten once; null when it still fails, and the
 * caller sends the campaign's own step 1 instead.
 */
export async function writeFirstMessage(ctx: AgentContext, input: FirstMessageInput): Promise<string | null> {
  const details = JSON.stringify(
    {
      firstName: input.prospect.firstName,
      headline: input.prospect.headline ?? undefined,
      title: input.prospect.title ?? undefined,
      company: input.prospect.company ?? undefined,
      location: input.prospect.location ?? undefined,
    },
    null,
    2,
  );
  let extra = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await callStructured(ctx, {
      agent: "first-message",
      model: input.model ?? ctx.client.models.writer,
      promptVersion: FIRST_MESSAGE_PROMPT_VERSION,
      schema: FirstMessageSchema,
      system: [
        { text: FIRST_MESSAGE_SYSTEM, cached: true },
        ...(input.voice ? [{ text: input.voice, cached: true }] : []),
        {
          text: `Sent by ${input.repName} at ${input.business.companyName}. Tone: ${input.business.toneOfVoice || "plain and warm"}.\nWhy they are writing to people like this: ${input.angle}`,
          cached: true,
        },
      ],
      userContent: [
        input.inviteNote ? `The note they accepted:\n"""\n${input.inviteNote}\n"""` : "They accepted a request with no note.",
        `\nWho they are:\n${details}`,
        extra,
        "\nWrite the message.",
      ].join("\n"),
      effort: "low",
      maxTokens: 2000,
    });
    const message = tidyVoice(out.message ?? "");
    if (!message) return null;
    const problems = voiceProblems(message, "first_message");
    if (containsLink(message)) problems.push("It has a link. The first message never carries one.");
    if (input.business.companyName && message.toLowerCase().includes(input.business.companyName.toLowerCase())) {
      problems.push("It names the company. The first message does not name the product or the company.");
    }
    if (!problems.length) return message;
    extra = `\n${rewriteInstruction(problems)}\n\nYour last version was:\n"""\n${message}\n"""`;
  }
  return null;
}
