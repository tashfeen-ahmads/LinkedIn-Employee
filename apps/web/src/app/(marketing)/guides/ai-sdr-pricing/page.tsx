import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/guides/ai-sdr-pricing";
export const metadata: Metadata = articleMeta(PATH);

/*
 * The human-SDR arithmetic, from the two cited sources and nothing else, so a
 * reader can redo it. Bridge Group 2025: median OTE $80K ($55K base, $25K
 * variable), 3.0 months to ramp, 1.9 years average tenure. BLS ECEC, June
 * 2026: wages and salaries are 68.5% of compensation cost for full-time
 * private-industry workers.
 */
const SDR_OTE = 80_000;
const SDR_BASE = 55_000;
const SDR_VARIABLE = 25_000;
const RAMP_MONTHS = 3;
const TENURE_YEARS = 1.9;
const WAGE_SHARE_FULL_TIME = 0.685;
const LOADED = Math.round(SDR_OTE / WAGE_SHARE_FULL_TIME / 1000) * 1000;
const LOADED_MONTHLY = Math.round(LOADED / 12 / 100) * 100;
const RAMP_COST = Math.round((LOADED / 12) * RAMP_MONTHS / 1000) * 1000;
const PRODUCTIVE_MONTHS = Math.round(TENURE_YEARS * 12 - RAMP_MONTHS);

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

const BRIDGE = "https://www.bridgegroupinc.com/research/2025-sdr-models-metrics-report-the-bridge-group";
const BLS = "https://www.bls.gov/opub/ted/2026/compensation-costs-for-private-industry-workers-averaged-46-89-per-hour-worked-in-june-2026.htm";
const ELEVENX_DOCS = "https://docs.11x.ai/help-center/overview/11x-pricing-overview";
const ELEVENX_THIRD = "https://www.landbase.com/blog/11x-ai-pricing";
const AISDR_PRICING = "https://aisdr.com/pricing/";
const AISDR_ZOOMINFO = "https://pipeline.zoominfo.com/sales/aisdr-pricing";
const ARTISAN_REVIEW = "https://www.salesrobot.co/blogs/artisan-ai-review";
const ARTISAN_PRIVATE = "https://www.joinvalley.co/blog/artisan-pricing-explained-2026";
const ARTISAN_OWN = "https://www.artisan.co/blog/how-much-does-an-ai-sdr-cost-pricing-compared-to-human-sdrs";
const HEYREACH_PRICING = "https://www.heyreach.io/pricing";
const REVNEW = "https://revnew.com/blog/sdr-outsourcing-cost";
const GIGRADAR = "https://gigradar.io/blog/outsource-sales";
const SALES_NAV = "https://www.joinvalley.co/blog/linkedin-sales-navigator-cost-explained-2026";

