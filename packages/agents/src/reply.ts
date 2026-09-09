import {
  MODELS,
  OPT_OUT_PHRASES,
  ReplyClassificationSchema,
  ReplyDraftSchema,
  type BusinessProfile,
  type CustomerProfile,
  type ReplyClassification,
  type ReplyDraft,
  type RulesOfEngagement,
} from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import { renderKnowledge } from "./knowledge.js";
import {
  CLASSIFY_PROMPT_VERSION,
  CLASSIFY_SYSTEM,
  DRAFT_PROMPT_VERSION,
  DRAFT_SYSTEM_HEADER,
} from "./prompts/reply.js";

export interface ConversationTurn {
  role: "rep" | "prospect";
  text: string;
  at: string;
}

/** Agent 3, step one: what did the prospect just say, and may a machine answer? */
export async function classifyReply(
  ctx: AgentContext,
  input: { message: string; history: ConversationTurn[]; knowledgeTitles: string[] },
): Promise<ReplyClassification> {
  const classification = await callStructured(ctx, {
    agent: "reply.classify",
    model: MODELS.classifier,
    promptVersion: CLASSIFY_PROMPT_VERSION,
    schema: ReplyClassificationSchema,
    system: [{ type: "text", text: CLASSIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
    userContent: [
      `Knowledge base topics available to the agent: ${input.knowledgeTitles.join(", ") || "none"}`,
      `\nConversation so far:\n${renderHistory(input.history)}`,
      `\nClassify this new message from the prospect:\n"""\n${input.message}\n"""`,
    ].join("\n"),
    maxTokens: 2000,
  });

  // A literal opt-out phrase is not a judgement call. If the model missed one,
  // override it: sending another message after "remove me" is the one mistake
  // this product must never make.
  if (containsOptOut(input.message) && !classification.optOut) {
    return {
      ...classification,
      optOut: true,
      intent: "not_interested",
      needsHuman: true,
      needsHumanReason: "opt-out phrase detected",
    };
  }
  return classification;
}

export function containsOptOut(message: string): boolean {
  const normalized = message.toLowerCase();
  return OPT_OUT_PHRASES.some((phrase) => normalized.includes(phrase));
}

export interface GateDecision {
  action: "send" | "hold_for_human" | "stop_sequence";
  reason?: string;
}

/**
 * The gate between classification and sending. Pure function, no I/O: every
 * rule that can hold a message back from a real prospect lives here and is
 * unit-tested. Autopilot changes what happens to a clean message, never what
 * counts as clean.
 */
export function applyRules(classification: ReplyClassification, rules: RulesOfEngagement): GateDecision {
  if (classification.optOut) {
    return { action: "stop_sequence", reason: "prospect opted out" };
  }
  if (classification.needsHuman) {
    return { action: "hold_for_human", reason: classification.needsHumanReason ?? "model flagged for review" };
  }
  if (rules.handOffOnPricing && classification.mentionsPricing) {
    return { action: "hold_for_human", reason: "pricing question" };
  }
  if (rules.handOffOnLegal && classification.mentionsLegalOrCompliance) {
    return { action: "hold_for_human", reason: "legal or compliance question" };
  }
  if (rules.handOffOnHumanRequest && classification.asksForHuman) {
    return { action: "hold_for_human", reason: "prospect asked for a person" };
  }
  if (rules.handOffOnNegative && classification.sentiment === "negative") {
    return { action: "hold_for_human", reason: "negative sentiment" };
  }
  if (classification.confidence < rules.minConfidence) {
    return { action: "hold_for_human", reason: `confidence ${classification.confidence.toFixed(2)} below threshold` };
  }
  if (classification.intent === "not_interested") {
    return { action: "stop_sequence", reason: "prospect is not interested" };
  }
  if (rules.mode === "approval") {
    return { action: "hold_for_human", reason: "campaign is in approval mode" };
  }
  return { action: "send" };
}

export interface DraftInput {
  business: BusinessProfile;
  profile?: CustomerProfile;
  repName: string;
  repTitle?: string;
  repBio?: string;
  knowledge: Array<{ title: string; content: string }>;
  history: ConversationTurn[];
  message: string;
  classification: ReplyClassification;
  rules: RulesOfEngagement;
  /** Human-readable slots genuinely free on the rep's calendar. */
  availableSlots: string[];
  /** True when this reply confirms a meeting we have already put in the diary. */
  bookedMeeting?: boolean;
}

/** Agent 3, step two: write the reply. */
export async function draftReply(ctx: AgentContext, input: DraftInput): Promise<ReplyDraft> {
  const stableContext = [
    DRAFT_SYSTEM_HEADER,
    `\nSalesperson: ${input.repName}${input.repTitle ? `, ${input.repTitle}` : ""}`,
    input.repBio ? `Their bio: ${input.repBio}` : "",
    `\nBusiness profile:\n${JSON.stringify(input.business, null, 2)}`,
    input.profile ? `\nSegment being targeted:\n${JSON.stringify(input.profile, null, 2)}` : "",
    `\nKnowledge base (the only product facts you may state):\n${renderKnowledge(input.knowledge)}`,
    `\nGoal for this conversation: ${input.rules.goal}`,
  ].join("\n");

  return callStructured(ctx, {
    agent: "reply.draft",
    model: MODELS.writer,
    promptVersion: DRAFT_PROMPT_VERSION,
    schema: ReplyDraftSchema,
    // Everything above is identical for every message in a campaign; caching it
    // means each reply mostly pays for the new conversation only.
    system: [{ type: "text", text: stableContext, cache_control: { type: "ephemeral" } }],
    userContent: [
      `Conversation so far:\n${renderHistory(input.history)}`,
      `\nThe prospect just wrote:\n"""\n${input.message}\n"""`,
      `\nClassification: ${JSON.stringify(input.classification)}`,
      input.bookedMeeting
        ? "\nThe meeting they accepted is already in the calendar and an invitation has been sent. Confirm it briefly and warmly. Do not offer any further times."
        : input.availableSlots.length
          ? `\nFree slots on the calendar (offer at most three, exactly as written here):\n${input.availableSlots.join("\n")}`
          : `\nNo calendar availability was retrieved. Do not invent times.${
              input.rules.bookingLink ? ` You may share this booking link: ${input.rules.bookingLink}` : ""
            }`,
      "\nWrite the reply.",
    ].join("\n"),
    effort: "medium",
    maxTokens: 4000,
  });
}

function renderHistory(history: ConversationTurn[]): string {
  if (history.length === 0) return "(no previous messages)";
  return history
    .map((turn) => `[${turn.at}] ${turn.role === "rep" ? "Us" : "Prospect"}: ${turn.text}`)
    .join("\n");
}
