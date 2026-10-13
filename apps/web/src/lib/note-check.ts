import { INVITE_NOTE_MAX_CHARS, containsLink } from "@le/shared";

/**
 * The connection note checker on /tools/connection-note-checker, as pure
 * functions so the page and its test read one definition.
 *
 * The link check is `containsLink` itself, the same function that drops a note
 * carrying a link before Nora sends it (rule 29). The length is measured the
 * way Nora measures it (`note.length` against `INVITE_NOTE_MAX_CHARS`). The
 * pitch patterns are a small, deliberately literal list: they are a prompt to
 * reread a sentence, not a verdict on it, so a phrase is only listed when it
 * almost always means the note is selling.
 */

/**
 * LinkedIn's own ceilings, from its Help Center as found in October 2026:
 * 200 characters for a personalized note on a free (basic) account, 300 on
 * Premium. A LinkedIn fact rather than a Nora rule, which is why it is not in
 * @le/shared; Nora's cap is `INVITE_NOTE_MAX_CHARS`.
 */
export const LINKEDIN_NOTE_LIMITS = { free: 200, premium: 300 } as const;

export type LengthStatus = "empty" | "fits" | "premium_only" | "too_long";

export interface PitchFinding {
  id: "we_help" | "meeting_ask" | "our_product" | "price" | "questions" | "domain" | "placeholder";
  label: string;
  why: string;
  /** The text that triggered it, as written, so the reader can find it. */
  matched: string[];
}

export interface NoteCheck {
  length: number;
  status: LengthStatus;
  /** Characters over Nora's cap, or 0. */
  overBy: number;
  hasLink: boolean;
  findings: PitchFinding[];
}

interface Pattern {
  id: PitchFinding["id"];
  label: string;
  why: string;
  re: RegExp;
}

const PATTERNS: readonly Pattern[] = [
  {
    id: "we_help",
    label: "Opens with what you do",
    why: "\"We help...\" is the first line of a pitch. A note that is about the sender reads as an advert before the person has accepted anything.",
    re: /\bwe (?:help|helped|work with|specialise|specialize|provide|offer)\b/gi,
  },
  {
    id: "meeting_ask",
    label: "Asks for a meeting",
    why: "Asking a stranger for their time before they have accepted is the most common reason a note is ignored. Ask after they reply.",
    re: /\b(?:book|schedule|hop on|jump on|grab|set up)\s+(?:a\s+)?(?:quick\s+|short\s+|brief\s+)?(?:call|chat|meeting|demo)\b|\b\d{1,2}[\s-]?(?:min|mins|minute|minutes)\b|\bquick call\b|\bcalendly\b/gi,
  },
  {
    id: "our_product",
    label: "Talks about your product",
    why: "\"Our platform\" and \"our solution\" belong in the reply, if they ask. In the note they say the connection is a funnel.",
    re: /\bour (?:[a-z-]+ )?(?:platform|product|products|solution|solutions|software|tool|app|services|service|agency|offer)\b/gi,
  },
  {
    id: "price",
    label: "Mentions price or a deal",
    why: "Prices, discounts and free trials are sales copy. Nobody accepts a connection to hear an offer.",
    re: /[$£€]\s?\d|\b\d+\s?%\s?off\b|\b(?:pricing|price|discount|free trial|per month|per seat|\/mo)\b/gi,
  },
  {
    id: "domain",
    label: "Looks like a web address",
    why: "Even without https:// in front, a domain in a note reads as a link and does the same damage.",
    re: /\b[a-z0-9-]+\.(?:co\.uk|com|io|co|ai|net|org|app|dev|so|xyz)(?:\/\S*)?\b/gi,
  },
  {
    id: "placeholder",
    label: "Placeholder left in",
    why: "A {{first_name}} or [Name] that was never filled in tells the reader the note was a template.",
    re: /\{\{[^}]*\}\}|\[(?:first ?name|name|company|role|title)\]/gi,
  },
];

/** The pitch patterns in a note, in a fixed order, each listed once. */
export function pitchFindings(text: string): PitchFinding[] {
  const found: PitchFinding[] = [];
  for (const pattern of PATTERNS) {
    const matched = [...new Set(Array.from(text.matchAll(pattern.re), (m) => m[0].trim()))];
    if (matched.length) found.push({ id: pattern.id, label: pattern.label, why: pattern.why, matched });
    // The question rule sits after the wording rules and before the address
    // ones, so the list reads from the most to the least common problem.
    if (pattern.id === "price") {
      const questions = (text.match(/\?/g) ?? []).length;
      if (questions > 1) {
        found.push({
          id: "questions",
          label: `${questions} questions`,
          why: "One question gives someone an easy reply. Two or more reads as a form to fill in, and the easiest answer is none.",
          matched: [],
        });
      }
    }
  }
  return found;
}

export function lengthStatus(length: number): LengthStatus {
  if (length === 0) return "empty";
  if (length <= INVITE_NOTE_MAX_CHARS) return "fits";
  if (length <= LINKEDIN_NOTE_LIMITS.premium) return "premium_only";
  return "too_long";
}

/** Everything the checker shows, from the text alone. Nothing is sent or kept. */
export function checkNote(text: string): NoteCheck {
  const length = text.length;
  const hasLink = containsLink(text);
  // A full link is already reported as a link; listing its domain again
  // would say the same thing twice.
  const findings = pitchFindings(text).filter((f) => !(hasLink && f.id === "domain"));
  return {
    length,
    status: lengthStatus(length),
    overBy: Math.max(0, length - INVITE_NOTE_MAX_CHARS),
    hasLink,
    findings,
  };
}
