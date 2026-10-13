/**
 * One price dataset for the AI SDR guides (/guides/ai-sdr-pricing,
 * /guides/best-ai-sdr-for-linkedin and /guides/ai-sdr-vs-human-sdr).
 *
 * The pages used to carry a table each, and the two tables disagreed: one
 * priced 11x by the month and the other by the year, one left out Valley and
 * the other AiSDR. A reader comparing the pages saw two answers to one
 * question. Every figure here was checked with a web search in October 2026,
 * and every one names where it came from, because a competitor's price is a
 * fact about one month.
 *
 * Only priced competitors live here. Nothing in this file prices Nora: Nora is
 * free while we grow, and the pages say so in words.
 */

export const PRICES_CHECKED = "October 2026";

export interface PriceSource {
  label: string;
  url: string;
}

export type ToolKind = "email-first" | "linkedin-first" | "sequencer" | "data";

export interface ToolPrice {
  name: string;
  kind: ToolKind;
  /** How the bill is counted. */
  model: string;
  /** The reported price, in words, as of PRICES_CHECKED. */
  price: string;
  /** Billing terms. */
  billing: string;
  /** Where it sends. */
  channel: string;
  /** The cheapest monthly figure in US dollars, for arithmetic; null when quote-only or not in dollars. */
  entryMonthly: number | null;
  sources: readonly PriceSource[];
}

const S = {
  elevenX: { label: "11x: Alice pricing page (checked October 2026)", url: "https://www.11x.ai/products/alice/pricing" },
  elevenXDocs: { label: "11x help center: pricing overview, no setup fees (checked October 2026)", url: "https://docs.11x.ai/help-center/overview/11x-pricing-overview" },
  artisan: { label: "Artisan: Ava 2.0 launch, self-serve from $250 a month (May 2026)", url: "https://www.artisan.co/blog/artisan-launches-ava-2-0-the-first-autonomous-ai-bdr-now-self-serve" },
  aisdr: { label: "AiSDR: pricing page (checked October 2026)", url: "https://aisdr.com/pricing/" },
  aisdrZoomInfo: { label: "ZoomInfo Pipeline: AiSDR pricing, verified May 2026", url: "https://pipeline.zoominfo.com/sales/aisdr-pricing" },
  amplemarket: { label: "Amplemarket: pricing breakdown for 2026 (Amplemarket's own blog)", url: "https://www.amplemarket.com/blog/amplemarket-pricing" },
  reply: { label: "Reply.io: Jason AI review and plan prices (Reply.io's own blog, 2026)", url: "https://reply.io/blog/jason-ai-review/" },
  salesforge: { label: "Salesforge: Agent Frank product and pricing (checked October 2026)", url: "https://www.salesforge.ai/agent/frank" },
  clay: { label: "Clay: pricing page (checked October 2026)", url: "https://www.clay.com/pricing" },
  clayFaq: { label: "Clay FAQ: what the new plans include (2026)", url: "https://www.clay.com/faq/what-features-are-included-in-the-new-plans-how-do-i-pick-the-right-plan" },
  valley: { label: "Valley: Valley AI pricing explained, 2026 (Valley's own blog)", url: "https://www.joinvalley.co/blog/valley-ai-pricing-explained-2026" },
  heyreach: { label: "HeyReach: pricing page (checked October 2026)", url: "https://www.heyreach.io/pricing" },
  expandi: { label: "Expandi: FAQ, price per account (checked October 2026)", url: "https://expandi.io/faq/" },
  waalaxy: { label: "Waalaxy: pricing page, in euros (checked October 2026)", url: "https://www.waalaxy.com/pricing" },
  dripify: { label: "Dripify: pricing page (checked October 2026)", url: "https://dripify.com/pricing/" },
} as const satisfies Record<string, PriceSource>;

