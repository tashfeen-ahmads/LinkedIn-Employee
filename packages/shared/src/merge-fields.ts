/**
 * The fields a message may be written from, and what happens when one is missing.
 *
 * Every prospect arrives from LinkedIn with a headline and a name, and a
 * campaign wants to say "Hi Kristina, Tashfeen here regarding The Wynners
 * Club". The naive version of that is string substitution, and the naive
 * version breaks in the one way that matters: a prospect whose company nobody
 * knows receives "Hi Desmond, Tashfeen here regarding your ." — under a real
 * rep's name, to a stranger, as the first thing they ever read.
 *
 * So a field is never substituted blindly. A template declares what to say when
 * the value is there and what to say instead when it is not, and the sentence
 * changes rather than emptying.
 */

/** The value of one field for one prospect, or null when we do not know it. */
export interface MergeValues {
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  location: string | null;
  /** The rep sending it. Always known: it is the account doing the sending. */
  rep_name: string | null;
}

export const MERGE_FIELDS = [
  "first_name",
  "last_name",
  "company",
  "title",
  "location",
  "rep_name",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

/**
 * What a person actually types, in every shape they type it.
 *
 * `{{company}}` is the documented form. `{company}`, `[Company]` and
 * `{{ company }}` are what people write anyway, and a placeholder that reaches
 * a prospect verbatim is worse than one we were relaxed about reading. The
 * first live campaign went out with `[Name]` in the copy for exactly this
 * reason.
 */
function patternFor(field: MergeField): RegExp {
  return new RegExp(`(\\{\\{|\\{|\\[)\\s*${field}\\s*(\\}\\}|\\}|\\])`, "gi");
}

/** `{{#company}}…{{/company}}` — kept only when the field has a value. */
function blockFor(field: MergeField): RegExp {
  return new RegExp(`\\{\\{#${field}\\}\\}([\\s\\S]*?)\\{\\{/${field}\\}\\}`, "gi");
}

/** `{{^company}}…{{/company}}` — kept only when it does not. */
function inverseBlockFor(field: MergeField): RegExp {
  return new RegExp(`\\{\\{\\^${field}\\}\\}([\\s\\S]*?)\\{\\{/${field}\\}\\}`, "gi");
}

/**
 * Renders a template against one prospect.
 *
 * Conditional blocks resolve first, so a sentence that depends on a missing
 * field is removed whole rather than left with a hole in it. Only then are the
 * surviving placeholders substituted.
 *
 * `first_name` is the one field with a fallback rather than a hole: after a
 * greeting it becomes "there", which is what a person writes when they cannot
 * see a name, and anywhere else it is left out with its comma (`withoutName`).
 */
export function renderMerge(template: string, values: Partial<MergeValues>): string {
  let out = template;

  for (const field of MERGE_FIELDS) {
    const value = values[field]?.trim() || null;
    out = out.replace(blockFor(field), value ? "$1" : "");
    out = out.replace(inverseBlockFor(field), value ? "" : "$1");
  }

  for (const field of MERGE_FIELDS) {
    const raw = values[field]?.trim() || null;
    if (raw === null) {
      /*
       * Left visible, exactly as rule 29 leaves `{{cta_link}}` visible.
       *
       * Substituting an empty string sends "regarding your ." to a stranger
       * under a real rep's name, which reads as a broken product; a visible
       * `{{company}}` is caught on the review screen instead, and
       * `missingFields` names it there. Copy that should degrade gracefully
       * says so with a conditional block.
       *
       * `first_name` is the exception, because a greeting without a name
       * is ordinary: "Hi there," after a greeting word, and the name simply
       * left out anywhere else ("Thanks for connecting."), never "there"
       * standing where a name was.
       */
      if (field === "first_name") out = withoutName(out);
      continue;
    }
    out = out.replace(patternFor(field), raw);
  }

  // Substitution leaves its own debris: a dropped block leaves a double space,
  // a removed clause leaves " ." or " ,". Reaching a prospect, each of those
  // reads as carelessness by the person whose name is on the message.
  return separateLinks(out.replace(/[ \t]{2,}/g, " "))
    // Never onto the end of a link: "…/abc ." closed up to "…/abc." puts the
    // full stop inside the address the prospect taps, and it 404s.
    .replace(/(\S*)\s+([.,!?;:])/g, (_m, before: string, punct: string) =>
      endsWithLink(before) ? `${before} ${punct}` : `${before}${punct}`,
    )
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A link, or a placeholder that becomes one at send time. `{{cta_link}}` is
 * substituted after this function runs, so a full stop glued to the
 * placeholder here is glued to the URL by the time it is sent.
 */
const LINK_TOKEN = String.raw`(?:https?:\/\/|www\.)[^\s]*?|\{\{\s*[a-z_]*(?:link|url)[a-z_]*\s*\}\}`;
const LINK_AT_END = new RegExp(`(?:${LINK_TOKEN.replace("[^\\s]*?", "\\S*")})$`, "i");

function endsWithLink(token: string): boolean {
  return LINK_AT_END.test(token);
}

/**
 * Punctuation after a link, kept off it.
 *
 * At the end of a line a full stop, comma, colon or semicolon after a link is
 * dropped: "Here it is: https://x.com/abc" reads as finished, and the stop
 * would otherwise be read as part of the address. Anywhere else, and for a
 * question or exclamation mark, it keeps a space between it and the link, so
 * nothing becomes part of the address and no two sentences are run together.
 */
function separateLinks(text: string): string {
  const pattern = new RegExp(`(${LINK_TOKEN})[ \\t]*([.,!?;:]+)(?=\\s|$)`, "gi");
  return text.replace(pattern, (match: string, link: string, punct: string, offset: number, whole: string) => {
    const rest = whole.slice(offset + match.length);
    if (/^[ \t]*(?:\n|$)/.test(rest) && /^[.,;:]+$/.test(punct)) return link;
    return `${link} ${punct}`;
  });
}

/**
 * A greeting with no name to put in it, written the way a person would.
 *
 * "Hi there," is what somebody writes when they cannot see a name. Everywhere
 * else "there" is a placeholder that leaked: "Thanks for connecting, there."
 * reads as a mail merge with a hole in it. So after a greeting word the name
 * becomes "there", and anywhere else the name is left out with the comma that
 * introduced it: "Thanks for connecting." A sentence that opened with the name
 * starts with the word after it, capitalised.
 */
function withoutName(text: string): string {
  const name = patternFor("first_name").source;
  return text
    .replace(new RegExp(`\\b(hi|hello|hey|hiya|howdy)([ \\t]+)${name}`, "gi"), "$1$2there")
    .replace(new RegExp(`\\bdear[ \\t]+${name}`, "gi"), "Hello")
    .replace(
      new RegExp(`(^|[.!?][ \\t]+|\\n[ \\t]*)${name}[ \\t]*[,:\\u2013\\u2014-]?[ \\t]*([a-z])?`, "gi"),
      (_m: string, lead: string, _open: string, _close: string, next: string | undefined) =>
        lead + (next ? next.toUpperCase() : ""),
    )
    .replace(new RegExp(`[ \\t]*,[ \\t]*${name}`, "gi"), "")
    .replace(new RegExp(`[ \\t]*${name}`, "gi"), "");
}

/**
 * The fields this template needs and this prospect does not have.
 *
 * Fields inside a conditional block do not count: declaring what to say when
 * the value is missing is the whole point, and reporting it as a gap would
 * train people to ignore the report.
 */
export function missingFields(template: string, values: Partial<MergeValues>): MergeField[] {
  let bare = template;
  for (const field of MERGE_FIELDS) {
    bare = bare.replace(blockFor(field), "").replace(inverseBlockFor(field), "");
  }
  return MERGE_FIELDS.filter(
    (field) => patternFor(field).test(bare) && !(values[field]?.trim()),
  );
}

/** Every field a template refers to, whether guarded or not. */
export function fieldsUsed(template: string): MergeField[] {
  return MERGE_FIELDS.filter(
    (field) =>
      patternFor(field).test(template) ||
      blockFor(field).test(template) ||
      inverseBlockFor(field).test(template),
  );
}
