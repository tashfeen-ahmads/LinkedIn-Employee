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

export type MessageKind = "invite_note" | "first_message" | "follow_up" | "reply" | "comment";

/** The most a message of each kind may run, in characters, links excluded. */
export const MESSAGE_MAX_CHARS: Record<MessageKind, number> = {
  invite_note: INVITE_NOTE_MAX_CHARS,
  // The first thing after an acceptance: a line and a question.
  first_message: 220,
  follow_up: 280,
  // Inside LinkedIn's under-400 band with room for a link on top.
  reply: 320,
  // A comment under somebody's post: a sentence or two, never a paragraph.
  comment: 220,
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
- Contractions are fine and normal. Capitalise like a person typing on a phone does, with "I" and sentence starts capitalised. Perfect corporate prose is not the goal.
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
  /**
   * What actually exists to hand over: knowledge document titles, the call
   * to action's label and address. An offer of an example, a checklist, a
   * guide, a template or an audit is allowed only when one of these names it
   * (`offeredAsset`). Campaign copy is always checked, with nothing given
   * meaning nothing exists; a reply only when this is passed.
   */
  assets?: readonly string[];
  /**
   * The call to action's own label ("Book a Free Consultation"), so a message
   * that pastes it into a sentence in title case is caught (`titleCaseCta`).
   */
  ctaLabel?: string | null;
  /**
   * The approved openers this note could have leaned on (`openerProblems`).
   * `own` were written for this strategy or attached to this angle; `foreign`
   * were approved for somebody else and are optional shapes at most.
   */
  openers?: { own?: readonly string[]; foreign?: readonly string[] };
}

/*
 * Offering something nobody can hand over.
 *
 * "Want a two sentence example you can try this week?" and "can I send a quick
 * checklist?" went out in live campaigns with nothing behind them: no document
 * in the knowledge base, no link, nothing the agent could send when the
 * prospect said yes. A yes is the outcome the whole campaign exists for, and
 * answering it with nothing (or with something the model then invents) is the
 * worst way to spend one. So an offer of an artefact is allowed only when the
 * artefact exists, checked in code because `callStructured` casts.
 */
const ASSET_NOUN =
  "(case stud(?:y|ies)|cheat ?sheets?|white ?papers?|swipe files?|one-pagers?|e-?books?|examples?|checklists?|guides?|templates?|audits?|playbooks?|samples?|frameworks?|scripts?|breakdowns?|teardowns?|worksheets?|pdfs?)";
const OFFER_PATTERNS = [
  // "want a two sentence example", "can I send a quick checklist",
  // "want me to send over a guide", "interested in a free audit".
  new RegExp(
    String.raw`\b(?:want|send|sending|share|sharing|forward|pass along|put together|show you|give you|drop you|email you|grab you|interested in|would you like|like me to|mind if i)\b(?:\s+(?:you|me|i|over|along|across|to|send|share|see|it))*\s+(?:a|an|the|my|our|one|some|this|that)\s+(?:[\w'-]+\s+){0,4}?${ASSET_NOUN}\b`,
    "gi",
  ),
  // "would a quick checklist help?"
  new RegExp(
    String.raw`\b(?:would|could|can|does|is)\s+(?:a|an|the|one)\s+(?:[\w'-]+\s+){0,4}?${ASSET_NOUN}\b[^.?!]*\b(?:help|useful|worth|interest|handy)`,
    "gi",
  ),
];

/** A verb the prospect does when "you" is its subject: asking, not offering. */
const THEIR_ACT = /^(?:send|sending|share|sharing|forward|pass along|put together)\b/i;

