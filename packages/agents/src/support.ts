import { SupportDraftSchema, type SupportDraft } from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import { SUPPORT_PROMPT_VERSION, SUPPORT_SYSTEM } from "./prompts/support.js";

export interface SupportTicketInput {
  subject: string;
  body: string;
  /** What they added when they pressed "Still stuck". */
  followup?: string | null;
  /** The earlier answer they said did not help. */
  previousAnswer?: string | null;
  /** What the product believed when they raised it, as sentences. */
  thenFacts: string[];
  /** What the product believes about their workspace now, as sentences. */
  nowFacts: string[];
}

/**
 * Drafts an answer to one support ticket.
 *
 * It decides nothing about sending. `supportGate` does, from this draft and the
 * platform's settings — the model's confidence is an input to that, never the
 * verdict, for the reason the reply gate is pure (rule 5).
 */
export async function draftSupportAnswer(ctx: AgentContext, input: SupportTicketInput): Promise<SupportDraft> {
  return callStructured(ctx, {
    agent: "support",
    model: ctx.client.models.writer,
    promptVersion: SUPPORT_PROMPT_VERSION,
    schema: SupportDraftSchema,
    // The guide is identical for every ticket on the platform.
    system: [{ text: SUPPORT_SYSTEM, cached: true }],
    userContent: [
      `Ticket subject: ${input.subject}`,
      `Ticket:\n"""\n${input.body}\n"""`,
      input.previousAnswer ? `\nWe answered earlier:\n"""\n${input.previousAnswer}\n"""` : "",
      input.followup ? `\nThey said that did not help, and added:\n"""\n${input.followup}\n"""` : "",
      `\nWhat the product believed when they raised it:\n${input.thenFacts.map((f) => `- ${f}`).join("\n")}`,
      `\nWhat the product believes about their workspace now:\n${input.nowFacts.map((f) => `- ${f}`).join("\n")}`,
      "\nWrite the answer.",
    ]
      .filter(Boolean)
      .join("\n"),
    effort: "low",
    maxTokens: 6000,
  });
}