export const TOOL_PRICES = {
  elevenX: {
    name: "11x (Alice)",
    kind: "email-first",
    model: "Annual contract",
    price: "Growth tier from $3,750 a month; Pro and Enterprise quoted",
    billing: "Billed annually, no setup fee",
    channel: "Email first, with other channels",
    entryMonthly: 3750,
    sources: [S.elevenX, S.elevenXDocs],
  },
  artisan: {
    name: "Artisan (Ava)",
    kind: "email-first",
    model: "Usage-based",
    price: "Self-serve from $250 a month since May 2026; larger volumes quoted",
    billing: "Monthly on the self-serve plan; Artisan says price depends on volume and team size",
    channel: "Email first, with LinkedIn steps",
    entryMonthly: 250,
    sources: [S.artisan],
  },
  aisdr: {
    name: "AiSDR",
    kind: "email-first",
    model: "Per plan, by leads a month",
    price: "From $250 a month (Solo); $900 (Explore) and $2,500 (Scale) for more leads",
    billing: "Quarterly, or 20% less billed annually",
    channel: "Email and LinkedIn",
    entryMonthly: 250,
    sources: [S.aisdr, S.aisdrZoomInfo],
  },
  amplemarket: {
    name: "Amplemarket",
    kind: "email-first",
    model: "Per plan with seats",
    price: "Startup plan about $600 a month for 2 users; Growth and Elite quoted",
    billing: "Annual term",
    channel: "Email, phone and LinkedIn",
    entryMonthly: 600,
    sources: [S.amplemarket],
  },
  reply: {
    name: "Reply.io (Jason AI SDR)",
    kind: "email-first",
    model: "By active contacts, not seats",
    price: "From $500 a month for 1,000 active contacts; $1,500 for 5,000",
    billing: "Monthly; higher tiers through sales",
    channel: "Email and LinkedIn, plus calls and other channels",
    entryMonthly: 500,
    sources: [S.reply],
  },
  salesforge: {
    name: "Salesforge (Agent Frank)",
    kind: "email-first",
    model: "By active contacts",
    price: "About $499 a month for 1,000 active contacts",
    billing: "Salesforge's own pages disagree on quarterly or annual terms",
    channel: "Email and LinkedIn",
    entryMonthly: 499,
    sources: [S.salesforge],
  },
  clay: {
    name: "Clay",
    kind: "data",
    model: "Credits, unlimited seats",
    price: "Free plan; Launch $185 and Growth $495 a month, less billed annually",
    billing: "Monthly or annual",
    channel: "None: it finds and enriches data for a sending tool",
    entryMonthly: 185,
    sources: [S.clay, S.clayFaq],
  },
  valley: {
    name: "Valley",
    kind: "linkedin-first",
    model: "Per seat",
    price: "$199 a seat a month, or $149 billed quarterly; higher tiers add email",
    billing: "Monthly or quarterly",
    channel: "LinkedIn first",
    entryMonthly: 149,
    sources: [S.valley],
  },
  heyreach: {
    name: "HeyReach",
    kind: "sequencer",
    model: "Per sender",
    price: "$79 per sender a month; flat agency plans from $999 a month",
    billing: "Monthly, cheaper on longer terms",
    channel: "LinkedIn",
    entryMonthly: 79,
    sources: [S.heyreach],
  },
  expandi: {
    name: "Expandi",
    kind: "sequencer",
    model: "Per LinkedIn account",
    price: "$99 per account a month, or $79 paid yearly",
    billing: "Monthly or annual",
    channel: "LinkedIn",
    entryMonthly: 79,
    sources: [S.expandi],
  },
  waalaxy: {
    name: "Waalaxy",
    kind: "sequencer",
    model: "Per user",
    price: "Free plan with a small quota; paid plans from €19 a user a month, priced in euros",
    billing: "Monthly, discounted quarterly or yearly",
    channel: "LinkedIn, with email on the top plan",
    entryMonthly: null,
    sources: [S.waalaxy],
  },
  dripify: {
    name: "Dripify",
    kind: "sequencer",
    model: "Per user",
    price: "$39 a month billed yearly, or $59 monthly, at entry",
    billing: "Monthly or annual; a trial, no free plan",
    channel: "LinkedIn",
    entryMonthly: 39,
    sources: [S.dripify],
  },
} as const satisfies Record<string, ToolPrice>;

export type ToolId = keyof typeof TOOL_PRICES;

/** Single plan figures the worked examples use, from the same sources as TOOL_PRICES. */
export const PLAN_FIGURES = {
  /** AiSDR's Explore plan, per month (aisdr.com/pricing). */
  aisdrExplore: 900,
} as const;

/** The sources behind a set of tools, each listed once, in the order given. */
export function priceSources(ids: readonly ToolId[]): PriceSource[] {
  const seen = new Set<string>();
  return ids
    .flatMap((id) => TOOL_PRICES[id].sources as readonly PriceSource[])
    .filter((source) => (seen.has(source.url) ? false : (seen.add(source.url), true)));
}

/*
 * The human-SDR arithmetic, from two primary sources and nothing else, so a
 * reader can redo it. Bridge Group 2025: median OTE $80K ($55K base, $25K
 * variable), 3.0 months to ramp, 1.9 years average tenure, 60% at quota. BLS
 * ECEC, June 2026: wages and salaries are 68.5% of compensation cost for
 * full-time private-industry workers.
 */
export const SDR = {
  ote: 80_000,
  base: 55_000,
  variable: 25_000,
  rampMonths: 3,
  tenureYears: 1.9,
  atQuotaPercent: 60,
  wageShareFullTime: 0.685,
} as const;

export const SDR_LOADED = Math.round(SDR.ote / SDR.wageShareFullTime / 1000) * 1000;
export const SDR_LOADED_MONTHLY = Math.round(SDR_LOADED / 12 / 100) * 100;
export const SDR_RAMP_COST = Math.round(((SDR_LOADED / 12) * SDR.rampMonths) / 1000) * 1000;
export const SDR_PRODUCTIVE_MONTHS = Math.round(SDR.tenureYears * 12 - SDR.rampMonths);

/** Outsourced SDR programs, as one provider (Revnew) publishes them. */
export const OUTSOURCED = { lowMonthly: 4_000, highMonthly: 18_000 } as const;

/** LinkedIn Sales Navigator Core, monthly billing, as reported in 2026. */
export const SALES_NAV_MONTHLY = 120;

export const HUMAN_SOURCES = {
  bridge: { label: "The Bridge Group: 2025 SDR models and metrics report", url: "https://www.bridgegroupinc.com/research/2025-sdr-models-metrics-report-the-bridge-group" },
  bls: { label: "US Bureau of Labor Statistics: employer compensation costs, June 2026", url: "https://www.bls.gov/opub/ted/2026/compensation-costs-for-private-industry-workers-averaged-46-89-per-hour-worked-in-june-2026.htm" },
  revnew: { label: "Revnew: SDR outsourcing cost (an outsourcing provider)", url: "https://revnew.com/blog/sdr-outsourcing-cost" },
  gigradar: { label: "GigRadar: outsourcing sales, retainers, setup fees and minimums", url: "https://gigradar.io/blog/outsource-sales" },
  salesNav: { label: "Valley: LinkedIn Sales Navigator cost explained, 2026", url: "https://www.joinvalley.co/blog/linkedin-sales-navigator-cost-explained-2026" },
} as const satisfies Record<string, PriceSource>;

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
