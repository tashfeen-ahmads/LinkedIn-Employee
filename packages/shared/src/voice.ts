import { INVITE_NOTE_MAX_CHARS } from "./constants.js";
import { extractLinks } from "./links.js";

/*
 * How the agent writes to a real person, in one definition.
 *
 * Every writer used to carry its own rules, none of them mentioned a dash, and
 * several prompts' own examples used one. What reached prospects read as a
 * model: "Got it — you're answering leads the next day and you've already
 * raised AI with the owner. Our Revenue Capture system handles voice, website
 * chat and SMS…" and a booking link, in answer to somebody who had just said
 * they were not ready. Long, mirrored, a feature list, a hard ask.
 *
 * The evidence agrees on the shape that gets answered. LinkedIn's own InMail
 * study: under 400 characters gets 22% more responses than average. Email and
 * DM studies put the peak around 25 to 50 words. Gong's data: an interest
 * question beats a meeting ask until somebody has said yes. And the tells
 * people now read as "written by AI" are specific and checkable: the em dash,
 * stock openers, repeating their words back, three-item lists, sign-offs.
 *
 * So there are two halves, and the prompt alone is never trusted (rule 40:
 * `callStructured` casts, it does not parse). `VOICE_RULES` goes into every
 * writer's prompt. `voiceProblems` checks every message in code, and its list
 * is what the writer is handed on its one rewrite. `tidyVoice` makes only the
 * edits that cannot change meaning. Nothing is ever truncated.
 */

export type MessageKind = "invite_note" | "first_message" | "follow_up" | "reply";

/** The most a message of each kind may run, in characters, links excluded. */
export const MESSAGE_MAX_CHARS: Record<MessageKind, number> = {
  invite_note: INVITE_NOTE_MAX_CHARS,
  // The first thing after an acceptance: a line and a question.
  first_message: 220,
  follow_up: 280,
  // Inside LinkedIn's under-400 band with room for a link on top.
  reply: 320,
};

/** The rules every writer is given, word for word. */
export const VOICE_RULES = `HOW TO WRITE (these override anything else about style):
- Write like a busy person texting one other person on LinkedIn from their phone. Short, plain, warm, specific.
- Ask what a stranger can answer in one breath: a yes or no, a name, something they know off the top of their head. Never "how do you currently handle X" or "what is your process for Y": that is homework, and homework from a stranger is ignored.
- One idea per message and at most one question. No lists of features, no "X, Y and Z" runs of benefits, no brackets full of capabilities.
- Never repeat or summarise what they just said back to them. Respond to it.
- Never start with "Got it", "Great question", "Thanks for sharing", "Absolutely", "Totally understand", "I hope", "I came across" or "I noticed".
- No em dashes (—), no en dashes (–), no semicolons. Use a full stop or a comma.
- No exclamation marks, no emoji, no bullet points, no sign-off, no name at the end.
- Never use: leverage, streamline, seamless, robust, elevate, unlock, empower, tailored, cutting-edge, game-changer, delve, "touch base", "circle back", "feel free", "don't hesitate", "I'd love to", "looking forward", "just following up", "just checking in", "I'm reaching out", "I'm introducing".
- Contractions are fine and normal. Lowercase-casual is fine. Perfect corporate prose is not.
- Never quote somebody's job title or profile back to them in quotation marks.`;

const STOCK_OPENERS = [
  "got it",
  "great question",
  "thanks for sharing",
  "absolutely",
  "totally understand",
  "i hope",
  "hope you",
  "i came across",
  "i noticed",
];

const BANNED = [
  "leverage",
  "streamline",
  "seamless",
  "robust",
  "elevate",
  "unlock",
  "empower",
  "tailored",
  "cutting-edge",
  "cutting edge",
  "game-changer",
  "game changer",
  "delve",
  "touch base",
  "circle back",
  "feel free",
  "don't hesitate",
  "do not hesitate",
  "i'd love to",
  "looking forward",
  "just following up",
  "just checking in",
  "i'm reaching out",
  "i am reaching out",
  "i'm introducing",
  "i am introducing",
  "in today's",
  "furthermore",
  "moreover",
  "best regards",
  "kind regards",
  "no assumptions",
];

/** Placeholders a campaign step may carry: filled for everybody at send time. */
const STEP_PLACEHOLDERS = new Set(["first_name", "cta_link", "pitch"]);

/** The text a reader actually reads: links and placeholders do not count towards length. */
function readable(text: string): string {
  let out = text;
  for (const link of extractLinks(text)) out = out.replace(link, "");
  return out.replace(/\{\{[^}]*\}\}/g, "").replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether the opening sentence repeats five or more of their words in a row.
 * "Got it, you're answering leads the next day" is their message read back to
 * them, which is what a model does and a person does not.
 */
function mirrors(text: string, theirs: string): boolean {
  const first = words(text.split(/(?<=[.?])\s/)[0] ?? text);
  const source = ` ${words(theirs).join(" ")} `;
  for (let i = 0; i + 5 <= first.length; i++) {
    if (source.includes(` ${first.slice(i, i + 5).join(" ")} `)) return true;
  }
  return false;
}

export interface VoiceOptions {
  /** What the prospect just wrote, for a reply: never read back to them. */
  theirMessage?: string;
  /**
   * A campaign's template, filled per person at send time, so the step
   * placeholders are allowed. A note written for one named person has none.
   */
  template?: boolean;
}

