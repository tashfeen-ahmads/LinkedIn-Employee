/**
 * Company and role, read out of the headline we already have.
 *
 * `prospects.company` and `prospects.title` were null for every person in the
 * database. The columns existed and the code wrote them, but the only place
 * they are ever populated is the profile endpoint — and rule 13 spends that
 * call only on candidates that arrived without a public URL, because every
 * request comes off a seat somebody pays for. Classic search returns a
 * headline and nothing structured, so for everybody else the two columns
 * stayed empty, and a message written from `{{company}}` had nothing to say.
 *
 * The headline is not structured, but it is free and it is already stored, and
 * LinkedIn headlines fall into a small number of shapes:
 *
 *   "CEO at Laila Enterprise LLC (Self employed)"
 *   "Servant Leader | Owner of The Wynners Club | Business Broker"
 *   "Founder and Executive Director of International Ally Federation, CEO of …"
 *
 * and a great many that name no company at all:
 *
 *   "Photo-realistic Product Animation | 3D Modeling for Prototypes | …"
 *
 * That last kind is why this is deliberately reluctant. Guessing produces
 * "regarding your Photo-realistic Product Animation" in front of a stranger,
 * under a real rep's name — so when a reading is not clearly a company, this
 * returns nothing and the sentence changes instead (see `renderMerge`).
 */

export interface ParsedHeadline {
  title: string | null;
  company: string | null;
  /** What to call them when asking whether they are the right person. */
  role: "owner" | "manager" | null;
}

/** Words that mean the person runs the business rather than works in it. */
const OWNER_WORDS = [
  "founder",
  "co-founder",
  "cofounder",
  "owner",
  "ceo",
  "president",
  "principal",
  "proprietor",
  "partner",
  "chairman",
  "chairwoman",
  "managing director",
];

const MANAGER_WORDS = ["manager", "head of", "director", "lead", "supervisor", "chief"];

/** Endings that settle it: a thing ending in Ltd is a company. */
const LEGAL_SUFFIX =
  /\b(llc|l\.l\.c|inc|inc\.|ltd|ltd\.|limited|corp|corp\.|corporation|gmbh|bv|plc|pty|llp|co\.|company|group|holdings|partners|associates|agency|studio|studios|labs|foundation|federation|institute|society|club|chapter|chamber)\b/i;

/** Splits a headline into the segments a person actually separated it into. */
function segments(headline: string): string[] {
  return headline
    .split(/\s*[|•·]\s*|\s+[-–—]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Whether a phrase reads as the name of a company rather than as a description
 * of work.
 *
 * Two words is the floor because one word is where this goes wrong: "Director
 * of Photography" would otherwise yield a company called Photography, and
 * "regarding your Photography" is the kind of sentence that makes a rep look
 * like a robot. A single word is accepted only when it is unmistakable — a
 * legal suffix, or an internal capital, as in PathPilot.
 */
function looksLikeCompany(raw: string, joiner: "at" | "of" | "none"): boolean {
  const value = raw.trim();
  if (!value) return false;
  if (value.length > 60) return false;
  // A first character that is not a capital is a sentence fragment, not a name.
  if (!/^[A-Z0-9]/.test(value)) return false;

  // A "company" that still contains a join word is a phrase that was split in
  // the wrong place, not a name.
  if (/\s+(?:at|@|of|for)\s+/i.test(value)) return false;

  const words = value.split(/\s+/);
  if (words.length > 6) return false;
  if (words.length >= 2) return true;

  /*
   * "at" and "of" are not equally trustworthy, and the difference is the whole
   * accuracy of this function.
   *
   * "at X" means employed at X: "Community Manager at Datex" is Datex, and
   * refusing it because it is one word loses a real company for nothing. "of
   * X" is far weaker — "Director of Photography" is not employed by a company
   * called Photography — so there a single word has to prove itself with a
   * legal suffix, an acronym, or an internal capital.
   */
  if (joiner === "at") return true;
  return LEGAL_SUFFIX.test(value) || /[a-z][A-Z]/.test(value) || /^[A-Z0-9]{2,}$/.test(value);
}

/** Trims the things people append that are not part of the name. */
function cleanCompany(raw: string): string {
  return raw
    // "(Self employed)", "(Remote)"
    .replace(/\s*\([^)]*\)\s*$/, "")
    // A second role after a comma: "Acme, CEO of Other Thing".
    .split(/\s*,\s*/)[0]!
    .replace(/\s*[.;]$/, "")
    .trim();
}

function roleOf(title: string | null): "owner" | "manager" | null {
  if (!title) return null;
  const lower = title.toLowerCase();
  // Word boundaries, not substrings: "Servant Leader" contains "lead" and was
  // being reported as a manager, which would have had the opener ask the owner
  // of a business whether he was the manager of it.
  const has = (word: string) =>
    new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i").test(lower);
  if (OWNER_WORDS.some(has)) return "owner";
  if (MANAGER_WORDS.some(has)) return "manager";
  return null;
}

/**
 * Reads what it can, and says nothing about what it cannot.
 *
 * A title with no company is a useful answer on its own — it is what decides
 * whether the opener asks "are you the owner" or "are you the manager" — so the
 * two are returned independently rather than as all-or-nothing.
 */
export function parseHeadline(headline: string | null | undefined): ParsedHeadline {
  const text = headline?.trim();
  if (!text) return { title: null, company: null, role: null };

  let title: string | null = null;
  let company: string | null = null;

  for (const segment of segments(text)) {
    // " at " and " of " are how a headline joins a role to an employer; "@" is
    // the shorthand. Matched on the FIRST occurrence in the segment, because
    // "Head of Growth at Acme" means Acme and not Growth.
    /*
     * "at", "@" and "of" join a role to an employer. "for" does not — "3D
     * Models for E-commerce Listing" is a service, and reading it as a company
     * is the exact failure this file exists to avoid.
     *
     * Greedy on the left, so the split happens at the LAST join in the
     * segment: "Vice President of Membership at National Charity League" is a
     * Vice President of Membership, and reading it at the first join produced
     * a company called "Membership at National Charity League".
     */
    const joined = /^(.{2,60})\s+(at|@|of)\s+(.{2,80})$/i.exec(segment);
    if (!joined) {
      /*
       * A segment can be the employer on its own: "… | Owner & Certified Life
       * Coach | Perfect You LLC". Only accepted with a legal suffix, because
       * without one this would take any capitalised fragment — "Illustrator",
       * "Community Manager" — and call it a company.
       */
      if (!company && LEGAL_SUFFIX.test(segment) && looksLikeCompany(cleanCompany(segment), "none")) {
        company = cleanCompany(segment);
        continue;
      }
      // No employer named here, but the segment may still be a bare role —
      // "Servant Leader", "Business Broker" — which is what the opener needs
      // in order to address them correctly.
      if (!title && roleOf(segment)) title = segment;
      continue;
    }

    const left = joined[1]!.trim();
    const joiner = joined[2]!.toLowerCase() === "of" ? "of" : "at";
    const right = cleanCompany(joined[3]!);
    if (!company && looksLikeCompany(right, joiner)) {
      company = right;
      // The role attached to the employer wins over any bare self-description
      // seen earlier: "Servant Leader | Owner of The Wynners Club" is an owner.
      title = left;
      break;
    }
    if (!title) title = left;
  }

  return { title, company, role: roleOf(title) };
}
