/**
 * Every search-facing page beyond the core six, in one list.
 *
 * The sitemap, the hubs (/guides, /alternatives, /tools), the footer's
 * Resources column, llms.txt and each article's "Read next" all read from
 * here. A page that exists but is missing from this list is invisible to all
 * of them at once, which is the failure worth designing against: an article
 * nobody links to and no crawler is told about ranks for nothing.
 *
 * `updated` is written by hand when the page's content changes, for the same
 * reason as `PAGES` in site.ts: a sitemap that claims every page changed on
 * every deploy teaches crawlers to ignore it.
 */
export type ContentKind = "guide" | "alternative" | "tool" | "audience" | "landing";

export interface ContentPage {
  path: string;
  kind: ContentKind;
  /** The <title> and the H1. Written for the query, then for the reader. */
  title: string;
  /** The meta description and the hub card text. 150 characters or so. */
  description: string;
  /** The search phrase the page is built around, for whoever edits it next. */
  query: string;
  published: string;
  updated: string;
  /** Paths of the pages this one should send readers to next. */
  related: readonly string[];
  /**
   * Which of Nora's four teammates the subject belongs to (lib/team.ts):
   * strategy and choosing tools to Sage, finding people to Scout, writing to
   * Quinn, sending, limits, replies and meetings to Reese. Shown as the
   * article's byline and colour; the structured-data author stays the
   * organisation, because a teammate is a part of the product, not a person.
   */
  owner: TeamKey;
}

export type TeamKey = "sage" | "scout" | "quinn" | "reese";

const D = "2026-10-12";

