import {
  type ReplyIntent,
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
    model: ctx.client.models.classifier,
    promptVersion: CLASSIFY_PROMPT_VERSION,
    schema: ReplyClassificationSchema,
    system: [{ text: CLASSIFY_SYSTEM, cached: true }],
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
   */
  if (rules.handOffOnHumanRequest && classification.asksForHuman) {
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
export async function draftReply(ctx: AgentContext, input: DraftInput): Promise<ReplyDraft> {
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
      ? `\nTHE PITCH — the offer this business makes, approved by the salesperson:\n"""\n${input.pitch}\n"""\n\nWhen the prospect wants to know what this is, or has shown interest, make THIS offer. Adapt the wording to them and to what they actually asked; never invent a different offer, a different problem, or a benefit that is not in it. It is what your colleagues are telling every other prospect this week.`
      : "",
    // The rep's own words about voice, after the shipped rules and inside the
    // cached half: identical for every conversation in this workspace.
    input.voice ? `\n${input.voice}` : "",
    input.qualification?.length
      ? `\nWhat this agent is trying to find out, when the conversation gives you a natural opening for it. Never interrogate; one question at a time, and never at the cost of answering what they actually asked:\n${input.qualification
          .map((q) => `- ${q.ask}${q.required ? " (needed before handing over)" : ""}`)
          .join("\n")}`
      : "",
    `\nGoal for this conversation: ${input.rules.goal}`,
    // What the campaign is asking for, which is not always a meeting. Without
    // it the agent pursues a call in a conversation whose whole point was to
    // get somebody to look at a page.
    input.goal === "link"
      ? "\nThis campaign is NOT asking for a meeting. Do not propose a call or offer times. The ask is that they take a look at the link above."
      : input.goal === "reply"
        ? "\nThis campaign is NOT asking for a meeting and has no link. The ask is a genuine reply — a conversation, an opinion, an introduction."
        : "",
    /*
     * Interest is answered with the thing itself, not with another question.
     *
     * A prospect who says "sure, what is it?" has spent the only attention
     * this conversation gets. Asking them to qualify first trades a warm reply
     * for a second wait, and the usual outcome of the second wait is silence.
     * So the page goes out on that message — the page is the pitch, and the
     * conversation continues underneath it.
     *
     * This changes what the agent leads with, never what it is allowed to
     * send: the link still has to be one it was actually handed, and
     * `draftLinkCheck` still holds a draft carrying anything else. Rule 30 is
     * untouched.
     */
    intent === "interested"
      ? input.goal === "reply"
        ? "\nThis person has just said they are interested. Make the pitch now, in this message — do not ask a qualifying question first and do not promise to send details later. Then one question that invites a reply."
        : "\nThis person has just said they are interested. Make the pitch and send the link now, in this message — do not ask a qualifying question first and do not promise to send it later. Two or three lines of pitch, then the link. If the goal is a meeting, offer the times as well."
      : "",
  ].join("\n");

  return callStructured(ctx, {
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
      `\nClassification: ${JSON.stringify(input.classification)}`,
      input.bookedMeeting
        ? "\nThe meeting they accepted is already in the calendar and an invitation has been sent. Confirm it briefly and warmly. Do not offer any further times."
        : input.availableSlots.length
          ? `\nFree slots on the calendar (offer at most three, exactly as written here):\n${input.availableSlots.join("\n")}`
          : `\nNo calendar availability was retrieved. Do not invent times.${
              input.rules.bookingLink
                ? ` The ONLY link you may send is ${input.rules.bookingLink} — copy it exactly, and never write any other address.`
                : " You have no link to send. Do not write a URL of any kind: one you invent will 404 in front of the prospect."
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
