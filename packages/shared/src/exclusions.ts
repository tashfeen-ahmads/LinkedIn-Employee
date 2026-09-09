/**
 * The shared exclusion list: accounts and people a workspace has decided are
 * off limits, whichever rep is prospecting.
 *
 * Matching is pure and deterministic for the same reason the opt-out check is:
 * "never contact this account" is a promise a colleague made to a customer, and
 * a model's opinion is not a good enough basis for keeping it.
 */

/** Canonical form used as the workspace-wide uniqueness key for a prospect. */
export function normalizeLinkedInUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^[a-z]{2,3}\./, "")
    .replace(/^www\./, "")
    .replace(/\?.*$/, "")
    .replace(/\/+$/, "");
}

export type ExclusionKind = "company" | "person";

export interface ExclusionRule {
  kind: ExclusionKind;
  /** Already normalized, as stored. */
  value: string;
  /** What the person typed, for showing them why something was skipped. */
  rawValue: string;
  reason?: string | null;
}

/**
 * Legal suffixes carry no identity: someone excluding "Acme" means Acme Inc.
 * too, and a rep who types the long form should not have to type both.
 */
const COMPANY_SUFFIXES = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "limited",
  "plc",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "ag",
  "bv",
  "nv",
  "sa",
  "sas",
  "srl",
  "spa",
  "ab",
  "as",
  "oy",
  "pty",
  "pte",
  "kk",
  "group",
  "holdings",
]);

/**
 * Company names are matched on this form, not on the raw string: "Acme Corp.",
 * "acme corporation" and "ACME, Inc." are one account to everyone except a
 * string comparison.
 */
export function normalizeCompany(name: string): string {
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  // Trailing suffixes only. "Group Nine" keeps its first word; "Nine Group"
  // loses its last.
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1]!)) words.pop();

  return words.join(" ");
}

export function normalizeExclusionValue(kind: ExclusionKind, raw: string): string {
  return kind === "person" ? normalizeLinkedInUrl(raw) : normalizeCompany(raw);
}

export interface ExclusionSubject {
  company?: string | null;
  linkedinUrl?: string | null;
}

/**
 * Returns the rule that bars this person, or null. Returning the rule rather
 * than a boolean is deliberate: every place that blocks a send records why, so
 * a rep looking at a skipped prospect sees "Acme — existing customer" instead
 * of an unexplained gap in their numbers.
 */
export function matchExclusion(
  rules: readonly ExclusionRule[],
  subject: ExclusionSubject,
): ExclusionRule | null {
  const company = subject.company ? normalizeCompany(subject.company) : null;
  const person = subject.linkedinUrl ? normalizeLinkedInUrl(subject.linkedinUrl) : null;

  for (const rule of rules) {
    if (rule.kind === "company" && company && rule.value === company) return rule;
    if (rule.kind === "person" && person && rule.value === person) return rule;
  }
  return null;
}

/** How a blocked send explains itself in the status line and the audit log. */
export function exclusionReason(rule: ExclusionRule): string {
  return rule.reason ? `excluded: ${rule.rawValue} — ${rule.reason}` : `excluded: ${rule.rawValue}`;
}
