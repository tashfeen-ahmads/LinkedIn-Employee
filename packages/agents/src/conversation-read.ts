import { z } from "zod";
import type { BusinessProfile, CustomerProfile } from "@le/shared";
import { callStructured, type AgentContext } from "./client.js";
import type { ConversationTurn } from "./reply.js";

export const READ_PROMPT_VERSION = "reply.read/2026-11-16-agenda";

/**
 * What a good rep knows before answering, read from the whole conversation.
 *
 * The drafter was handed the history and left to notice what mattered in it,
 * and it did not. A prospect said "No we are working on odoo", answered "Yes"
 * when asked whether Odoo already holds their onboarding documents, and was
 * then told "I consolidate scattered information into a single managed app"
 * with a booking link: the one problem they had just said was solved, pitched
 * at them, after a one-word answer read as a yes to buying.
 *
 * So the conversation is read first, as its own step, and what it says is
 * written down: what they have told us, the tools they use and what those
 * tools are generally known to cover and miss, whether the problem the offer
 * solves is theirs at all, and what their last message means in context. The
 * drafter writes from that, and `alreadySolved` also narrows what the reply
 * may do in code (`replyMove`), so a pitch to somebody whose problem is
 * handled is not left to a prompt.
 */
export const ConversationReadSchema = z.object({
  theirSituation: z
    .array(z.string())
    .describe("Facts the prospect has told us, each one short and in plain words. Only what they actually said."),
  toolsTheyUse: z
    .array(
      z.object({
        name: z.string(),
        whatItCovers: z
          .string()
          .describe("What this tool is generally known to do, from widely known public knowledge. No prices, no version details."),
        whereItFallsShort: z
          .string()
          .nullable()
          .describe("Where this kind of tool commonly leaves manual work that the offer could help with, or null if you do not know."),
      }),
    )
    .describe("Software or services they said they use. Empty if they named none."),
  problemStatus: z
    .enum(["confirmed", "already_solved", "unclear"])
    .describe(
      "Whether the problem our offer addresses is theirs, going only by what they said. already_solved: they told us it is handled (by a tool, a person, a process).",
    ),
  lastMessageMeans: z
    .string()
    .describe("What their latest message means in context. A one-word answer means what our question meant."),
  askedForNextStep: z
    .boolean()
    .describe("True only if they themselves asked, in any language, to talk, see it, book, or get the link."),
  language: z.string().describe("The language their latest message is written in, in English, e.g. English, Russian, Spanish."),
  conversationState: z
    .enum(["open", "closing"])
    .describe(
      "closing: they are politely wrapping up (thanks, no need, keep in touch, that's fine) and there is nothing left to answer. open: anything else.",
    ),
  theirAgenda: z
    .enum(["evaluating_our_offer", "hiring_us", "selling_to_us", "partnership", "networking", "personal", "unclear"])
    .describe(
      "Who is approaching whom. evaluating_our_offer: they are a potential buyer weighing what we sell. hiring_us: they want to hire or recruit the rep, or want to hear about the rep's background or availability. selling_to_us: they are pitching their own product or service. partnership: they propose working together, referrals or a collaboration. networking: they want to connect or talk, with no sale either way. personal: a friend, colleague or existing relationship. unclear: none of these is clear yet.",
    ),
  whatTheyWant: z
    .string()
    .describe("In one short sentence, what they want from this conversation, in their terms rather than ours."),
  bestNextMove: z
    .string()
    .describe("One sentence: what a skilled human rep would do next, given all of the above."),
});
export type ConversationRead = z.infer<typeof ConversationReadSchema>;

const READ_SYSTEM = `You are a senior sales rep reading a LinkedIn conversation before anybody answers it. You do not write the reply. You work out what is going on, so the reply can be specific and right.

Read every message, ours and theirs, in order. Then:
- List what they have told us about themselves: their tools, their process, their team, what works, what does not. Only what they said.
- For every tool or service they named, say what it is generally known to cover, and where tools like it commonly leave manual work. Use widely known knowledge only. Never state prices, plan names or figures, and if you do not know the tool, say so plainly.
- Decide whether the problem our offer addresses is theirs. If they said it is already handled, that is already_solved, even if they were polite about it.
- Say what their latest message means in context. A short answer such as "Yes" or "No" answers the question we asked: "Yes" to "Is X already handling this?" means it is handled, not that they want to buy.
- askedForNextStep is true only when they asked, in their own words, to talk, see it, book, or get a link.
- When they describe how they handle it today, look for the gap a buyer would care about (a delay, a manual step, something left until the next morning). If there is one, the problem is confirmed, even if they did not call it a problem.
- conversationState is closing when they are politely ending it (thanks, all good, keep in touch, that's fine) with nothing left to answer. Then the right move is one warm line and no new question.
- Note every question we have already asked. The next reply must never ask one of them again.
- Work out who is approaching whom. Somebody who answers our outreach is usually weighing our offer, but not always: a recruiter who wants to hire the rep, a vendor selling their own service, somebody proposing a partnership, or somebody who just wants to network has their own agenda, and the reply must serve it. Read their words, not our campaign: "I see you are open to work, let's talk about your background" is hiring_us, not interest in our offer.
- Say, in one sentence, what a skilled human rep would do next. Never "pitch and send the link" to somebody whose problem is already solved.`;

