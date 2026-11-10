import type { ReplyIntent } from "./schemas.js";

/*
 * What a reply may do, decided by what the prospect said, in code.
 *
 * The drafter used to get one instruction for every intent but "interested",
 * and for a meeting campaign it was always handed the calendar and the
 * booking link. So a prospect who wrote "we're old school, when I can convince
 * the owner we can start looking at systems" was answered with a three-feature
 * paragraph and "book a 15-minute walkthrough with me: <link>". Somebody who
 * said "I'll check your calendar and get back to you" got the same paragraph
 * and the same link a second time. A skilled rep does neither: the evidence
 * (Gong's CTA data, practitioners' objection handling) says confirm interest
 * before asking for a meeting, and never push a person who has just told you
 * they are not ready.
 *
 * The prompt says so, and the worker also takes the link and the times away
 * when they are not allowed, so a draft that pitches anyway is held by the
 * link check rather than trusted (rule 30's mechanism, reused).
 */

export interface ReplyMove {
  /** Whether to answer at all. An auto-reply or spam gets nothing. */
  reply: boolean;
  /** Whether the approved offer may be made in this message. */
  pitch: boolean;
  /** Whether the campaign's link (booking or destination) may be sent. */
  link: boolean;
  /** Whether calendar times may be offered. */
  slots: boolean;
  /** What to do, said to the writer. */
  guidance: string;
}

/** They asked to see it, book it, or get the link, in so many words. */
const ASKS_FOR_NEXT_STEP = /\b(link|book|booking|calendar|schedule|slot|time works|times|available|availability|demo|call|meet|zoom|send (it|me|over))\b/i;

/**
 * They are not ready yet: somebody else has to agree, or it is for later.
 * "When I can convince the owner we can start looking at systems" was read by
 * the classifier as interested, at 0.86, and answered with a feature list and
 * a booking link. Checked in code as well, as opt-outs are (rule 7).
 */
const NOT_READY =
  /\b(when (i|we) (can|get|have|are)|convinc\w*|run (it|this) (by|past)|check with (my|the|our)|talk (it )?(over )?(with|to) (my|the|our) (boss|owner|partner|wife|husband|team|manager|board)|not (right )?now|not yet|maybe later|down the road|next (year|quarter|month|spring|summer|fall|autumn|winter)|later (this|in the) year|in a few (weeks|months)|no budget|start looking|keep (you|it) in mind|revisit|circle back)\b/i;

