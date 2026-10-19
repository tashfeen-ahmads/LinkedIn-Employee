import {
  type ReplyIntent,
  OPT_OUT_PHRASES,
  normalizeForOptOut,
  ReplyClassificationSchema,
  ReplyDraftSchema,
  type BusinessProfile,
  type CustomerProfile,
  type ReplyClassification,
  type ReplyDraft,
  type RulesOfEngagement,
  type ReplyMove,
  replyMove,
  rewriteInstruction,
  tidyVoice,
  voiceProblems,
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
    model: ctx.client.models.classifier,
    promptVersion: CLASSIFY_PROMPT_VERSION,
    schema: ReplyClassificationSchema,
    system: [{ text: CLASSIFY_SYSTEM, cached: true }],
    userContent: [
      `Knowledge base topics available to the agent: ${input.knowledgeTitles.join(", ") || "none"}`,
      `\nConversation so far:\n${renderHistory(input.history)}`,
      `\nClassify this new message from the prospect:\n"""\n${input.message}\n"""`,
    ].join("\n"),
    /*
     * Classifying a reply is reading it, not reasoning about it.
     *
     * It set no effort and took the provider's default — and this runs on
     * every inbound message, so it is the call whose volume grows fastest as
     * the product works. The judgement it makes is which of a fixed set of
     * conditions a message meets, and `applyRules` decides what happens next
     * (rule 5). Deeper thinking here does not change what the gate does with
     * the answer.
     */
    effort: "minimal",
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

/**
 * Normalised first: "don’t contact me" typed on a phone carries a curly
 * apostrophe, and a byte comparison against "don't contact" left the one
 * check meant to work without a model to the model alone.
 */
export function containsOptOut(message: string): boolean {
  const normalized = normalizeForOptOut(message);
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
  const autonomous = rules.autonomy === "autonomous";

  /*
   * A prospect who asks to speak to a person is honoured in both modes.
   *
   * This is the one hold that is not about our confidence but about theirs.
   * Answering "can I talk to a human?" with another machine-written message is
   * the single fastest way to lose somebody, and it is a promise broken under a
   * real rep's name — so autonomy does not override it. Everything else on this
   * list is the product being cautious on the customer's behalf; this one is
   * the customer telling us what they want.
   *
   * Unconditional on purpose. `handOffOnHumanRequest` is still accepted by the
   * schema so stored rules keep parsing, and it is read by nothing: a setting
   * that could switch this off would be a way to break that promise by
   * configuration, which is no better than breaking it by accident.
   */
  if (classification.asksForHuman) {
    return { action: "hold_for_human", reason: "prospect asked for a person" };
  }

  /*
   * Below the confidence floor the agent does not know what was said, and that
   * is true in both modes. Autonomy means finishing the work, not guessing at
   * it: a reply written from a misread message reaches a real person just as
   * fast as a good one.
   */
  if (classification.confidence < rules.minConfidence) {
    return { action: "hold_for_human", reason: `confidence ${classification.confidence.toFixed(2)} below threshold` };
  }

  /*
   * Everything from here is a category a workspace can choose to automate.
   *
   * `needsHuman` is the model's summary of exactly these same structured
   * fields, so under autonomy it is read as advice rather than as a veto —
   * otherwise turning the categories off changes nothing, which is how a
   * setting comes to exist and do nothing.
   */
  if (!autonomous && classification.needsHuman) {
    return { action: "hold_for_human", reason: classification.needsHumanReason ?? "model flagged for review" };
  }
  if (!autonomous && rules.handOffOnPricing && classification.mentionsPricing) {
    return { action: "hold_for_human", reason: "pricing question" };
  }
  if (!autonomous && rules.handOffOnLegal && classification.mentionsLegalOrCompliance) {
    return { action: "hold_for_human", reason: "legal or compliance question" };
  }
  if (!autonomous && rules.handOffOnNegative && classification.sentiment === "negative") {
    return { action: "hold_for_human", reason: "negative sentiment" };
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
  /**
   * What this campaign is asking for.
   *
   * The agent used to pursue a meeting whatever the campaign wanted, which for
   * a sign-up campaign meant proposing times to somebody who was asked to look
   * at a page — the agent chasing a goal nobody set.
   */
  goal?: "meeting" | "link" | "reply";
  /**
   * What the classifier made of the message this is answering.
   *
   * Only `interested` changes anything: it is the one moment where the right
   * reply is the pitch itself rather than another step towards it. Optional,
   * and it defaults to the classification's own intent — the classification is
   * already here, so a second field holding the same fact is a field a caller
   * can forget, and forgetting it turns the rule off with nothing to show for
   * it.
   */
  intent?: ReplyIntent;
  /**
   * The offer this business makes, written once and approved by a person.
   *
   * Absent means there is none approved, and the agent then argues for the
   * product from the business profile — which is what it did for every
   * conversation before this existed, and why no two prospects were ever made
   * the same offer.
   */
  pitch?: string;
  /**
   * What this reply may do, decided from what they said (`replyMove`). The
   * worker passes the same one it used to decide the link and the times, so
   * the prompt and the checks cannot disagree; absent, it is derived here.
   */
  move?: ReplyMove;
  /** Human-readable slots genuinely free on the rep's calendar. */
  availableSlots: string[];
  /** True when this reply confirms a meeting we have already put in the diary. */
  bookedMeeting?: boolean;
  /**
   * How the campaign's agent has been told to write, and what it is for.
   *
   * Appended to the shipped prompt, never instead of it. That prompt carries
   * the rules that keep the agent from stating a product fact nobody gave it,
   * from inventing a datetime and from sending a link it was not handed — a
   * rep's opinion about voice is worth a great deal and is not worth any of
   * those. Absent is the behaviour every conversation had before agents.
   */
  voice?: string;
  /**
   * What this agent needs to learn before a conversation is worth a person's
   * time.
   *
   * Guidance, not a gate. A prospect who asks a simple question and is
   * interrogated instead has been answered by a form, and the reply gate's own
   * holds are what actually stop a conversation (rule 41) — a required
   * question here never overrides a prospect asking for a human.
   */
  qualification?: Array<{ ask: string; required: boolean }>;
}

/** Agent 3, step two: write the reply. */
/** A draft, and anything about how it reads that is still wrong after its one rewrite. */
export type CheckedReplyDraft = ReplyDraft & { voiceProblems: string[] };

export async function draftReply(ctx: AgentContext, input: DraftInput): Promise<CheckedReplyDraft> {
  const intent = input.intent ?? input.classification.intent;
  const stableContext = [
    DRAFT_SYSTEM_HEADER,
    `\nSalesperson: ${input.repName}${input.repTitle ? `, ${input.repTitle}` : ""}`,
    input.repBio ? `Their bio: ${input.repBio}` : "",
    `\nBusiness profile:\n${JSON.stringify(input.business, null, 2)}`,
    input.profile ? `\nSegment being targeted:\n${JSON.stringify(input.profile, null, 2)}` : "",
    `\nKnowledge base (the only product facts you may state):\n${renderKnowledge(input.knowledge)}`,
    /*
     * The offer, and the instruction that it is the offer.
     *
     * Handed to the agent as text it adapts rather than text it recites: the
     * prospect asked a specific question, and a pitch pasted verbatim under it
     * answers a different one. But the *substance* is fixed. Before this, the
     * agent improvised the offer from the business profile every time, so
     * every prospect who asked "what is this?" received a differently-worded
     * proposition, none of which anybody had read — the one piece of copy that
     * actually argues for the product was the only piece nobody approved.
     *
     * In the cached half of the prompt: it is identical for every conversation
     * in the workspace, so it is paid for once rather than per reply.
     */
    input.pitch
      ? `\nTHE OFFER, approved by the salesperson:\n"""\n${input.pitch}\n"""\n\nOnly when the move for this message allows a pitch, make THIS offer, in your own words and in one sentence. Never invent a different offer, a different problem, or a benefit that is not in it.`
      : "",
    // The rep's own words about voice, after the shipped rules and inside the
    // cached half: identical for every conversation in this workspace.
    input.voice ? `\n${input.voice}` : "",
    input.qualification?.length
      ? `\nWhat this agent is trying to find out, when the conversation gives you a natural opening for it. Never interrogate; one question at a time, and never at the cost of answering what they actually asked:\n${input.qualification
          .map((q) => `- ${q.ask}${q.required ? " (needed before handing over)" : ""}`)
          .join("\n")}`
      : "",
    // What the campaign is asking for, which is not always a meeting. Without
    // it the agent pursues a call in a conversation whose whole point was to
    // get somebody to look at a page.
    input.goal === "link"
      ? "\nThis campaign is NOT asking for a meeting. Do not propose a call or offer times. When a link is allowed, the ask is that they take a look at it."
      : input.goal === "reply"
        ? "\nThis campaign is NOT asking for a meeting and has no link. The ask is a genuine reply: a conversation, an opinion, an introduction."
        : "",
  ].join("\n");

  const move = input.move ?? replyMove(intent, input.message);
  const nextStep = input.bookedMeeting
    ? "The meeting they accepted is already in the calendar and an invitation has been sent. Confirm it in one short line. Do not offer any further times."
    : [
        move.slots && input.availableSlots.length
          ? `Times you may offer (at most two, exactly as written):\n${input.availableSlots.join("\n")}`
          : "Do not mention any times or dates.",
        move.link && input.rules.bookingLink
          ? `The ONLY link you may send is ${input.rules.bookingLink}. Copy it exactly, and only if the move calls for it.`
          : "Do not write a link or web address of any kind.",
      ].join("\n");

  const ask = (extra?: string) =>
    callStructured(ctx, {
      agent: "reply.draft",
      model: ctx.client.models.writer,
      promptVersion: DRAFT_PROMPT_VERSION,
      schema: ReplyDraftSchema,
      // Everything above is identical for every message in a campaign; caching it
      // means each reply mostly pays for the new conversation only.
      system: [{ text: stableContext, cached: true }],
      userContent: [
        `Conversation so far:\n${renderHistory(input.history)}`,
        `\nThe prospect just wrote:\n"""\n${input.message}\n"""`,
        `\nThe move for this message: ${move.guidance}`,
        `\n${nextStep}`,
        extra ? `\n${extra}` : "",
        "\nWrite the reply.",
      ].join("\n"),
      effort: "medium",
      maxTokens: 4000,
    });

  /*
   * Checked in code, rewritten once, never trimmed.
   *
   * The prompt says how a person writes; `voiceProblems` is what makes it true
   * (rule 40: the model's output is cast, not parsed). A draft that still
   * reads like a model after one rewrite carries its problems out, and the
   * worker holds it for a person rather than sending it under a real name.
   */
  const first = await ask();
  const tidied = { ...first, message: tidyVoice(first.message) };
  const firstProblems = voiceProblems(tidied.message, "reply", { theirMessage: input.message });
  if (!firstProblems.length) return { ...tidied, voiceProblems: [] };

  const second = await ask(
    `${rewriteInstruction(firstProblems)}\n\nYour last version was:\n"""\n${first.message}\n"""`,
  );
  const retidied = { ...second, message: tidyVoice(second.message) };
  return { ...retidied, voiceProblems: voiceProblems(retidied.message, "reply", { theirMessage: input.message }) };
}

function renderHistory(history: ConversationTurn[]): string {
  if (history.length === 0) return "(no previous messages)";
  return history
    .map((turn) => `[${turn.at}] ${turn.role === "rep" ? "Us" : "Prospect"}: ${turn.text}`)
    .join("\n");
}