export const CONTENT: readonly ContentPage[] = [
  {
    path: "/guides/best-ai-sdr-for-linkedin",
    kind: "guide",
    title: "Best AI SDR tools for LinkedIn in 2026: how to choose",
    description: "The best AI SDR tools for LinkedIn compared honestly: what an AI SDR should do, seven safety questions to ask, dated prices, and who each tool suits.",
    query: "best ai sdr tools",
    published: D,
    updated: D,
    related: ["/guides/safest-linkedin-automation-tool", "/guides/ai-sdr-pricing", "/guides/ai-sdr-vs-human-sdr", "/guides/cloud-vs-browser-extension-linkedin-automation"],
    owner: "sage",
  },
  {
    path: "/guides/linkedin-account-restricted",
    kind: "guide",
    title: "LinkedIn account restricted? How to fix it and restart",
    description: "Restricted on LinkedIn? Identify the notice you got, what to do in the first 48 hours, how long each type lasts, and how to restart at a safe pace.",
    query: "linkedin account restricted",
    published: D,
    updated: D,
    related: ["/guides/is-linkedin-automation-safe", "/guides/linkedin-warm-up-schedule", "/guides/linkedin-weekly-invitation-limit", "/guides/withdraw-pending-linkedin-invitations"],
    owner: "reese",
  },
  {
    path: "/guides/book-meetings-from-linkedin",
    kind: "guide",
    title: "How to book meetings from LinkedIn: reply to calendar",
    description: "Turn a LinkedIn reply into a booked meeting: when to ask, offering real times instead of 'a quick call', where a booking link belongs, and handling a no.",
    query: "how to book meetings from linkedin",
    published: D,
    updated: D,
    related: ["/guides/linkedin-follow-up-after-connection", "/guides/linkedin-follow-up-sequence", "/how-it-works", "/guides/linkedin-connection-request-templates"],
    owner: "reese",
  },
  {
    path: "/guides/linkedin-follow-up-after-connection",
    kind: "guide",
    title: "Follow-up message after a LinkedIn connection is accepted",
    description: "What to send after someone accepts your LinkedIn request: within the hour, no pitch, continuing the thread your note started. With examples.",
    query: "follow up message after linkedin connection accepted",
    published: D,
    updated: D,
    related: ["/guides/book-meetings-from-linkedin", "/guides/linkedin-follow-up-sequence", "/guides/linkedin-connection-request-templates", "/how-it-works"],
    owner: "quinn",
  },
  {
    path: "/guides/linkedin-prospecting",
    kind: "guide",
    title: "LinkedIn prospecting in 2026: a safe step-by-step system",
    description: "LinkedIn prospecting step by step: define who buys, search on your tier, check every profile, write one note per person, pace sends, never contact twice.",
    query: "linkedin prospecting",
    published: D,
    updated: D,
    related: ["/guides/ideal-customer-profile-for-linkedin", "/guides/linkedin-prospecting-without-sales-navigator", "/guides/linkedin-connection-request-templates", "/linkedin-automation-limits"],
    owner: "scout",
  },
  {
    path: "/guides/ideal-customer-profile-for-linkedin",
    kind: "guide",
    title: "Ideal customer profile for LinkedIn outreach (+ template)",
    description: "Build an ideal customer profile for LinkedIn that finds buyers, not competitors: the two fields most templates miss, and how to turn it into a search.",
    query: "ideal customer profile for linkedin outreach",
    published: D,
    updated: D,
    related: ["/guides/linkedin-prospecting", "/guides/linkedin-prospecting-without-sales-navigator", "/guides/linkedin-acceptance-rate", "/how-it-works"],
    owner: "sage",
  },
  {
    path: "/guides/linkedin-prospecting-without-sales-navigator",
    kind: "guide",
    title: "LinkedIn prospecting without Sales Navigator: what you lose",
    description: "Free LinkedIn search vs Sales Navigator: the filters you lose, the commercial use limit, boolean traps that return nobody, and when the seat is worth it.",
    query: "linkedin prospecting without sales navigator",
    published: D,
    updated: D,
    related: ["/guides/linkedin-prospecting", "/guides/ideal-customer-profile-for-linkedin", "/linkedin-automation-limits", "/guides/linkedin-weekly-invitation-limit"],
    owner: "scout",
  },
  {
    path: "/guides/linkedin-connection-note-character-limit",
    kind: "guide",
    title: "LinkedIn connection note character limit: 200 or 300?",
    description: "Is the LinkedIn connection note limit 200 or 300 characters? Why sources disagree, what happens when you go over, and why staying under 200 is safest.",
    query: "linkedin connection note character limit",
    published: D,
    updated: D,
    related: ["/tools/connection-note-checker", "/guides/linkedin-connection-request-templates", "/guides/should-you-add-a-note-linkedin", "/linkedin-automation-limits"],
    owner: "quinn",
  },
  {
    path: "/guides/safest-linkedin-automation-tool",
    kind: "guide",
    title: "Safest LinkedIn automation tool: 8 checks before you pick",
    description: "Every 'safest tool' list ranks its author first. Eight checks you can run on any LinkedIn automation tool, and a table of what each one publishes.",
    query: "safest linkedin automation tool",
    published: D,
    updated: D,
    related: ["/guides/is-linkedin-automation-safe", "/guides/cloud-vs-browser-extension-linkedin-automation", "/linkedin-automation-limits", "/alternatives"],
    owner: "sage",
  },
  {
    path: "/guides/best-time-to-send-linkedin-connection-requests",
    kind: "guide",
    title: "Best time to send LinkedIn connection requests, and pace",
    description: "The best time to send LinkedIn connection requests is spread across their working day, not one slot. How to pace a day's allowance and set delays.",
    query: "best time to send linkedin connection requests",
    published: D,
    updated: D,
    related: ["/guides/is-linkedin-automation-safe", "/linkedin-automation-limits", "/guides/linkedin-warm-up-schedule", "/how-it-works"],
    owner: "reese",
  },
  {
    path: "/guides/ai-sdr-pricing",
    kind: "guide",
    title: "AI SDR pricing in 2026 vs the cost of hiring an SDR",
    description: "What AI SDRs cost in 2026 with dated sources, what a human or outsourced SDR really costs, the hidden costs both carry, and a free option.",
    query: "ai sdr pricing",
    published: D,
    updated: D,
    related: ["/pricing", "/guides/ai-sdr-vs-human-sdr", "/alternatives/artisan", "/guides/best-ai-sdr-for-linkedin"],
    owner: "sage",
  },
  {
    path: "/guides/withdraw-pending-linkedin-invitations",
    kind: "guide",
    title: "Withdraw pending LinkedIn invitations: when and why",
    description: "When to withdraw pending LinkedIn invitations, what it does not do to your weekly limit, the three-week resend lockout, and a safe housekeeping rule.",
    query: "withdraw pending linkedin invitations",
    published: D,
    updated: D,
    related: ["/guides/linkedin-weekly-invitation-limit", "/linkedin-automation-limits", "/guides/linkedin-account-restricted", "/guides/linkedin-acceptance-rate"],
    owner: "reese",
  },
  {
    path: "/guides/should-you-add-a-note-linkedin",
    kind: "guide",
    title: "Should you add a note to a LinkedIn connection request?",
    description: "A specific note beats no note, and no note beats a generic one. When to add a note to a LinkedIn connection request, and mistakes that cost acceptances.",
    query: "should i add a note to linkedin connection request",
    published: D,
    updated: D,
    related: ["/guides/linkedin-connection-request-templates", "/guides/linkedin-connection-note-character-limit", "/guides/linkedin-acceptance-rate", "/tools/connection-note-checker"],
    owner: "quinn",
  },
  {
    path: "/guides/ai-personalized-linkedin-messages",
    kind: "guide",
    title: "AI personalized LinkedIn messages you can actually check",
    description: "How AI can write each LinkedIn note from the person's own profile, how to check it is personal and not a template, and the guardrails that keep it safe.",
    query: "ai personalized linkedin messages",
    published: D,
    updated: D,
    related: ["/guides/linkedin-connection-request-templates", "/guides/linkedin-acceptance-rate", "/how-it-works", "/tools/connection-note-checker"],
    owner: "quinn",
  },
  {
    path: "/guides/linkedin-acceptance-rate",
    kind: "guide",
    title: "LinkedIn connection acceptance rate: benchmarks and fixes",
    description: "What a good LinkedIn acceptance rate is, how to read yours on small numbers, why a low rate is also a restriction risk, and how to test angles properly.",
    query: "linkedin connection acceptance rate",
    published: D,
    updated: D,
    related: ["/guides/linkedin-connection-request-templates", "/guides/ideal-customer-profile-for-linkedin", "/linkedin-automation-limits", "/guides/is-linkedin-automation-safe"],
    owner: "quinn",
  },
  {
    path: "/guides/linkedin-follow-up-sequence",
    kind: "guide",
    title: "LinkedIn follow-up sequence: timing, count, when to stop",
    description: "A LinkedIn follow-up sequence that reads as a conversation: how long to wait, how many follow-ups, when to stop, and why a second campaign backfires.",
    query: "linkedin follow up sequence",
    published: D,
    updated: D,
    related: ["/guides/book-meetings-from-linkedin", "/guides/linkedin-follow-up-after-connection", "/guides/is-linkedin-automation-legal", "/how-it-works"],
    owner: "quinn",
  },
  {
    path: "/guides/is-linkedin-automation-legal",
    kind: "guide",
    title: "Is LinkedIn automation illegal? Terms, law and GDPR",
    description: "Illegal, or only against the terms? What LinkedIn's section 8.2 says, what hiQ v LinkedIn decided, and how GDPR applies to B2B outreach. Not legal advice.",
    query: "is linkedin automation illegal",
    published: D,
    updated: D,
    related: ["/guides/is-linkedin-automation-safe", "/security", "/guides/linkedin-follow-up-sequence", "/how-it-works"],
    owner: "reese",
  },
  {
    path: "/guides/ai-sdr-vs-human-sdr",
    kind: "guide",
    title: "AI SDR vs human SDR vs agency: an honest comparison",
    description: "AI SDR, human SDR or outsourced agency? Cost, ramp time, quality and risk compared, and why the best setup keeps a human approving the work.",
    query: "ai sdr vs human sdr",
    published: D,
    updated: D,
    related: ["/guides/ai-sdr-pricing", "/guides/best-ai-sdr-for-linkedin", "/how-it-works", "/for/small-business"],
    owner: "sage",
  },
  {
    path: "/guides/is-linkedin-automation-safe",
    kind: "guide",
    title: "Is LinkedIn automation safe? What gets accounts restricted",
    description: "No tool is risk-free and LinkedIn's terms prohibit automation. What LinkedIn can see, which patterns get accounts restricted, and what keeps one working.",
    query: "is linkedin automation safe",
    published: D,
    updated: D,
    related: ["/linkedin-automation-limits", "/guides/linkedin-account-restricted", "/guides/cloud-vs-browser-extension-linkedin-automation", "/guides/is-linkedin-automation-legal"],
    owner: "reese",
  },
  {
    path: "/guides/linkedin-weekly-invitation-limit",
    kind: "guide",
    title: "LinkedIn weekly invitation limit in 2026: reset and recovery",
    description: "How LinkedIn's weekly invitation limit works, when it resets, what to do when you hit it, and why bypass tricks put the account at more risk.",
    query: "linkedin weekly invitation limit",
    published: D,
    updated: D,
    related: ["/linkedin-automation-limits", "/tools/linkedin-limit-calculator", "/guides/linkedin-warm-up-schedule", "/guides/withdraw-pending-linkedin-invitations"],
    owner: "reese",
  },
  {
    path: "/guides/linkedin-warm-up-schedule",
    kind: "guide",
    title: "How to warm up a LinkedIn account: week-by-week schedule",
    description: "A week-by-week warm-up schedule for a new or quiet LinkedIn account, from 10 invitations a day, and why the ramp starts at your first send.",
    query: "how to warm up linkedin account",
    published: D,
    updated: D,
    related: ["/tools/linkedin-limit-calculator", "/guides/linkedin-weekly-invitation-limit", "/guides/is-linkedin-automation-safe", "/linkedin-automation-limits"],
    owner: "reese",
  },
  {
    path: "/guides/linkedin-connection-request-templates",
    kind: "guide",
    title: "LinkedIn connection request templates under 200 characters",
    description: "LinkedIn connection request templates by situation, each under 200 characters, annotated with the detail it uses, and the rules that get a note accepted.",
    query: "linkedin connection request templates",
    published: D,
    updated: D,
    related: ["/tools/connection-note-checker", "/guides/linkedin-connection-note-character-limit", "/guides/should-you-add-a-note-linkedin", "/guides/ai-personalized-linkedin-messages"],
    owner: "quinn",
  },
  {
    path: "/guides/cloud-vs-browser-extension-linkedin-automation",
    kind: "guide",
    title: "Cloud vs Chrome extension LinkedIn automation: safer?",
    description: "How cloud and Chrome-extension LinkedIn tools differ in detection risk, reliability and control, and why pacing and caps matter more than either.",
    query: "cloud vs chrome extension linkedin automation",
    published: D,
    updated: D,
    related: ["/guides/is-linkedin-automation-safe", "/guides/safest-linkedin-automation-tool", "/guides/best-ai-sdr-for-linkedin", "/security"],
    owner: "sage",
  },
  {
    path: "/guides/linkedin-automation-tool-bans",
    kind: "guide",
    title: "HeyReach ban and LinkedIn's 2026 automation crackdown",
    description: "What is verified about LinkedIn's March 2026 action against HeyReach, what is not, the Apollo and Seamless precedent, and what it means for your account.",
    query: "heyreach ban",
    published: D,
    updated: D,
    related: ["/guides/is-linkedin-automation-safe", "/alternatives/heyreach", "/guides/cloud-vs-browser-extension-linkedin-automation", "/linkedin-automation-limits"],
    owner: "reese",
  },
  {
    path: "/alternatives/artisan",
    kind: "alternative",
    title: "Artisan AI alternatives: a free AI SDR for LinkedIn",
    description: "Artisan and 11x are email-first AI SDRs on contracts. If your buyers answer on LinkedIn, here is a free, human-approved alternative and how it compares.",
    query: "artisan ai alternatives",
    published: D,
    updated: D,
    related: ["/alternatives", "/guides/ai-sdr-pricing", "/guides/best-ai-sdr-for-linkedin", "/pricing"],
    owner: "sage",
  },
  {
    path: "/alternatives/phantombuster",
    kind: "alternative",
    title: "PhantomBuster alternatives for safe LinkedIn outreach",
    description: "PhantomBuster is built for scraping and workflows. If you need safe LinkedIn outreach with personal notes and booked meetings, see how Nora compares.",
    query: "phantombuster alternatives",
    published: D,
    updated: D,
    related: ["/alternatives", "/guides/is-linkedin-automation-legal", "/guides/cloud-vs-browser-extension-linkedin-automation", "/how-it-works"],
    owner: "sage",
  },
  {
    path: "/alternatives/heyreach",
    kind: "alternative",
    title: "HeyReach alternatives: a safer pick for a single rep",
    description: "HeyReach suits agencies running many senders. If you are one rep who wants personal notes, human approval and published caps, here is how Nora compares.",
    query: "heyreach alternatives",
    published: D,
    updated: D,
    related: ["/guides/linkedin-automation-tool-bans", "/alternatives", "/linkedin-automation-limits", "/for/agencies"],
    owner: "sage",
  },
  {
    path: "/alternatives/waalaxy",
    kind: "alternative",
    title: "Waalaxy alternatives: free, with a note for every person",
    description: "Nora vs Waalaxy: free use, a note written for each person instead of a template, reply handling and meeting booking, and how each tool paces sending.",
    query: "waalaxy alternatives",
    published: D,
    updated: D,
    related: ["/free-linkedin-automation-tool", "/alternatives", "/guides/linkedin-connection-request-templates", "/guides/cloud-vs-browser-extension-linkedin-automation"],
    owner: "sage",
  },
  {
    path: "/alternatives/expandi",
    kind: "alternative",
    title: "Expandi alternatives: an AI SDR that writes and books",
    description: "Comparing Nora with Expandi: who each suits, how limits and warm-up work, and where an AI SDR that answers replies and books meetings changes the job.",
    query: "expandi alternatives",
    published: D,
    updated: D,
    related: ["/alternatives", "/guides/linkedin-warm-up-schedule", "/how-it-works", "/guides/linkedin-weekly-invitation-limit"],
    owner: "sage",
  },
  {
    path: "/alternatives/dripify",
    kind: "alternative",
    title: "Dripify alternatives: personal notes and human approval",
    description: "Comparing Nora with Dripify: template sequences versus an AI SDR, how each handles limits, and what you approve before anything reaches a real person.",
    query: "dripify alternatives",
    published: D,
    updated: D,
    related: ["/alternatives", "/guides/best-ai-sdr-for-linkedin", "/pricing", "/guides/ai-personalized-linkedin-messages"],
    owner: "sage",
  },
  {
    path: "/tools/connection-note-checker",
    kind: "tool",
    title: "LinkedIn connection note checker: length, links and pitch",
    description: "Paste a LinkedIn connection note and check it against the character limit, links and the pitch patterns that get invitations ignored. Free, nothing stored.",
    query: "linkedin connection note checker",
    published: D,
    updated: D,
    related: ["/guides/linkedin-connection-request-templates", "/guides/linkedin-connection-note-character-limit", "/tools/linkedin-limit-calculator", "/tools"],
    owner: "quinn",
  },
  {
    path: "/tools/linkedin-limit-calculator",
    kind: "tool",
    title: "LinkedIn connection limit calculator: safe daily and weekly",
    description: "Work out how many connection requests your LinkedIn account can safely send today and this week, from how long it has been sending. Free, nothing stored.",
    query: "linkedin connection limit calculator",
    published: D,
    updated: D,
    related: ["/guides/linkedin-weekly-invitation-limit", "/guides/linkedin-warm-up-schedule", "/linkedin-automation-limits", "/tools"],
    owner: "reese",
  },
  {
    path: "/for/small-business",
    kind: "audience",
    title: "LinkedIn lead generation for small business, no sales team",
    description: "LinkedIn lead generation with no sales team: find buyers, send each a personal note and book calls with a free AI SDR that stays inside safe limits.",
    query: "linkedin lead generation for small business",
    published: D,
    updated: D,
    related: ["/free-linkedin-automation-tool", "/how-it-works", "/guides/ai-sdr-vs-human-sdr", "/guides/linkedin-prospecting-without-sales-navigator"],
    owner: "scout",
  },
  {
    path: "/for/agencies",
    kind: "audience",
    title: "LinkedIn lead generation for agencies, without the risk",
    description: "How agencies win clients on LinkedIn with an AI SDR: personal notes, human approval, and caps that protect the founder's account doing the sending.",
    query: "linkedin lead generation for agencies",
    published: D,
    updated: D,
    related: ["/how-it-works", "/guides/is-linkedin-automation-safe", "/alternatives/heyreach", "/guides/linkedin-prospecting"],
    owner: "scout",
  },
  {
    path: "/for/consultants",
    kind: "audience",
    title: "LinkedIn lead generation for consultants and coaches",
    description: "Find the clients who have the problem you solve, write each a note in your voice, and book calls from LinkedIn at a pace that keeps your profile safe.",
    query: "linkedin lead generation for consultants",
    published: D,
    updated: D,
    related: ["/how-it-works", "/guides/linkedin-connection-request-templates", "/free-linkedin-automation-tool", "/guides/book-meetings-from-linkedin"],
    owner: "scout",
  },
  {
    path: "/for/b2b-saas",
    kind: "audience",
    title: "LinkedIn outreach for SaaS founders: founder-led outbound",
    description: "Founder-led outbound on LinkedIn without a sales hire: customer profiles from your website, one note per buyer, replies answered and demos booked.",
    query: "linkedin outreach for saas founders",
    published: D,
    updated: D,
    related: ["/guides/best-ai-sdr-for-linkedin", "/how-it-works", "/guides/ideal-customer-profile-for-linkedin", "/guides/ai-sdr-vs-human-sdr"],
    owner: "scout",
  },
  {
    path: "/for/professional-services",
    kind: "audience",
    title: "LinkedIn lead generation for professional services firms",
    description: "For accountants, financial advisers and IT providers: reach decision makers on LinkedIn personally, with approval before send and no repeat contact.",
    query: "linkedin lead generation for professional services",
    published: D,
    updated: D,
    related: ["/how-it-works", "/security", "/guides/is-linkedin-automation-safe", "/guides/is-linkedin-automation-legal"],
    owner: "scout",
  },
  {
    path: "/free-linkedin-automation-tool",
    kind: "landing",
    title: "Free LinkedIn automation tool: an AI SDR, free for now",
    description: "Nora is free while it grows: it finds buyers, writes each a personal note, follows up and books meetings on LinkedIn inside safe limits. No card needed.",
    query: "free linkedin automation tool",
    published: D,
    updated: D,
    related: ["/pricing", "/alternatives/waalaxy", "/how-it-works", "/linkedin-automation-limits"],
    owner: "sage",
  },
] as const;

