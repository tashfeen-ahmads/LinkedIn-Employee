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

/**
 * Whether this is an address a person can actually open.
 *
 * Some profiles have no public URL — LinkedIn hides the vanity address outside
 * your network and shows those people as "LinkedIn Member". They are real, and
 * messageable through the provider by id, but there is nothing to link to.
 *
 * `providerId` matters and is not optional in practice. Rows written before
 * this existed hold `linkedin.com/in/<provider id>`, which is shaped exactly
 * like a real profile address and is a 404 every time. Checking the shape alone
 * passes every one of them, so the slug is compared against the id it would
 * have been built from: a URL whose last segment is the provider id was
 * fabricated, whatever it looks like.
 */
export function isPublicProfileUrl(url: string | null | undefined, providerId?: string | null): boolean {
  if (!url) return false;
  if (url.includes("/search/results/")) return false;
  const slug = /(?:^|\/)in\/([^/?#]+)/.exec(url)?.[1];
  if (!slug) return false;
  if (providerId && slug.toLowerCase() === providerId.toLowerCase()) return false;
  // LinkedIn's internal ids all begin this way and are never vanity slugs, so
  // a row whose provider id was lost still does not become a broken link.
  return !/^acoaa/i.test(slug);
}

/**
 * The address to put in an `href` for a prospect's profile.
 *
 * Every `linkedin_url` in this database is stored without a scheme
 * (`linkedin.com/in/someone`), because that is the shape LinkedIn's own search
 * returns. A bare string like that in an `href` is a **relative** URL, so the
 * browser resolves it against the current page and the rep lands on
 * `/app/linkedin.com/in/someone` — a 404 on our own domain, under a link that
 * looks exactly right until it is clicked.
 *
 * Four screens render that value and only two of them normalised it, so the
 * link worked on Prospects and on a campaign and was broken in the Inbox and on
 * Meetings — the two screens a rep opens when a real person has just replied.
 * One definition, for the same reason `isPublicProfileUrl` above is one: a rule
 * written out four times is a rule that is right three times.
 *
 * Returns null for a prospect with no address, so a caller renders plain text
 * rather than a link to nowhere (rule 13: a person whose profile we cannot open
 * is real, and must not be presented as clickable).
 */
export function profileHref(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return null;
  // Anything already absolute is left exactly as it is: rewriting a scheme
  // somebody stored on purpose is how http://localhost test data turns into a
  // live link.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A protocol-relative or accidentally-rooted value is still not ours.
  return `https://${trimmed.replace(/^\/+/, "")}`;
}
