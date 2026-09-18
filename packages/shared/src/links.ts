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

/** Every http(s) address in a piece of text. */
export function extractLinks(text: string): string[] {
  // Trailing punctuation is part of the sentence, not of the address: a link at
  // the end of "have a look: https://acme.test/x." is not a different link.
  const matches = text.match(/https?:\/\/[^\s<>()[\]{}"']+/gi) ?? [];
  return matches.map((raw) => raw.replace(/[.,;:!?]+$/, ""));
}

/**
 * Whether two addresses point at the same place.
 *
 * Host and path must match; query and fragment need not. A model that copies a
 * booking link and drops `?month=2026-09` has not invented anything — it has
 * dropped a parameter, and the link still works. A model that turns
 * `acme.test` into `acme.test/demo` has invented a page, and that is the case
 * this exists to catch, so the path is compared exactly.
 */
export function sameDestination(a: string, b: string): boolean {
  const key = (raw: string): string | null => {
    const match = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(raw.trim());
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