/**
 * What is wrong with a message, as sentences a writer can act on. Empty when
 * it reads like a person. Pure, so the same list is the test, the rewrite
 * instruction and the reason a draft is held.
 */
export function voiceProblems(text: string, kind: MessageKind, options: VoiceOptions = {}): string[] {
  const problems: string[] = [];
  const body = text.trim();
  // Curly quotes are what a phone and a model both type: "I’m" is "I'm".
  const lower = body.toLowerCase().replace(/[‘’]/g, "'");
  const max = MESSAGE_MAX_CHARS[kind];
  const length = readable(body).length;

  if (length > max) problems.push(`It is ${length} characters. Keep it under ${max}.`);
  if (/[—–]/.test(body)) problems.push("It uses a dash (— or –). Use a full stop or a comma.");
  if (body.includes(";")) problems.push("It uses a semicolon. Use a full stop.");
  if (body.includes("!")) problems.push("It uses an exclamation mark.");
  const questions = (body.match(/\?/g) ?? []).length;
  if (questions > 1) problems.push(`It asks ${questions} questions. Ask one at most.`);
  if (/^\s*([-•*]|\d+[.)])\s/m.test(body)) problems.push("It uses a list. Write it as one or two sentences.");
  if (
    /\([^)]*,[^)]*,[^)]*\)/.test(body) ||
    /:\s*[^.?]+,[^.?]+\band\b/i.test(body) ||
    // "handles voice, website chat and SMS": three things in a run, inside a
    // sentence (two lowercase words before it, so "Sure, Tom and I" is not one).
    /(?<=\b[a-z][\w']* [a-z][\w']* )[\w-]+(?: [\w-]+){0,2}, [\w-]+(?: [\w-]+){0,2},? (?:and|&) [\w-]+/.test(body)
  ) {
    problems.push("It lists several features or benefits. Name one thing, or none.");
  }

  const opener = STOCK_OPENERS.find((phrase) => lower.startsWith(phrase));
  if (opener) problems.push(`It opens with "${opener}". Start with the point.`);
  for (const phrase of BANNED) {
    if (lower.includes(phrase)) problems.push(`It says "${phrase}", which reads as a template.`);
  }

  if (/["“][^"”]{12,}["”]/.test(body)) {
    problems.push("It quotes something back in quotation marks. Say it in your own words or leave it out.");
  }
  if (/(^|\s)[-—–]\s?[A-Z][a-z]+(\s[A-Z][a-z]+)?\s*$/.test(body)) {
    problems.push("It ends with a sign-off. Leave the name off.");
  }

  const placeholders = [...body.matchAll(/\{\{\s*([#^/]?)\s*([a-z_]+)\s*\}\}/gi)].map((m) => m[2]!.toLowerCase());
  if (!options.template && (kind === "reply" || kind === "invite_note")) {
    if (placeholders.length || /\[(name|first name|company)\]/i.test(body)) {
      problems.push("It still has a placeholder in it. Write the real words.");
    }
  } else {
    const unsafe = [...new Set(placeholders.filter((name) => !STEP_PLACEHOLDERS.has(name)))];
    if (unsafe.length) {
      problems.push(
        `It uses ${unsafe.map((n) => `{{${n}}}`).join(", ")}, which is empty for some people and would be sent as written. Only {{first_name}} is safe.`,
      );
    }
  }

  // The first thing a stranger reads asks them to do homework: describe a
  // process, or answer a question that takes a paragraph. "How are inquiries
  // passed from your marketing channels to the team that follows up?" went to
  // real people and got nothing back.
  if (kind === "first_message" || kind === "invite_note") {
    const asks = body.split(/(?<=[.?!])\s+/).filter((sentence) => sentence.includes("?"));
    const homework = asks.some(
      (q) =>
        /\b(currently|process|workflow|walk me through)\b/i.test(q) ||
        (/^(hi [^,]+,\s*)?(how|what)\b/i.test(q) && q.split(/\s+/).length > 12),
    );
    if (homework) {
      problems.push("Its question is homework. Ask something they can answer in one breath, like a yes or no.");
    }
  }

  // A step that is only the offer arrives as a line of advertising with nothing
  // to answer. The offer goes with a short, easy question.
  if (kind !== "reply" && kind !== "invite_note" && /\{\{\s*pitch\s*\}\}/i.test(body) && !readable(body)) {
    problems.push("It is the offer on its own. Add one short, easy question after it.");
  }

  if (options.theirMessage && mirrors(body, options.theirMessage)) {
    problems.push("It repeats their own words back to them. Respond instead of summarising.");
  }
  return problems;
}

/**
 * The edits that cannot change what a message says: a dash becomes a comma or
 * a full stop, a trailing sign-off goes, spacing is tidied. Never shortens a
 * sentence and never removes a word that carries meaning (rule 40: dropped or
 * rewritten, never truncated).
 */
export function tidyVoice(text: string): string {
  return text
    .replace(/\s*[—–]\s*$/g, ".")
    .replace(/(\w)\s*[—–]\s*(\w)/g, "$1, $2")
    .replace(/\s+[-—–]\s?[A-Z][a-z]+(\s[A-Z][a-z]+)?\s*$/, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ,/g, ",")
    .trim();
}

/** The rewrite instruction for a message that failed, built from its problems. */
export function rewriteInstruction(problems: string[]): string {
  return `Your last version did not read like a person wrote it:\n${problems.map((p) => `- ${p}`).join("\n")}\nRewrite it so none of these is true. Keep what it means. Shorter is better.`;
}