/** Letters and digits only, so "e-book" matches "ebook" and "cheat sheet" "cheatsheet". */
function squash(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The artefact a message offers that nothing given to the writer names, or
 * null. Pure; `assets` are the titles and labels of what really exists.
 */
export function offeredAsset(text: string, assets: readonly string[] = []): string | null {
  // An address names its asset in its path ("acme.com/checklist"), never in
  // its host: "cal.example.com" is not an example anybody can send.
  const have = assets
    .map((asset) => {
      const trimmed = asset.trim();
      return squash(/^https?:\/\//i.test(trimmed) ? trimmed.replace(/^https?:\/\/[^/?#]*/i, "") : trimmed);
    })
    .filter(Boolean);
  for (const pattern of OFFER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      // "could you share the playbook" asks for theirs; it offers nothing.
      if (THEIR_ACT.test(match[0]) && /\byou\s+$/i.test(text.slice(0, match.index))) continue;
      const noun = match[1]!.toLowerCase();
      const stem = squash(noun.replace(/ies$/, "y").replace(/s$/, ""));
      if (!have.some((asset) => asset.includes(stem))) return noun;
    }
  }
  return null;
}

/*
 * A call to action pasted as its label.
 *
 * "If yes, Book a Free Consultation and pick a time" is a button's name typed
 * into a sentence, and it reads as exactly what it is: software filling a
 * slot. A person writes "happy to grab 20 minutes?".
 */
const MINOR = "(?:a|an|the|your|my|our|up|for|to|of|in|on|with|and)";
const GENERIC_CTA = new RegExp(
  String.raw`(?<=[a-z0-9,:] )(?:Book|Get|Schedule|Claim|Grab|Start|Request|Download|Try|Join|Reserve|Apply|Watch|See|Sign)(?: ${MINOR})* [A-Z][a-z]+(?:(?: ${MINOR})* [A-Z][a-z]+)+`,
);

/**
 * The title-case call to action a message carries, or null.
 *
 * `generic: false` checks the known label only. The send path uses that: a
 * rendered message carries the prospect's own company name, and "how Get
 * Smart Plumbing handles…" is a name, not a button.
 */
export function titleCaseCta(
  text: string,
  label?: string | null,
  options: { generic?: boolean } = {},
): string | null {
  const own = label?.trim();
  if (own) {
    const words = own.split(/\s+/);
    const capitalised = words.filter((word) => /^[A-Z][a-z]/.test(word));
    if (words.length >= 2 && capitalised.length >= 2 && text.includes(own)) return own;
  }
  if (options.generic === false) return null;
  return GENERIC_CTA.exec(text)?.[0] ?? null;
}

/** The longest run of words two texts share, in order, ignoring case and punctuation. */
export function sharedWordRun(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  let best = 0;
  // Small inputs (a note and an opener): the quadratic table is a few hundred cells.
  let previous = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i++) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j++) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1]! + 1;
        if (current[j]! > best) best = current[j]!;
      }
    }
    previous = current;
  }
  return best;
}

/** Five words in a row from an opener written for other people is its words, not its shape. */
export const FOREIGN_OPENER_RUN = 5;
/** Eight in a row, or three quarters of it, from the note's own opener is pasting it. */
export const OWN_OPENER_RUN = 8;

/**
 * Whether a note reuses an approved opener's words (rule 40: shapes, never
 * text). An opener written for this strategy may lend its shape and the odd
 * phrase; pasted near verbatim it is a template again, and everybody in the
 * batch receives the same sentence. An opener approved for somebody else may
 * lend its shape at most: "Quick yes or no Maria: do founders still run
 * outbound where you hire" went to recruiters because a line written for
 * founders was the only opener the writer was handed.
 */
