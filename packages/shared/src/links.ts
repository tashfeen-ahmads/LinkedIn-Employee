/**
 * The agent never sends a link it was not given.
 *
 * This is rule 6's sibling. The model may not invent a datetime, for the same
 * reason it may not invent a URL: both reach a real person under a real rep's
 * name, and both are the kind of detail a language model produces fluently and
 * wrongly. `acme.com/demo` is exactly the shape of thing a model writes when a
 * reply needs a link and none was supplied — plausible, specific, and a 404
 * that the prospect reads as carelessness and the rep never sees.
 *
 * So the drafting prompt says which links exist, and this is what makes that
 * instruction true rather than hopeful.
 */

/**
 * The endings a bare address is recognised by.
 *
 * A list rather than "any letters after a dot", because prose is full of
 * things shaped like a domain with a path: "Node.js/React", "README.md/docs",
 * "v2.ts/x". Those are not links and holding a draft for them would teach
 * somebody to approve held drafts without reading them. A model inventing a
 * link writes it on one of these endings, because those are what links look
 * like. Any two-letter country code also counts — `acme.co.uk/demo`,
 * `acme.de/preise` — except the few that are far more often file extensions.
 */
const BARE_TLDS = new Set([
  "com", "net", "org", "io", "ai", "app", "dev", "co", "info", "biz", "me", "us", "uk", "ca", "au", "eu",
  "xyz", "tech", "site", "online", "store", "shop", "so", "ly", "gg", "to", "tv", "cc", "link", "page",
  "cloud", "agency", "studio", "design", "team", "digital", "solutions", "services",
  "consulting", "company", "global", "group", "pro", "world", "media",
  "news", "blog", "email", "space", "website", "inc", "ltd", "llc", "careers", "jobs", "health", "finance",
  "capital", "ventures", "partners", "events", "academy", "school", "education", "systems", "software",
]);
/** Two letters that are a country somewhere and a file extension everywhere. */
const NOT_A_COUNTRY = new Set(["js", "ts", "py", "md", "rb", "sh", "pl", "cs", "fs", "rs", "go", "db", "pm", "am"]);

function isBareTld(tld: string): boolean {
  const t = tld.toLowerCase();
  if (BARE_TLDS.has(t)) return true;
  return /^[a-z]{2}$/.test(t) && !NOT_A_COUNTRY.has(t);
}

const SCHEMED = /https?:\/\/[^\s<>()[\]{}"']+/gi;

/*
 * A bare address: `www.` plus a domain, or a domain with a path. Never a bare
 * domain alone ("acme.com" in a sentence is a company's name as often as it is
 * a link) and never an email address — the character before it may not be `@`,
 * a word character, a dot, or a slash, which also keeps it from matching the
 * inside of something longer.
 */
const BARE =
  /(?<![@\w.\/-])((?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,24}))(\/[^\s<>()[\]{}"']*)?/gi;

/**
 * Every address in a piece of text, written with a scheme or without one.
 *
 * Only http(s) used to count, so the shape a model actually invents —
 * `acme.com/demo`, `www.acme.com/pricing` — passed straight through the check
 * that exists to stop it (rule 30). A bare address is returned as written; the
 * comparison below reads it as https.
 */
export function extractLinks(text: string): string[] {
  const found: Array<{ at: number; link: string }> = [];
  // Trailing punctuation is part of the sentence, not of the address: a link at
  // the end of "have a look: https://acme.test/x." is not a different link.
  const trim = (raw: string) => raw.replace(/[.,;:!?]+$/, "");

  for (const match of text.matchAll(SCHEMED)) {
    found.push({ at: match.index ?? 0, link: trim(match[0]) });
  }
  // Blank out what was already found, so the inside of a schemed address is
  // not read a second time as a bare one.
  const rest = text.replace(SCHEMED, (m) => " ".repeat(m.length));
  for (const match of rest.matchAll(BARE)) {
    const host = match[1]!;
    const tld = match[2]!;
    const path = match[3] ?? "";
    const www = /^www\./i.test(host);
    // A domain alone is not enough; it needs `www.` or somewhere to go.
    if (!www && trim(path).replace(/\/+$/, "") === "") continue;
    if (!isBareTld(tld)) continue;
    found.push({ at: match.index ?? 0, link: trim(match[0]) });
  }

  return found.sort((a, b) => a.at - b.at).map((entry) => entry.link);
}

/**
 * Whether two addresses point at the same place.
 *
 * Host and path must match; query and fragment need not. A model that copies a
 * booking link and drops `?month=2026-09` has not invented anything — it has
 * dropped a parameter, and the link still works. A model that turns
 * `acme.test` into `acme.test/demo` has invented a page, and that is the case
 * this exists to catch, so the path is compared exactly. An address written
 * without a scheme is the same address as with one.
 */
export function sameDestination(a: string, b: string): boolean {
  const key = (raw: string): string | null => {
    const match = /^(?:https?:\/\/)?([^/?#\s]+)([^?#\s]*)/i.exec(raw.trim());
    if (!match) return null;
    const host = match[1]!.toLowerCase().replace(/^www\./, "");
    const path = (match[2] ?? "").replace(/\/+$/, "");
    return `${host}${path}`;
  };
  const left = key(a);
  const right = key(b);
  return left !== null && left === right;
}

/**
 * The links in this message that nobody handed the agent.
 *
 * Returns them rather than a boolean: a draft held back has to say which link
 * was wrong, or the person reviewing it re-reads three paragraphs looking for
 * the problem.
 */
export function unknownLinks(message: string, allowed: readonly string[]): string[] {
  const permitted = allowed.filter((link) => link?.trim());
  return extractLinks(message).filter(
    (link) => !permitted.some((candidate) => sameDestination(link, candidate)),
  );
}

/**
 * Whether a draft may be sent without a person reading it first.
 *
 * Held, never stripped. Removing the URL leaves "you can book a time here:"
 * pointing at nothing, which reaches the prospect looking worse than the
 * invented link did — and a hallucinated link is evidence the draft as a whole
 * drifted, not that one token was unlucky.
 */
export function draftLinkCheck(
  message: string,
  allowed: readonly string[],
): { ok: true } | { ok: false; reason: string; links: string[] } {
  const unknown = unknownLinks(message, allowed);
  if (unknown.length === 0) return { ok: true };
  return {
    ok: false,
    reason: `the draft contains ${unknown.length === 1 ? "a link" : "links"} nobody gave the agent: ${unknown.join(", ")}`,
    links: unknown,
  };
}