/** They already have something that does this: a reason it may not fit, not a yes. */
const ALREADY_HAVE =
  /\b(we (already |currently )?(have|use|run|got) (a|an|our own|someone|something)|already (have|use|using|working with|on)|in-house|in house|do it ourselves|we(?:'re| are) (?:already )?(?:using|working (?:on|with)|running on|on) [a-z0-9])/i;

/**
 * A bare yes or no: the answer to whatever we last asked, and nothing more.
 *
 * "Is Odoo already hosting your onboarding docs?" "Yes" was classified as
 * interested at 0.9, and the reply pitched the one problem the prospect had
 * just said was solved, with a booking link. A one-word answer means what the
 * question meant, so it is buying intent only when our question was the
 * offer of a next step.
 */
const BARE_ANSWER = /^\s*(yes|yeah|yep|yup|ya|yes sir|correct|right|exactly|true|no|nope|nah|not really|sure|ok|okay|k)\s*[.!]*\s*$/i;

/** What the prospect has told us that changes what may be said, from reading the conversation. */
export interface ConversationFacts {
  /** The problem the offer solves is already handled for them, by their own account. */
  alreadySolved?: boolean;
  /** They described the problem the offer solves (a gap, a delay, a manual step) as theirs. */
  painConfirmed?: boolean;
  /** They asked for the next step themselves, read in any language (the words below are English only). */
  askedForNextStep?: boolean;
  /** They are politely ending the conversation and nothing is left to answer. */
  closing?: boolean;
  /** Our last message to them, which a short answer is an answer to. */
  lastRepMessage?: string;
}

/**
 * The intent a reply is written for: the classifier's, unless the words say
 * plainly that they are not ready or already covered and they have not asked
 * for the next step themselves.
 */
export function effectiveIntent(intent: ReplyIntent, message: string, facts: ConversationFacts = {}): ReplyIntent {
  // They asked for it, in whatever language: "пришлите ссылку" twice before
  // the link went, because the words above are English.
  if (facts.askedForNextStep && !NOT_READY.test(message) && (intent === "question" || intent === "other")) {
    return "interested";
  }
  if (BARE_ANSWER.test(message) && intent === "interested") {
    const offeredNextStep = Boolean(facts.lastRepMessage && ASKS_FOR_NEXT_STEP.test(facts.lastRepMessage));
    if (!offeredNextStep) return facts.alreadySolved ? "objection" : "other";
  }
  if ((ASKS_FOR_NEXT_STEP.test(message) || facts.askedForNextStep) && !NOT_READY.test(message)) return intent;
  const softened = intent === "interested" || intent === "question" || intent === "other";
  if (!softened) return intent;
  if (NOT_READY.test(message)) return "not_now";
  if (ALREADY_HAVE.test(message)) return "objection";
  // Told earlier in the conversation that it is handled, and nothing since
  // asks for the next step: still not a yes.
  if (facts.alreadySolved) return "objection";
  return intent;
}

export function replyMove(
  classified: ReplyIntent,
  message: string,
  context: { linkAlreadySent?: boolean } & ConversationFacts = {},
): ReplyMove {
  const intent = effectiveIntent(classified, message, context);
  const asked = ASKS_FOR_NEXT_STEP.test(message) || context.askedForNextStep === true;
  // Politely ending it, with nothing asked: one warm line, nothing to sell.
  // A prospect who had sold his store was asked twice whether we could check
  // back, then offered a note to forward to an employer he no longer had.
  if (context.closing && !asked && intent !== "question" && intent !== "referral") {
    return {
      reply: true,
      pitch: false,
      link: false,
      slots: false,
      guidance:
        "They are wrapping the conversation up. One short, warm line that fits what they said. No question, no pitch, no link, nothing to forward, and do not ask again anything you already asked.",
    };
  }
  // They told us how they handle it today and it leaves the gap the offer
  // closes: an opening, not a "check back later". Name the gap, say in one
  // sentence how you help, and ask whether it is worth a look. No link yet.
  if (context.painConfirmed && !context.alreadySolved && !asked && (intent === "other" || intent === "not_now") && !NOT_READY.test(message)) {
    return {
      reply: true,
      pitch: true,
      link: false,
      slots: false,
      guidance:
        "What they described leaves the gap your offer closes. Acknowledge their setup in a few words, point to that one gap as a question or a plain observation, say in one sentence how you help using the approved offer, and ask if it is worth a look. No link and no times until they say yes.",
    };
  }
  // "I'll check your calendar and get back to you" after the link went out is
  // a yes that needs nothing more. Sending the pitch and the link again is
  // what turned a warm prospect's polite answer into a second advert.
  const wantsItAgain = /\b(resend|send (it|that|the link) again|again|lost|can't find|cannot find|didn't get|did not get)\b/i.test(message);
  if (context.linkAlreadySent && (intent === "interested" || intent === "question") && !wantsItAgain) {
    return {
      reply: true,
      pitch: false,
      link: false,
      slots: false,
      guidance:
        "They already have the link and are taking it from here. One short, friendly line. Do not pitch again, do not send the link again, do not ask for anything.",
    };
  }
  switch (intent) {
    case "interested":
      return {
        reply: true,
        pitch: true,
        link: true,
        slots: true,
        guidance:
          "They are open to it. Say what it is for them in one plain sentence, in your own words, using the approved offer. Then the next step: for a meeting, two of the listed times or the link, not both; for a link campaign, the link. Nothing else.",
      };
    case "question":
      return {
        reply: true,
        pitch: asked,
        link: asked,
        slots: asked,
        guidance: asked
          ? "They asked how to see it or when to talk. Answer that directly in one or two short sentences and give the next step they asked for."
          : "Answer exactly what they asked, in one or two short sentences, from the material only. Then at most one easy question back. Do not pitch beyond what answers the question, and do not send a link or times they did not ask for.",
      };
    case "objection":
      return {
        reply: true,
        pitch: false,
        link: false,
        slots: false,
        guidance: context.alreadySolved
          ? "They have told you this is already handled, often with a tool they named. Do not pitch the problem they solved and do not argue. Acknowledge what they use in a few plain words, then ask one specific question about where it falls short for them or what still takes manual work around it, using what you know about that tool. No link, no times."
          : "They have a concern. Do not argue and do not pitch again. Acknowledge it in a few plain words, then ask one question that helps you understand it (cost, timing, fit, or who decides). No link, no times.",
      };
    case "not_now":
      return {
        reply: true,
        pitch: false,
        link: false,
        slots: false,
        guidance:
          "They are not ready. Respect that. No pitch, no feature, no link, no times. Ask once whether it is timing or fit, or whether you may check back in a named month that fits what they said. If someone else decides (an owner, a head office), ask who that is or what they will care about most. Never ask anything you already asked, and never offer something that does not fit their situation.",
      };
    case "referral":
      return {
        reply: true,
        pitch: false,
        link: false,
        slots: false,
        guidance:
          "They pointed you to someone else. Thank them briefly, and ask whether it is fine to mention they suggested it, or the best way to reach that person. If they pointed to themselves, treat it as their answer. No pitch.",
      };
    case "not_interested":
      return {
        reply: true,
        pitch: false,
        link: false,
        slots: false,
        guidance: "They are not interested. Thank them in one short line and close. Nothing else.",
      };
    case "out_of_office":
    case "spam":
      return { reply: false, pitch: false, link: false, slots: false, guidance: "" };
    default:
      return {
        reply: true,
        pitch: false,
        link: asked,
        slots: asked,
        guidance:
          "Reply briefly and naturally to what they actually said, in one or two short sentences, with at most one easy question. No pitch and no link unless they asked for one.",
      };
  }
}