export function openerProblems(
  text: string,
  openers: { own?: readonly string[]; foreign?: readonly string[] },
): string[] {
  const own = (openers.own ?? []).map((line) => line.trim()).filter(Boolean);
  const foreign = (openers.foreign ?? []).map((line) => line.trim()).filter((line) => line && !own.includes(line));
  const problems: string[] = [];
  for (const line of foreign) {
    if (sharedWordRun(text, line) >= FOREIGN_OPENER_RUN) {
      problems.push(
        `It borrows the words of an opener written for a different audience ("${line.split(/\s+/).slice(0, 6).join(" ")}…"). Write from this person's own role and company instead.`,
      );
      return problems;
    }
  }
  for (const line of own) {
    const length = words(line).length;
    const run = sharedWordRun(text, line);
    if (run >= OWN_OPENER_RUN || (length >= 5 && run >= Math.ceil(length * 0.75))) {
      problems.push("It pastes an approved opener word for word. Use its shape, not its words, and make it about this person.");
      return problems;
    }
  }
  return problems;
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

  // What tidying fixes without a model, said so a stored row is repaired.
  if (/\{\{\s*pitch\s*\}\}[.,!]/i.test(body)) {
    problems.push("It puts punctuation straight after {{pitch}}, which already ends its own sentence.");
  }
  if (/(^|[.?!]\s+)[a-z]/.test(readable(body)) || /(^|\s)i(\s|'|’)/.test(body)) {
    problems.push('It starts a sentence in lowercase or writes "i". Capitalise those.');
  }

  if (options.theirMessage && mirrors(body, options.theirMessage)) {
    problems.push("It repeats their own words back to them. Respond instead of summarising.");
  }

  // Campaign copy always: nothing given means nothing exists to send. A reply
  // only when its writer says what exists, because a reply is handed the
  // knowledge base and an offer from it is the answer somebody asked for.
  const campaignCopy = kind === "invite_note" || kind === "first_message" || kind === "follow_up";
  if (campaignCopy || (kind === "reply" && options.assets)) {
    const asset = offeredAsset(body, options.assets);
    if (asset) {
      problems.push(
        `It offers ${/^[aeiou]/.test(asset) ? "an" : "a"} ${asset} that does not exist, so a yes cannot be answered. Offer only what you were told exists, or ask a question instead.`,
      );
    }
  }
  if (kind !== "comment") {
    // The broad title-case pattern only on a campaign's templates. Copy
    // written for one person names their company, and "Get Set Fitness" or
    // "Join Forces Media" reads to that pattern exactly like a pasted button;
    // there the known label is the only thing checked.
    const pasted = titleCaseCta(body, options.ctaLabel, { generic: options.template === true });
    if (pasted) {
      problems.push(
        `It pastes "${pasted}" into a sentence in title case, like a button. Ask in plain words, like "happy to grab 20 minutes?".`,
      );
    }
  }
  if (options.openers) problems.push(...openerProblems(body, options.openers));
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
    // A dash before a question is a new sentence, not a comma splice:
    // "…get homeowners to call — can I send a sample?"
    .replace(
      /(\w)\s*[—–]\s*(can|could|would|will|mind|do|does|are|is|want|shall|should|any|how|what|who|when)\b/gi,
      (_m, before: string, word: string) => `${before}. ${word[0]!.toUpperCase()}${word.slice(1)}`,
    )
    .replace(/(\w)\s*[—–]\s*(\w)/g, "$1, $2")
    // {{pitch}} ends its own sentence, so a full stop after it doubles up.
    .replace(/(\{\{\s*pitch\s*\}\})[.,!]/gi, "$1")
    .replace(/(\{\{\s*pitch\s*\}\}\s+)([a-z])/g, (_m, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`)
    .replace(/(^|\s)i(?=\s|'|’)/g, "$1I")
    .replace(/(^|[.?!]\s+)([a-z])/g, (_m, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`)
    .replace(/\s+[-—–]\s?[A-Z][a-z]+(\s[A-Z][a-z]+)?\s*$/, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ,/g, ",")
    .trim();
}

/** The rewrite instruction for a message that failed, built from its problems. */
export function rewriteInstruction(problems: string[]): string {
  return `Your last version did not read like a person wrote it:\n${problems.map((p) => `- ${p}`).join("\n")}\nRewrite it so none of these is true. Keep what it means. Shorter is better.`;
}
