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
 * `first_name` is the one field with a fallback rather than a hole: "there" is
 * what a person writes when they are addressing someone whose name they cannot
 * see, and it reads as ordinary rather than as a broken merge.
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
       * `first_name` is the exception, because "there" is what a person
       * actually writes when they cannot see a name, and it reads as ordinary
       * rather than as a merge that failed.
       */
      if (field === "first_name") out = out.replace(patternFor(field), "there");
      continue;
    }
    out = out.replace(patternFor(field), raw);
  }

  // Substitution leaves its own debris: a dropped block leaves a double space,
  // a removed clause leaves " ." or " ,". Reaching a prospect, each of those
  // reads as carelessness by the person whose name is on the message.
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