export async function readConversation(
  ctx: AgentContext,
  input: {
    business: BusinessProfile;
    profile?: CustomerProfile;
    pitch?: string;
    history: ConversationTurn[];
    message: string;
  },
): Promise<ConversationRead> {
  const offer = input.pitch ?? input.business.oneLiner ?? input.business.offering ?? "";
  return callStructured(ctx, {
    agent: "reply.read",
    model: ctx.client.models.writer,
    promptVersion: READ_PROMPT_VERSION,
    schema: ConversationReadSchema,
    system: [{ text: READ_SYSTEM, cached: true }],
    userContent: [
      `Our company: ${input.business.companyName}. What we offer: ${offer}`,
      input.profile ? `Who we are reaching: ${input.profile.name}` : "",
      `\nThe conversation so far:\n${
        input.history.length
          ? input.history.map((t) => `${t.role === "rep" ? "Us" : "Prospect"}: ${t.text}`).join("\n")
          : "(nothing before this)"
      }`,
      `\nTheir latest message:\n"""\n${input.message}\n"""`,
      "\nRead the conversation.",
    ]
      .filter(Boolean)
      .join("\n"),
    effort: "low",
    maxTokens: 3000,
  });
}

/**
 * How the reply serves somebody who came with their own agenda.
 *
 * A recruiter on the Freelancer account wrote "I see you are open to work,
 * let's have a dialogue about your background" and was answered with the
 * campaign's pitch. Only somebody weighing our offer hears it.
 */
const AGENDA_GUIDANCE: Record<ConversationRead["theirAgenda"], string | null> = {
  evaluating_our_offer: null,
  hiring_us:
    "They are interested in the rep, not in buying. Answer as the rep about the rep: what they do and their experience, in plain words from what you know about them. No pitch of the offer. If they asked to talk, agree and give the way to book.",
  selling_to_us:
    "They are selling to us. Thank them briefly and honestly, say it is not something we need right now unless what you know says otherwise, ask nothing, pitch nothing.",
  partnership:
    "They propose working together. Respond to their idea itself, ask the one question that tells whether it fits, and offer a call only if they asked for one. No pitch.",
  networking:
    "They want to connect, not to buy. Be warm and personal, answer what they said, no pitch. Offer a call only if they asked for one.",
  personal:
    "This is somebody the rep already knows. Keep it short and personal, never sales.",
  unclear: null,
};

/** What the drafter is told, from the read. */
export function renderRead(read: ConversationRead): string {
  const lines = [
    "What you know about this person, from the whole conversation (use it; never contradict it):",
    ...(read.theirSituation.length ? read.theirSituation.map((s) => `- ${s}`) : ["- Nothing specific yet."]),
  ];
  for (const tool of read.toolsTheyUse) {
    lines.push(
      `- They use ${tool.name}: ${tool.whatItCovers}${tool.whereItFallsShort ? ` Where tools like it usually leave work: ${tool.whereItFallsShort}` : ""}`,
    );
  }
  lines.push(`- Their latest message means: ${read.lastMessageMeans}`);
  lines.push(`- They wrote in ${read.language}. Reply in ${read.language}.`);
  if (read.conversationState === "closing") {
    lines.push("- They are wrapping the conversation up. One short warm line, no question, no pitch, nothing to forward.");
  }
  const agenda = AGENDA_GUIDANCE[read.theirAgenda];
  if (agenda) lines.push(`- What they want: ${read.whatTheyWant} ${agenda}`);
  if (read.problemStatus === "already_solved") {
    lines.push("- They have told you the problem your offer solves is already handled. Do not pitch it.");
  }
  lines.push(`- What a skilled rep would do now: ${read.bestNextMove}`);
  return lines.join("\n");
}