/** The hub pages, which list the content above by kind. */
export const HUBS = [
  { path: "/guides", kind: "guide", title: "LinkedIn outreach guides: limits, notes and prospecting", description: "Guides to LinkedIn outreach, from the rules Nora enforces: limits and safety, connection notes, follow-ups, prospecting and choosing a tool." },
  { path: "/alternatives", kind: "alternative", title: "LinkedIn automation tools compared on safety and price", description: "LinkedIn automation tools compared on what they publish about caps, warm-up, pacing and do-not-contact rules, with dated prices. Who each tool suits." },
  { path: "/tools", kind: "tool", title: "Free LinkedIn outreach tools: limits and note checker", description: "Free calculators and checkers built on the same rules Nora runs: a safe connection-limit calculator and a connection note checker. Nothing stored." },
] as const satisfies ReadonlyArray<{ path: string; kind: ContentKind; title: string; description: string }>;

export function contentOfKind(kind: ContentKind): ContentPage[] {
  return CONTENT.filter((page) => page.kind === kind);
}

export function contentAt(path: string): ContentPage {
  const page = CONTENT.find((p) => p.path === path);
  if (!page) throw new Error(`${path} is not in CONTENT; add it before building the page`);
  return page;
}

/** Title and description for any path the site links to, for "Read next" cards. */
export function linkCard(path: string): { path: string; title: string; description: string } | null {
  const page = CONTENT.find((p) => p.path === path) ?? HUBS.find((h) => h.path === path);
  if (page) return { path: page.path, title: page.title, description: page.description };
  const core: Record<string, { title: string; description: string }> = {
    "/how-it-works": { title: "How an AI SDR for LinkedIn works", description: "Three decisions are yours. The rest runs on its own, inside your limits." },
    "/linkedin-automation-limits": { title: "LinkedIn connection request limits in 2026", description: "Daily and weekly limits, acceptance rate, and the signs before a restriction." },
    "/pricing": { title: "Pricing", description: "Free for everyone while we grow. No card." },
    "/security": { title: "Security and data", description: "Where your data sits and who can reach it." },
  };
  return core[path] ? { path, ...core[path] } : null;
}
