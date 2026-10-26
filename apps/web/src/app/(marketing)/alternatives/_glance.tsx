import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { CompareTable, type Source } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";

/**
 * Nora's column, worded once for all six comparison tables, so "replies" never
 * means one thing on one page and another on the next. Replies are drafts a
 * person approves by default; autopilot is a choice a workspace makes.
 */
export const NORA = {
  whatItIs: "An AI SDR for LinkedIn that you approve",
  prospects: "The agent, from a customer profile you approved",
  notesShort: "One written for each person from their own profile",
  notes: `Written for each person from their profile, up to ${INVITE_NOTE_MAX_CHARS} characters, never with a link`,
  approval: "Strategy, copy and launch, each approved by a person",
  daily: `${PUBLIC_LIMITS.invitesPerDayStart} rising to ${PUBLIC_LIMITS.invitesPerDayMax} from the first send; can only be lowered`,
  weekly: `${PUBLIC_LIMITS.invitesPerWeek}, across all campaigns on the account`,
  warmup: `Always on, about ${PUBLIC_LIMITS.warmupWeeks} weeks from the first send`,
  twice: "Always on, checked before each send",
  repliesShort: "Drafted from your documents; you approve each, or switch on autopilot",
  replies: "Drafted from your documents for you to approve; with autopilot on, clean replies go out on their own",
  booking: "Times from the availability you set, or your own scheduling link",
  email: "No, LinkedIn only",
  price: "14-day free trial, no card, then see pricing",
} as const;

/** What a competitor cell says when its documentation is silent. */
export const NOT_DOCUMENTED = "Not documented; ask the vendor";

/**
 * "Alternatives at a glance": one table of several tools, shared by every
 * comparison page so a figure corrected here is corrected on all six.
 *
 * Every competitor fact below comes from a source listed in GLANCE_SOURCES and
 * was checked in October 2026. Anything we could not find says "Not published"
 * rather than guessing. Nora's caps are imported, never retyped.
 */

export type GlanceTool =
  | "nora"
  | "heyreach"
  | "waalaxy"
  | "expandi"
  | "dripify"
  | "phantombuster"
  | "artisan"
  | "elevenx"
  | "aisdr";

interface GlanceRow {
  name: string;
  bestFor: string;
  price: string;
  free: string;
  caps: string;
  sources: readonly Source[];
}

const SRC = {
  heyreachPrice: { label: "Overloop: HeyReach review 2026, pricing and tiers (a competitor, which it discloses)", url: "https://overloop.com/blog/heyreach-review" },
  heyreachPlans: { label: "HeyReach help center: plans and pricing, including the free trial", url: "https://help.heyreach.io/en/articles/14741630-heyreach-plans-and-pricing-what-s-included-and-how-to-choose" },
  heyreachTrial: { label: "Valley: HeyReach pricing explained 2026, trial length (a vendor in the same market)", url: "https://www.joinvalley.co/blog/heyreach-pricing-explained-2026" },
  heyreachLimits: { label: "HeyReach help center: how connection request limits work (checked October 2026)", url: "https://help.heyreach.io/en/articles/15128619-how-do-connection-request-limits-work-in-heyreach" },
  waalaxyPrice: { label: "Supered: Waalaxy pricing 2026, reviewed October 2, 2026", url: "https://www.supered.io/blog/waalaxy-pricing/" },
  waalaxyCloud: { label: "Waalaxy help center: Waalaxy is now fully cloud-based (checked October 2026)", url: "https://intercom.help/waalaxy/en/articles/15587366-waalaxy-is-now-fully-cloud-based" },
  waalaxyLimits: { label: "Waalaxy blog: LinkedIn maximum connections per day", url: "https://blog.waalaxy.com/en/what-is-the-linkedin-maximum-connections-per-day/" },
  expandiPrice: { label: "Derrick: Expandi pricing 2026 (a vendor in the same market)", url: "https://derrick-app.com/en/pricing-expandi-2/" },
  expandiTrial: { label: "Capterra: Expandi pricing and trial listing", url: "https://www.capterra.com/p/251762/Expandi/" },
  expandiLimits: { label: "Expandi help center: recommended limits (checked October 2026)", url: "https://help.expandi.io/en/articles/9688856-recommended-limits" },
  dripifyPrice: { label: "LeadHaste: Dripify pricing 2026, plans and trial", url: "https://leadhaste.com/blog/dripify-pricing-2026" },
  dripifyLimits: { label: "Dripify help center: how daily limits safeguard your account (checked October 2026)", url: "https://help.dripify.com/en/articles/8201637-how-dripify-daily-limits-safeguard-your-linkedin-account" },
  pbPrice: { label: "PhantomBuster: pricing explained, plans and credits (checked October 2026)", url: "https://phantombuster.com/blog/ai-automation/phantombuster-pricing-explained" },
  pbLimits: { label: "PhantomBuster: LinkedIn automation safe limits 2026", url: "https://phantombuster.com/blog/linkedin-automation/linkedin-automation-safe-limits-2026/" },
  artisanPrice: { label: "SalesRobot: Artisan AI review with plan prices (a vendor in the same market)", url: "https://www.salesrobot.co/blogs/artisan-ai-review" },
  artisanQuote: { label: "Valley: Artisan pricing explained, reporting quote-only plans (a vendor in the same market)", url: "https://www.joinvalley.co/blog/artisan-pricing-explained-2026" },
  elevenxDocs: { label: "11x help center: pricing overview (checked October 2026)", url: "https://docs.11x.ai/help-center/overview/11x-pricing-overview" },
  elevenxPrice: { label: "Landbase: 11x pricing breakdown (a vendor in the same market)", url: "https://www.landbase.com/blog/11x-ai-pricing" },
  aisdrPrice: { label: "ZoomInfo Pipeline: AiSDR pricing, verified May 2026", url: "https://pipeline.zoominfo.com/sales/aisdr-pricing" },
} as const satisfies Record<string, Source>;

