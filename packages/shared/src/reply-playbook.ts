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
  /\b(we (already |currently )?(have|use|run|got) (a|an|our own|someone|something)|already (have|use|using|working with)|in-house|in house|do it ourselves)\b/i;

/**
 * The intent a reply is written for: the classifier's, unless the words say
 * plainly that they are not ready or already covered and they have not asked
 * for the next step themselves.
 */
export function effectiveIntent(intent: ReplyIntent, message: string): ReplyIntent {
  if (ASKS_FOR_NEXT_STEP.test(message) && !NOT_READY.test(message)) return intent;
  const softened = intent === "interested" || intent === "question" || intent === "other";
  if (!softened) return intent;
  if (NOT_READY.test(message)) return "not_now";
  if (ALREADY_HAVE.test(message)) return "objection";
  return intent;
}

export function replyMove(
  classified: ReplyIntent,
  message: string,
  context: { linkAlreadySent?: boolean } = {},
): ReplyMove {
  const intent = effectiveIntent(classified, message);
  const asked = ASKS_FOR_NEXT_STEP.test(message);
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
        guidance:
          "They have a concern. Do not argue and do not pitch again. Acknowledge it in a few plain words, then ask one question that helps you understand it (cost, timing, fit, or who decides). No link, no times.",
      };
    case "not_now":
      return {
        reply: true,
        pitch: false,
        link: false,
        slots: false,
        guidance:
          "They are not ready. Respect that. No pitch, no feature, no link, no times. Either ask whether it is all right to check back at a sensible time, or ask one small question about what would need to change. If someone else has to be convinced (an owner, a boss), offer a two-line summary they could forward, or ask what that person will care about most.",
      };
    case "referral":
      return {
        reply: true,
        pitch: false,
        link: false,
        slots: false,
        guidance:
          "They pointed you to someone else. Thank them briefly and ask the best way to reach that person, or whether they would mind making an introduction. No pitch.",
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