const FAQ: readonly Faq[] = [
  {
    q: "How much does an AI SDR cost per month?",
    a: "As of October 2026, published prices run from free to several thousand dollars a month. AiSDR is reported at $900 and $2,500 a month on quarterly billing, 11x's Alice Growth tier is reported at $3,750 a month on an annual contract, and Artisan's price depends on which source you trust. LinkedIn-only tools are usually priced per sender, often under $100 a month each.",
  },
  {
    q: "How much does it cost to hire an SDR?",
    a: `The Bridge Group's 2025 report puts median SDR on-target earnings at ${usd(SDR_OTE)}. Once payroll taxes and benefits are added, using the federal government's figure that pay is 68.5% of a full-time private-sector employee's cost, that is about ${usd(LOADED)} a year before tools, management time or recruiting, and roughly ${RAMP_MONTHS} months of it is spent ramping.`,
  },
  {
    q: "Is an AI SDR cheaper than a human SDR?",
    a: "On price, almost always: even the most expensive reported AI SDR contracts cost less than one fully loaded hire. On cost per meeting it depends on what you sell. A human qualifies, handles nuance and builds relationships; an AI SDR researches and writes at volume. For many small teams the cheapest setup is an AI doing the volume with a person approving what goes out.",
  },
  {
    q: "Are there AI SDRs with no annual contract?",
    a: "Yes, though fewer than you might expect at the top of the market. As of October 2026, 11x bills annually and AiSDR is reported to bill quarterly. Most LinkedIn sequencers bill monthly per sender. Nora has no contract at all: it is free while it grows, with no card and no plan to choose.",
  },
  {
    q: "Is there a free AI SDR?",
    a: "Nora is free for now, for everyone, with no card and no time limit. It is LinkedIn only: it drafts customer profiles from your website, finds people, writes one note per person, follows up, answers replies and books meetings, with you approving the strategy, the copy and the launch. Several other tools offer time-limited trials rather than a free product.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "The Bridge Group: 2025 SDR models and metrics report", url: BRIDGE },
  { label: "US Bureau of Labor Statistics: employer compensation costs, June 2026", url: BLS },
  { label: "11x help center: pricing overview (checked October 2026)", url: ELEVENX_DOCS },
  { label: "Landbase: 11x pricing breakdown (a vendor in the same market)", url: ELEVENX_THIRD },
  { label: "AiSDR: pricing page (checked October 2026)", url: AISDR_PRICING },
  { label: "ZoomInfo Pipeline: AiSDR pricing, verified May 2026", url: AISDR_ZOOMINFO },
  { label: "SalesRobot: Artisan AI review with plan prices (a vendor in the same market)", url: ARTISAN_REVIEW },
  { label: "Valley: Artisan pricing explained, reporting quote-only plans (a vendor in the same market)", url: ARTISAN_PRIVATE },
  { label: "Artisan: how much an AI SDR costs compared with human SDRs (studied for this page)", url: ARTISAN_OWN },
  { label: "HeyReach: pricing page (checked October 2026)", url: HEYREACH_PRICING },
  { label: "Revnew: SDR outsourcing cost (an outsourcing provider)", url: REVNEW },
  { label: "GigRadar: outsourcing sales, retainers, setup fees and minimums", url: GIGRADAR },
  { label: "Valley: LinkedIn Sales Navigator cost explained, 2026", url: SALES_NAV },
  { label: "Stealth Agents: cost of hiring an SDR in 2026 (studied for this page)", url: "https://stealthagents.com/research/cost-of-hiring-an-sdr-2026/" },
];

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} rel="noopener nofollow" target="_blank">
      {children}
    </a>
  );
}

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="AI SDR pricing in 2026, and what a human SDR really costs"
      lede={`AI SDR pricing in 2026 runs from free to several thousand dollars a month, and the best-known agents sell on annual or quarterly contracts with prices that differ depending on who is reporting them. A human SDR costs about ${usd(LOADED)} a year once taxes and benefits are added to the median ${usd(SDR_OTE)} pay package, before tools, management or the ${RAMP_MONTHS} months it takes to ramp.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">The short answer</h2>
      <CompareTable
        caption="What each way of staffing outbound costs, as of October 2026, from the sources on this page"
        columns={["Typical cost", "Commitment"]}
        rows={[
          { label: "In-house SDR", values: [`About ${usd(LOADED_MONTHLY)} a month fully loaded, before tools`, "A hire, a manager and about 3 months of ramp"] },
          { label: "Outsourced SDR or agency", values: ["Roughly $4,000 to $18,000 a month, or per meeting", "Often 3 to 6 month minimums plus setup"] },
          { label: "AI SDR agent", values: ["Reported from a few hundred to several thousand dollars a month", "Often quarterly or annual contracts"] },
          { label: "LinkedIn sequencer", values: ["Often under $100 per sender a month", "Usually monthly"] },
          { label: "Nora", values: ["Free for now, for everyone", "None: no card, no plan"] },
        ]}
      />
      <p>
        Each figure carries caveats, covered below. Two things to hold onto: almost every AI SDR price you will read was published by a
        competitor of the product it describes, us included, and the monthly sticker is rarely the
        whole bill on either side.
      </p>

      <h2 id="ai-sdr-prices">AI SDR pricing, with dates and sources</h2>
      <p>
        These are the figures we could find for the most-searched AI SDRs, checked in October 2026.
        Follow the link before you budget: several changed during 2026.
      </p>
      <CompareTable
        caption="AI SDR prices as reported in October 2026, each linked to its source"
        columns={["Reported price", "Billing", "Main channel"]}
        rows={[
          {
            label: "11x (Alice)",
            values: [
              <>
                Growth tier reported at $3,750 a month (<Ext href={ELEVENX_THIRD}>Landbase</Ext>);
                higher tiers quoted
              </>,
              <>
                Annual, no setup fee (<Ext href={ELEVENX_DOCS}>11x help center</Ext>)
              </>,
              "Email first, with other channels",
            ],
          },
          {
            label: "Artisan (Ava)",
            values: [
              <>
                $250 or $600 a month billed annually (<Ext href={ARTISAN_REVIEW}>one source</Ext>),
                or quote only (<Ext href={ARTISAN_PRIVATE}>another</Ext>)
              </>,
              "Annual on the published tiers; sources disagree",
              "Email first, with LinkedIn steps",
            ],
          },
          {
            label: "AiSDR",
            values: [
              <>
                $900 (Explore) or $2,500 (Grow) a month (<Ext href={AISDR_ZOOMINFO}>ZoomInfo, verified May 2026</Ext>)
              </>,
              "Quarterly",
              "Email and LinkedIn",
            ],
          },
          {
            label: "HeyReach (LinkedIn sequencer)",
            values: [
              <>
                $79 per sender a month (<Ext href={HEYREACH_PRICING}>pricing page</Ext>)
              </>,
              "Monthly, cheaper on longer terms",
              "LinkedIn",
            ],
          },
          { label: "Nora", values: ["Free for now", "No contract, no card", "LinkedIn"] },
        ]}
      />

      <h3 id="why-prices-vary">Why quoted prices for Artisan and 11x range so widely</h3>
      <p>
        Search for either price and you will find figures that differ by a factor of ten. There are
        three reasons. First, both sell mainly through a sales call, so the number depends on volume,
        seats and negotiation, and the people publishing &ldquo;real quotes&rdquo; are usually
        competitors. Second, Artisan&rsquo;s public plans changed during 2026: some sources checked
        in early October still list self-serve tiers at $250 and $600 a month billed annually, while
        another reports that those plans were withdrawn mid-year in favour of quoted tiers. We could
        not confirm which is current, so we show both. Third, articles about one vendor are often
        written by another: several of the price sources on this page are published by companies
        selling in the same market.
      </p>
      <p>
        Artisan&rsquo;s <Ext href={ARTISAN_OWN}>own article on the subject</Ext>, which ranks for
        this query as of October 2026, puts most AI SDRs at
        $500 to $5,000 a month and a fully loaded human SDR at $120,000 to $200,000 a year. It does
        not state Artisan&rsquo;s own price, which is the number most readers came for.
      </p>

      <h3 id="pricing-models">Per seat, per sender, per contract</h3>
      <ul>
        <li>
          <strong>Per contract with a volume allowance.</strong> Enterprise agents bundle a number of
          prospects, credits or messages a month into an annual or quarterly commitment. Cheap per
          message if you use it all; expensive if you are still finding out whether outbound works.
        </li>
        <li>
          <strong>Per sender.</strong> LinkedIn tools usually charge for each LinkedIn account that
          sends. This scales with the number of profiles, which suits agencies and costs little for a
          team sending from one account.
        </li>
        <li>
          <strong>Credits.</strong> Each research, email or message action spends credits from a
          monthly pool. Ask what a full campaign to one person costs in credits before comparing.
        </li>
      </ul>
      <p>
        Whatever the model, price it at the volume your account can safely send, not the volume the
        plan allows. A LinkedIn account in Nora starts at {PUBLIC_LIMITS.invitesPerDayStart}{" "}
        connection requests a day and never passes {PUBLIC_LIMITS.invitesPerWeek} a week, and a plan
        priced for thousands of LinkedIn touches a month assumes volume no single account should send.
      </p>

      <h2 id="human-sdr-cost">What a human SDR costs, fully loaded</h2>

      <h3 id="salary-tools-management">Salary, tools and management</h3>
      <p>
        The most cited primary source is the Bridge Group&rsquo;s{" "}
        <Ext href={BRIDGE}>2025 SDR report</Ext>, covering 351 B2B companies. It puts median SDR
        on-target earnings at {usd(SDR_OTE)}: {usd(SDR_BASE)} base and {usd(SDR_VARIABLE)} variable,
        unchanged since 2022. Pay is not the whole cost of employing someone. The US Bureau of Labor
        Statistics reports that for <Ext href={BLS}>full-time private-industry workers in June 2026</Ext>,
        wages and salaries were 68.5% of the employer&rsquo;s compensation cost, the rest being
        benefits and legally required contributions.
      </p>
      <p>
        Put those together and an SDR paid at target costs about {usd(LOADED)} a year, roughly{" "}
        {usd(LOADED_MONTHLY)} a month. That still leaves out the data and sequencing tools they need,
        a Sales Navigator seat, recruiting, and the share of a manager&rsquo;s week spent coaching
        them. The higher figures you will see on vendor pages include some of those, which is why
        they differ.
      </p>

      <h3 id="ramp-churn">Ramp time and churn</h3>
      <p>
        The same report puts average ramp at {RAMP_MONTHS}.0 months and average tenure at{" "}
        {TENURE_YEARS} years, the longest in over a decade. So a typical hire costs about{" "}
        {usd(RAMP_COST)} before reaching full productivity, then works at full speed for around{" "}
        {PRODUCTIVE_MONTHS} months before you hire again. The report also found only 60% of SDRs at
        quota, the lowest in its history. None of that is a reason not to hire; it is the cost to
        compare against.
      </p>

      <h2 id="outsourced-cost">What an outsourced SDR costs</h2>
      <p>
        Outsourcing firms publish ranges rather than prices, and the ranges come from the firms
        themselves. As of October 2026 one provider, Revnew, puts{" "}
        <Ext href={REVNEW}>outsourced SDR programmes at $4,000 to $18,000 a month</Ext> depending on
        seniority and scope, and describes per-meeting pricing as an alternative. A guide from
        GigRadar adds that <Ext href={GIGRADAR}>setup fees of $1,000 to $15,000 and three to six month minimums</Ext>{" "}
        are common. The useful comparison is cost per qualified meeting, and the contract&rsquo;s
        definition of &ldquo;qualified&rdquo; matters more than the monthly figure.
      </p>
      <p>
        An agency also sends from somebody&rsquo;s LinkedIn account, often yours. Ask which account,
        at what daily volume, and who approves the messages before they go out under your name.
      </p>

      <h2 id="hidden-costs">Hidden costs nobody lists</h2>

      <h3 id="sales-navigator">A Sales Navigator seat</h3>
      <p>
        Most LinkedIn prospecting assumes Sales Navigator, which LinkedIn sells separately: about{" "}
        <Ext href={SALES_NAV}>$120 a month per seat for Core on monthly billing</Ext>, less on annual
        billing, as of October 2026. Check LinkedIn&rsquo;s own plan page, since prices vary by region.
        You do not need it for Nora. Without it, LinkedIn&rsquo;s standard search cannot filter by
        seniority, company size or excluded titles, so Nora names the filters it could not apply on
        the campaign before you launch, rather than handing you a list that only looks precise.
      </p>

      <h3 id="restricted-account">A restricted account</h3>
      <p>
        The cost nobody prices is the LinkedIn account itself. A profile with years of connections is
        the asset outbound runs on, and LinkedIn&rsquo;s User Agreement prohibits automated access, so
        any tool that sends for you, an AI SDR, a sequencer or an agency&rsquo;s software, puts it at
        some risk. A restriction costs the days or weeks of outreach it pauses and, at worst, the
        network. The cheapest tool is not cheap if its default is 75 invitations a day from a week-old
        account. Our guide to the{" "}
        <Link href="/guides/safest-linkedin-automation-tool">safest LinkedIn automation tool</Link>{" "}
        lists eight checks that keep that risk low.
      </p>

      <h2 id="free-ai-sdr">Is a free AI SDR worth it?</h2>
      <p>
        It depends on what &ldquo;free&rdquo; leaves out. Nora is free for now for every workspace,
        with no card, no time limit and the same limits for everyone, because the caps that protect a
        LinkedIn account are product rules rather than something a higher tier unlocks. It does the
        whole job on LinkedIn: drafts customer profiles from your website, finds real people, writes
        each a note from their own profile, follows up, answers replies from the documents you give it
        and books meetings. You approve the strategy, the copy and the launch. The{" "}
        <Link href="/pricing">pricing page</Link> says what happens if that ever changes: you hear
        first, and your data is yours to export.
      </p>
      <p>What it will not do, so you can judge whether free is enough:</p>
      <ul>
        <li>It is LinkedIn only. If your buyers answer email, an email-first agent fits better.</li>
        <li>
          It sends at a careful pace: {PUBLIC_LIMITS.invitesPerDayStart} invitations a day for a new
          account, rising to {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks}{" "}
          weeks. If you need thousands of touches a month, it is the wrong tool.
        </li>
        <li>It does not replace the judgement of someone who knows your buyers. It drafts; you approve.</li>
      </ul>
      <p>
        If you are weighing a hire against software, read{" "}
        <Link href="/guides/ai-sdr-vs-human-sdr">AI SDR vs human SDR vs agency</Link>. If you are
        comparing agents, the{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        has the questions, and <Link href="/alternatives/artisan">Artisan alternatives</Link> compares
        the best-known agent with Nora directly. More in the <Link href="/guides">outreach guides</Link>.
      </p>
      <Callout tone="info">
        <p>
          The cheapest way to find out whether LinkedIn works for you costs nothing.{" "}
          <a href={`${SITE.app}/signup`}>Sign up free</a>; nothing is sent until you launch.
        </p>
      </Callout>
    </ArticleLayout>
  );
}
