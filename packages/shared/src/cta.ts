/**
 * What a campaign is actually asking for.
 *
 * "Book a meeting" was the only goal this product had, and it was wired in
 * everywhere: the copy asked for a call, the Reply Agent proposed slots, and
 * the funnel's last stage counted bookings. But most outreach is not asking for
 * a meeting. Somebody wants sign-ups, somebody wants their product looked at,
 * somebody wants a collaboration, somebody wants a reply and nothing more.
 *
 * A CTA is therefore a **goal**, not a link field. Bolting a URL onto a
 * meeting-shaped campaign would leave the copy asking for a call, the Reply
 * Agent offering times nobody wants, and the dashboard reporting zero meetings
 * for a campaign that did exactly what was asked of it.
 */
export type CtaKind = "meeting" | "link" | "reply";

export const CTA_KINDS: readonly CtaKind[] = ["meeting", "link", "reply"];

export interface CtaDefinition {
  kind: CtaKind;
  label: string;
  /** What the sequence is written to ask for. */
  asks: string;
  /** The last thing this product can honestly observe. */
  conversion: string;
  /** Whether a destination URL is required. */
  needsUrl: boolean;
}

export const CTA_DEFINITIONS: Record<CtaKind, CtaDefinition> = {
  meeting: {
    kind: "meeting",
    label: "Book a meeting",
    asks: "a short call, at a time this product offers and the prospect picks",
    conversion: "a meeting on the calendar",
    needsUrl: false,
  },
  link: {
    kind: "link",
    label: "Send them a link",
    asks: "a visit to one specific page — a sign-up, an offer, a product, a profile",
    // Deliberately not "a click". See `CLICKS_ARE_INVISIBLE`.
    conversion: "the link sent, and a positive reply if one comes",
    needsUrl: true,
  },
  reply: {
    kind: "reply",
    label: "Start a conversation",
    asks: "a reply — a collaboration, an introduction, an opinion",
    conversion: "a positive reply",
    needsUrl: false,
  },
};

/**
 * Why this product does not report clicks, said once so no screen implies it.
 *
 * Measuring them means wrapping the customer's URL in a redirect we own. That
 * breaks affiliate and tracking parameters on the Amazon and Shopify links
 * people actually send, and it puts an unfamiliar domain in a LinkedIn message
 * — which reads as spam to the recipient and to LinkedIn's own heuristics, on
 * an account this product exists to protect. The honest position is that the
 * link leaving is the last thing we can see, and to say so rather than show a
 * zero somebody reads as failure.
 */
export const CLICKS_ARE_INVISIBLE =
  "LinkedIn does not report clicks, and this product will not rewrite your link to count them — a redirect through another domain breaks tracking parameters and reads as spam. The last thing measurable here is the link being sent.";

/**
 * The placeholder the writer puts in a message, substituted at send time.
 *
 * The URL is not written into the copy, so changing where a campaign points
 * does not mean rewriting three messages and re-reviewing them — and a rep who
 * edits one message and forgets another does not end up with a campaign
 * sending two different destinations.
 */
export const CTA_PLACEHOLDER = "{{cta_link}}";

/**
 * A destination this product is willing to put in a message.
 *
 * Typed by a user and sent to a stranger under a real rep's name, so the shape
 * is checked rather than trusted. Only http and https: `javascript:` and
 * `data:` are not destinations, and every other scheme is either unsendable or
 * something the rep did not mean.
 *
 * Not an SSRF check — nothing here fetches the URL. The risk is a message that
 * embarrasses the rep or does not work.
 *
 * Parsed by hand rather than with `URL`, matching `normalizeLinkedInUrl` above
 * it: this package carries no environment lib on purpose, so that the same
 * rules run in the worker, in a server component and in the browser without
 * three copies of them.
 */
export function checkCtaUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "A link campaign needs a destination." };
  if (/\s/.test(trimmed)) return { ok: false, reason: "A web address cannot contain spaces." };

  const scheme = /^([a-z][a-z0-9+.\-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (!scheme) {
    return { ok: false, reason: "That is not a full web address. Include the https:// at the front." };
  }
  if (scheme !== "https" && scheme !== "http") {
    // `javascript:` and `data:` are not destinations, and every other scheme is
    // either unsendable or something the rep did not mean to paste.
    return { ok: false, reason: `${scheme}: is not a web address this can send.` };
  }

  const host = /^https?:\/\/([^/?#]+)/i.exec(trimmed)?.[1];
  if (!host) return { ok: false, reason: "That address has no domain name in it." };
  // `https://localhost/x` and `https://signup` parse as URLs and reach nobody.
  const bare = host.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  if (!/^[a-z0-9.\-]+\.[a-z]{2,}$/i.test(bare)) {
    return { ok: false, reason: "That address has no domain name in it." };
  }

  return { ok: true, url: trimmed };
}

/**
 * Whether this text carries a link, by any of the ways one gets in.
 *
 * Deterministic and not left to the model, for the same reason opt-outs are.
 * LinkedIn penalises links in connection requests and they measurably cut
 * acceptance, so "the prompt says not to" is not enough: the prompt said not to
 * and the check is what makes it true.
 */
export function containsLink(text: string): boolean {
  if (text.includes(CTA_PLACEHOLDER)) return true;
  return /\bhttps?:\/\/\S/i.test(text) || /\bwww\.\S+\.\S/i.test(text);
}

/**
 * Puts the destination into a message, or leaves the message alone.
 *
 * A campaign with no destination leaves the placeholder untouched rather than
 * substituting an empty string: a sentence ending "take a look here:" with
 * nothing after it is worse than a visible `{{cta_link}}`, because the first
 * reaches a prospect looking like a broken product and the second is caught on
 * the review screen.
 */
export function renderCta(message: string, url: string | null | undefined): string {
  if (!url?.trim()) return message;
  return message.split(CTA_PLACEHOLDER).join(url.trim());
}

/**
 * The last funnel stage worth counting for this goal.
 *
 * A link campaign has no meetings and never will, and a funnel that ends in a
 * permanent zero reports a working campaign as a failed one. The stage a
 * campaign is judged on has to be the thing it was asking for.
 */
export function finalStage(kind: CtaKind): "meetings" | "positive" {
  return kind === "meeting" ? "meetings" : "positive";
}