const ROWS: Record<GlanceTool, GlanceRow> = {
  nora: {
    name: "Nora",
    bestFor: "Founders and small teams selling from their own profiles",
    price: "See the pricing page",
    free: "14-day free trial, no card",
    caps: `${PUBLIC_LIMITS.invitesPerDayStart} rising to ${PUBLIC_LIMITS.invitesPerDayMax} a day, ${PUBLIC_LIMITS.invitesPerWeek} a week, enforced`,
    sources: [],
  },
  heyreach: {
    name: "HeyReach",
    bestFor: "Agencies running many sender accounts for clients",
    price: "$79 per sender a month (Growth)",
    free: "Free trial; reviews put it at 14 days",
    caps: "25 a day by default, up to 40; 200 a week per sender",
    sources: [SRC.heyreachPrice, SRC.heyreachPlans, SRC.heyreachTrial, SRC.heyreachLimits],
  },
  waalaxy: {
    name: "Waalaxy",
    bestFor: "Beginners who want ready-made campaigns",
    price: "€19 (roughly $22) per user a month; sources disagree",
    free: "Disputed: one review found a 14-day trial; the help center says launching needs a paid plan",
    caps: "80 to 100 a day on top plans; 200 a week",
    sources: [SRC.waalaxyPrice, SRC.waalaxyCloud, SRC.waalaxyLimits],
  },
  expandi: {
    name: "Expandi",
    bestFor: "Designing branching LinkedIn and email sequences yourself",
    price: "$99 per LinkedIn account a month",
    free: "Trial; most sources say 7 days",
    caps: "Under 100 a week recommended",
    sources: [SRC.expandiPrice, SRC.expandiTrial, SRC.expandiLimits],
  },
  dripify: {
    name: "Dripify",
    bestFor: "Sales teams building drip sequences with team dashboards",
    price: "$59 per user a month (Basic)",
    free: "7-day trial",
    caps: "Up to 75 a day, with a random range",
    sources: [SRC.dripifyPrice, SRC.dripifyLimits],
  },
  phantombuster: {
    name: "PhantomBuster",
    bestFor: "Extracting and enriching data across sites",
    price: "$69 a month (Start)",
    free: "Free plan with 30 minutes of run time a month",
    caps: "15 to 25 a day suggested for accounts over 90 days old",
    sources: [SRC.pbPrice, SRC.pbLimits],
  },
  artisan: {
    name: "Artisan (Ava)",
    bestFor: "Email outreach at volume, with a contact database",
    price: "$250 a month billed annually, or a quote; sources disagree",
    free: "Not published",
    caps: "Not published for LinkedIn",
    sources: [SRC.artisanPrice, SRC.artisanQuote],
  },
  elevenx: {
    name: "11x (Alice)",
    bestFor: "Larger teams wanting one agent across email, phone and LinkedIn",
    price: "Quoted; Growth reported at $3,750 a month, billed annually",
    free: "Not published",
    caps: "Not published",
    sources: [SRC.elevenxDocs, SRC.elevenxPrice],
  },
  aisdr: {
    name: "AiSDR",
    bestFor: "An email and LinkedIn agent on shorter terms",
    price: "$900 a month on quarterly billing (reported)",
    free: "Not published",
    caps: "Not published",
    sources: [SRC.aisdrPrice],
  },
};

/** The table itself. Nora's row is marked so the stylesheet can tint it. */
export function Glance({ tools }: { tools: readonly GlanceTool[] }) {
  return (
    // Wider than the reading column on a large screen: five columns in 46rem
    // wrapped every cell to two words a line.
    <div className="alt-table alt-wide">
      <CompareTable
        caption="Alternatives at a glance, as of October 2026"
        columns={["Best for", "Entry price", "Free plan or trial", "Published caps"]}
        rows={tools.map((tool) => {
          const row = ROWS[tool];
          return {
            label: row.name,
            values: [
              tool === "nora" ? <span className="alt-nora">{row.bestFor}</span> : row.bestFor,
              row.price,
              row.free,
              row.caps,
            ],
          };
        })}
      />
    </div>
  );
}

/**
 * A page's own sources plus the ones behind its glance table, once each. The
 * page's own label wins where both cite the same address.
 */
export function withGlanceSources(own: readonly Source[], tools: readonly GlanceTool[]): Source[] {
  const seen = new Set(own.map((s) => s.url));
  const extra: Source[] = [];
  for (const tool of tools) {
    for (const source of ROWS[tool].sources) {
      if (seen.has(source.url)) continue;
      seen.add(source.url);
      extra.push(source);
    }
  }
  return [...own, ...extra];
}

/**
 * The short answer, at the top of each comparison: when to pick Nora and when
 * to stay. It replaces a table whose rows the side-by-side table repeated.
 */
export function Verdict({
  rival,
  nora,
  them,
}: {
  rival: string;
  nora: readonly string[];
  them: readonly string[];
}) {
  return (
    <div className="alt-verdict">
      <div className="alt-verdict-col is-nora">
        <p className="alt-verdict-title">Choose Nora if</p>
        <ul>
          {nora.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="alt-verdict-col">
        <p className="alt-verdict-title">Stay with {rival} if</p>
        <ul>
          {them.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
