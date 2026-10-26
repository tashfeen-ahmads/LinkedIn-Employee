import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { CostBars } from "@/components/seo/ga1-diagrams";
import {
  HUMAN_SOURCES,
  PLAN_FIGURES,
  OUTSOURCED,
  PRICES_CHECKED,
  SALES_NAV_MONTHLY,
  SDR,
  SDR_LOADED,
  SDR_LOADED_MONTHLY,
  SDR_PRODUCTIVE_MONTHS,
  SDR_RAMP_COST,
  TOOL_PRICES,
  priceSources,
  usd,
  type ToolId,
} from "@/components/seo/ga1-prices";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/guides/ai-sdr-pricing";
export const metadata: Metadata = articleMeta(PATH);

/** The tools this page prices, in the order the table shows them. */
const PRICED: readonly ToolId[] = ["elevenX", "artisan", "aisdr", "amplemarket", "reply", "salesforge", "valley", "heyreach"];

const ARTISAN_EARLIER = "https://www.salesrobot.co/blogs/artisan-ai-review";
const ARTISAN_QUOTED = "https://www.joinvalley.co/blog/artisan-pricing-explained-2026";
const ARTISAN_OWN = "https://www.artisan.co/blog/how-much-does-an-ai-sdr-cost-pricing-compared-to-human-sdrs";

/*
 * The worked example. Every input is either a figure from the dataset or an
 * assumption named as one on the page, so a reader can swap their own in.
 */
const MEETINGS_ASSUMED = 8;
const IN_HOUSE_MONTHLY = SDR_LOADED_MONTHLY + SALES_NAV_MONTHLY;
const AGENT_ENTRY = PLAN_FIGURES.aisdrExplore;
const AGENT_TOP = TOOL_PRICES.elevenX.entryMonthly;
const SEQUENCER_MONTHLY = TOOL_PRICES.heyreach.entryMonthly + SALES_NAV_MONTHLY;
const perMeeting = (monthly: number) => usd(Math.round(monthly / MEETINGS_ASSUMED));
const timesAsMany = (monthly: number) => (IN_HOUSE_MONTHLY / monthly).toFixed(1);

const FAQ: readonly Faq[] = [
  {
    q: "How much does an AI SDR cost per month?",
    a: `As of October 2026, entry plans for the best-known AI SDR agents run from about $250 a month (Artisan's and AiSDR's self-serve plans) to $3,750 a month (11x's Growth tier, billed annually). LinkedIn sequencers usually cost under $100 per sender a month. Larger volumes are quoted, and several agents bill quarterly or annually rather than monthly.`,
  },
  {
    q: "How much does it cost to hire an SDR?",
    a: `The Bridge Group's 2025 report puts median SDR on-target earnings at ${usd(SDR.ote)}. Add payroll taxes and benefits, using the federal figure that pay is 68.5% of a full-time private-sector employee's cost, and that is about ${usd(SDR_LOADED)} a year before tools, management time or recruiting, with roughly ${SDR.rampMonths} months of it spent ramping.`,
  },
  {
    q: "Is an AI SDR cheaper than a human SDR?",
    a: "On price, almost always: even the most expensive published AI SDR tier costs less than one fully loaded hire. On cost per meeting it depends on how many meetings each actually books, which nobody can promise in advance. A person qualifies, handles nuance and builds relationships; an AI SDR researches and writes at volume. For many small teams the cheapest setup is software doing the volume with a person approving what goes out.",
  },
  {
    q: "Are there AI SDRs with no annual contract?",
    a: `Yes. As of October 2026, Artisan's self-serve plan and Reply.io's Jason AI SDR start monthly, while 11x bills annually, Amplemarket's Startup plan is an annual term and AiSDR bills quarterly or annually. Most LinkedIn sequencers bill monthly per sender. Nora starts with a 14-day free trial with no card, then bills monthly or yearly, as you choose. The pricing page lists both plans.`,
  },
  {
    q: "Is there a free AI SDR?",
    a: "Nora offers a 14-day free trial of the whole product, with no card, and then a paid plan. It is LinkedIn only: it drafts customer profiles from your website, finds people, writes one note per person, follows up, drafts replies from your documents for you to approve and books meetings, with you approving the strategy, the copy and the launch. Several other tools offer time-limited trials or a free plan with a small quota.",
  },
];

const SOURCES: readonly Source[] = [
  HUMAN_SOURCES.bridge,
  HUMAN_SOURCES.bls,
  ...priceSources(PRICED),
  { label: "SalesRobot: Artisan AI review with earlier annual plan prices (a vendor in the same market)", url: ARTISAN_EARLIER },
  { label: "Valley: Artisan pricing explained, reporting quote-only plans (a vendor in the same market)", url: ARTISAN_QUOTED },
  { label: "Artisan: how much an AI SDR costs compared with human SDRs", url: ARTISAN_OWN },
  HUMAN_SOURCES.revnew,
  HUMAN_SOURCES.gigradar,
  HUMAN_SOURCES.salesNav,
];

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} rel="noopener nofollow" target="_blank">
      {children}
    </a>
  );
}

/** A dataset price with its first source linked, so every figure carries where it came from. */
function Priced({ id }: { id: ToolId }) {
  const tool = TOOL_PRICES[id];
  const source = tool.sources[0];
  return (
    <>
      {tool.price}{" "}
      <a className="ga1-src" href={source.url} rel="noopener nofollow" target="_blank">
        (source)
      </a>
    </>
  );
}

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="AI SDR pricing in 2026, and what a human SDR really costs"
      lede={`AI SDR pricing in 2026 starts around $250 a month for self-serve plans and reaches $3,750 a month for 11x's entry tier, often on quarterly or annual terms, while LinkedIn sequencers cost under $100 per sender. A human SDR costs about ${usd(SDR_LOADED)} a year once taxes and benefits are added to the median ${usd(SDR.ote)} pay package, before tools, management or the ${SDR.rampMonths} months it takes to ramp.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">The short answer</h2>
      <CompareTable
        caption={`What each way of staffing outbound costs, as of ${PRICES_CHECKED}, from the sources on this page`}
        columns={["Typical cost", "Commitment"]}
        rows={[
          { label: "In-house SDR", values: [`About ${usd(SDR_LOADED_MONTHLY)} a month fully loaded, before tools`, `A hire, a manager and about ${SDR.rampMonths} months of ramp`] },
          { label: "Outsourced SDR or agency", values: [`Roughly ${usd(OUTSOURCED.lowMonthly)} to ${usd(OUTSOURCED.highMonthly)} a month, or per meeting`, "Often 3 to 6 month minimums plus setup"] },
          { label: "AI SDR agent", values: ["About $250 to $3,750 a month at entry, more for volume", "Monthly to annual, depending on the vendor"] },
          { label: "LinkedIn sequencer", values: ["Often under $100 per sender a month", "Usually monthly"] },
          { label: "Nora", values: ["See the pricing page", "14-day free trial, no card, then monthly or yearly"] },
        ]}
      />
      <p>
        Each figure carries caveats, covered below. Some prices come from the vendors&rsquo; own pages and some from
        write-ups by companies selling in the same market, us included; every one is linked to its source. And the
        monthly sticker is rarely the whole bill on either side.
      </p>

      <h2 id="ai-sdr-prices">AI SDR pricing, with dates and sources</h2>
      <p>
        These are the published figures for the most-searched AI SDRs and one LinkedIn sequencer for scale, checked in{" "}
        {PRICES_CHECKED}. Follow the link before you budget: several changed during 2026. The same figures appear in our{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to the best AI SDR tools</Link>, with what each tool is
        for.
      </p>
      <CompareTable
        caption={`AI SDR prices as published in ${PRICES_CHECKED}, each linked to its source`}
        columns={["Reported price", "Billing", "Main channel"]}
        rows={[
          ...PRICED.map((id) => ({
            label: TOOL_PRICES[id].name,
            values: [<Priced key="p" id={id} />, TOOL_PRICES[id].billing, TOOL_PRICES[id].channel],
          })),
          { label: "Nora", values: ["See the pricing page", "Monthly or yearly, after a 14-day free trial with no card", "LinkedIn"] },
        ]}
      />

      <h3 id="why-prices-vary">Why quoted prices for Artisan and 11x range so widely</h3>
      <p>
        Search for either price and you will find figures that differ by a factor of ten. There are three reasons.
        First, both sell larger volumes through a sales call, so the number depends on volume, seats and negotiation.
        11x publishes its Growth tier at $3,750 a month billed annually and quotes the tiers above it. Second, Artisan&rsquo;s plans changed during 2026: its own announcement in May put a self-serve
        plan at $250 a month, while articles from earlier in the year list{" "}
        <Ext href={ARTISAN_EARLIER}>annual tiers at $250 and $600 a month</Ext> or{" "}
        <Ext href={ARTISAN_QUOTED}>quote-only plans</Ext>. Third, articles about one vendor are often written by another,
        so check who published a price before trusting it.
      </p>
      <p>
        Artisan&rsquo;s <Ext href={ARTISAN_OWN}>own article on the subject</Ext> puts most AI SDRs at $500 to $5,000 a
        month and a fully loaded human SDR at $120,000 to $200,000 a year. That human range sits above the arithmetic
        below, which leaves out tools and management time.
      </p>

      <h3 id="pricing-models">Per seat, per sender, per contract</h3>
      <ul>
        <li>
          <strong>Per contract with a volume allowance.</strong> Enterprise agents bundle a number of prospects, credits
          or messages a month into an annual or quarterly commitment. Cheap per message if you use it all; expensive if
          you are still finding out whether outbound works.
        </li>
        <li>
          <strong>Per active contact.</strong> Reply.io&rsquo;s Jason and Salesforge&rsquo;s Agent Frank charge by active
          contacts a month, the people being worked, not by seats.
        </li>
        <li>
          <strong>Per sender.</strong> LinkedIn tools usually charge for each LinkedIn account that sends. This scales
          with the number of profiles, which suits agencies and costs little for a team sending from one account.
        </li>
        <li>
          <strong>Credits.</strong> Each research, email or message action spends credits from a monthly pool. Ask what a
          full campaign to one person costs in credits before comparing.
        </li>
      </ul>
      <p>
        Whatever the model, price it at the volume your account can safely send, not the volume the plan allows. A
        LinkedIn account in Nora starts at {PUBLIC_LIMITS.invitesPerDayStart} connection requests a day and never passes{" "}
        {PUBLIC_LIMITS.invitesPerWeek} a week, and a plan priced for thousands of LinkedIn touches a month assumes volume
        no single account should send.
      </p>

      <h2 id="human-sdr-cost">What a human SDR costs, fully loaded</h2>

      <h3 id="salary-tools-management">Salary, tools and management</h3>
      <p>
        The most cited primary source is the Bridge Group&rsquo;s{" "}
        <Ext href={HUMAN_SOURCES.bridge.url}>2025 SDR report</Ext>, covering 351 B2B companies. It puts median SDR
        on-target earnings at {usd(SDR.ote)}: {usd(SDR.base)} base and {usd(SDR.variable)} variable, unchanged since
        2022. Pay is not the whole cost of employing someone. The US Bureau of Labor Statistics reports that for{" "}
        <Ext href={HUMAN_SOURCES.bls.url}>full-time private-industry workers in June 2026</Ext>, wages and salaries were
        68.5% of the employer&rsquo;s compensation cost, the rest being benefits and legally required contributions.
      </p>
      <p>
        Put those together and an SDR paid at target costs about {usd(SDR_LOADED)} a year, roughly{" "}
        {usd(SDR_LOADED_MONTHLY)} a month. That still leaves out the data and sequencing tools they need, a Sales
        Navigator seat, recruiting, and the share of a manager&rsquo;s week spent coaching them. The higher figures you
        will see on vendor pages include some of those, which is why they differ.
      </p>

      <h3 id="ramp-churn">Ramp time and churn</h3>
      <p>
        The same report puts average ramp at {SDR.rampMonths}.0 months and average tenure at {SDR.tenureYears} years, the
        longest in over a decade. So a typical hire costs about {usd(SDR_RAMP_COST)} before reaching full productivity,
        then works at full speed for around {SDR_PRODUCTIVE_MONTHS} months before you hire again. The report also found
        only {SDR.atQuotaPercent}% of SDRs at quota, the lowest in its history. None of that is a reason not to hire; it
        is the cost to compare against.
      </p>

      <h2 id="outsourced-cost">What an outsourced SDR costs</h2>
      <p>
        Outsourcing firms publish ranges rather than prices, and the ranges come from the firms themselves. As of{" "}
        {PRICES_CHECKED} one provider, Revnew, puts{" "}
        <Ext href={HUMAN_SOURCES.revnew.url}>
          outsourced SDR programs at {usd(OUTSOURCED.lowMonthly)} to {usd(OUTSOURCED.highMonthly)} a month
        </Ext>{" "}
        depending on seniority and scope, and describes per-meeting pricing as an alternative. A guide from GigRadar adds
        that <Ext href={HUMAN_SOURCES.gigradar.url}>setup fees of $1,000 to $15,000 and three to six month minimums</Ext>{" "}
        are common. The useful comparison is cost per qualified meeting, and the contract&rsquo;s definition of
        &ldquo;qualified&rdquo; matters more than the monthly figure.
      </p>
      <p>
        An agency also sends from somebody&rsquo;s LinkedIn account, often yours. Ask which account, at what daily
        volume, and who approves the messages before they go out under your name.
      </p>

      <h2 id="cost-per-meeting">Cost per meeting: a worked example</h2>
      <Callout tone="info">
        <p>
          <strong>An illustration, not a benchmark.</strong> It assumes every option books the same{" "}
          {MEETINGS_ASSUMED} meetings a month, which no vendor or agency can promise and which you should replace with
          your own number. Costs are this page&rsquo;s figures as of {PRICES_CHECKED}; the in-house SDR and the sequencer
          include a {usd(SALES_NAV_MONTHLY)} Sales Navigator seat, and nobody&rsquo;s own time is counted.
        </p>
      </Callout>
      <CompareTable
        caption={`Cost per meeting if each option books ${MEETINGS_ASSUMED} meetings a month (illustration)`}
        columns={["Monthly cost", "Cost per meeting"]}
        rows={[
          { label: "In-house SDR, fully loaded", values: [usd(IN_HOUSE_MONTHLY), perMeeting(IN_HOUSE_MONTHLY)] },
          { label: "Agency, low end of the published range", values: [usd(OUTSOURCED.lowMonthly), perMeeting(OUTSOURCED.lowMonthly)] },
          { label: "AI SDR agent, 11x Growth tier", values: [usd(AGENT_TOP), perMeeting(AGENT_TOP)] },
          { label: "AI SDR agent, AiSDR Explore plan", values: [usd(AGENT_ENTRY), perMeeting(AGENT_ENTRY)] },
          { label: "LinkedIn sequencer, one HeyReach sender", values: [usd(SEQUENCER_MONTHLY), `${perMeeting(SEQUENCER_MONTHLY)}, plus your hours writing and replying`] },
        ]}
      />
      <p>
        Read it the other way round and the question becomes how many more meetings the expensive option has to book. At
        these prices an in-house SDR needs about {timesAsMany(AGENT_ENTRY)} times as many meetings as the AiSDR plan, or{" "}
        {timesAsMany(AGENT_TOP)} times as many as the 11x tier, to match their cost per meeting. A good SDR selling a
        large deal can clear that bar; for a small team testing whether LinkedIn works at all, it is a lot to ask of one
        hire in their first {SDR.rampMonths} months.
      </p>
      <CostBars
        caption={`Yearly cost at the prices above, as of ${PRICES_CHECKED}`}
        bars={[
          { label: "In-house SDR, fully loaded, with Sales Navigator", value: IN_HOUSE_MONTHLY * 12, note: "Before recruiting, tools and management time" },
          { label: "Agency, low end", value: OUTSOURCED.lowMonthly * 12, note: "Before setup fees and minimum terms" },
          { label: "11x Growth tier", value: AGENT_TOP * 12, note: "Billed annually" },
          { label: "AiSDR Explore", value: AGENT_ENTRY * 12, note: "Quarterly, or less billed annually" },
          { label: "HeyReach, one sender, with Sales Navigator", value: SEQUENCER_MONTHLY * 12, note: "You write the copy and answer the replies" },
          { label: "Nora", value: null, note: "14-day free trial, no card" },
        ]}
      />

      <h2 id="hidden-costs">Hidden costs nobody lists</h2>

      <h3 id="sales-navigator">A Sales Navigator seat</h3>
      <p>
        Most LinkedIn prospecting assumes Sales Navigator, which LinkedIn sells separately: about{" "}
        <Ext href={HUMAN_SOURCES.salesNav.url}>{usd(SALES_NAV_MONTHLY)} a month per seat for Core on monthly billing</Ext>,
        less on annual billing, as of {PRICES_CHECKED}. Check LinkedIn&rsquo;s own plan page before you buy. You do not
        need it for Nora. Without it, LinkedIn&rsquo;s standard search cannot filter by seniority, company size or
        excluded titles, so Nora names the filters it could not apply on the campaign before you launch, rather than
        handing you a list that only looks precise.
      </p>

      <h3 id="restricted-account">A restricted account</h3>
      <p>
        The cost nobody prices is the LinkedIn account itself. A profile with years of connections is the asset outbound
        runs on, and LinkedIn&rsquo;s User Agreement prohibits automated access, so any tool that sends for you, an AI
        SDR, a sequencer or an agency&rsquo;s software, puts it at some risk. A restriction costs the days or weeks of
        outreach it pauses and, at worst, the network. The cheapest tool is not cheap if it would let a week-old account
        send 75 invitations a day. Our guide to the{" "}
        <Link href="/guides/safest-linkedin-automation-tool">safest LinkedIn automation tool</Link> lists eight checks
        that keep that risk low.
      </p>

      <h2 id="free-ai-sdr">Is a free AI SDR worth it?</h2>
      <p>
        It depends on what &ldquo;free&rdquo; leaves out. Most free plans hold back the sending. Nora has no free plan for new
        workspaces, but its 14-day free trial is the whole product, with no card and the same limits for everyone,
        because the caps that protect a LinkedIn account are product rules rather than
        something a higher tier unlocks. It does the whole job on LinkedIn: drafts customer profiles from your website,
        finds real people, writes each a note from their own profile, follows up, drafts replies from the documents you
        give it for you to approve, and books meetings. You approve the strategy, the copy and the launch. The{" "}
        <Link href="/pricing">pricing page</Link> lists the plans that follow the trial, and your data is always yours to
        export.
      </p>
      <p>What it will not do, so you can judge it before the trial ends:</p>
      <ul>
        <li>It is LinkedIn only. If your buyers answer email, an email-first agent fits better.</li>
        <li>
          It sends at a careful pace: {PUBLIC_LIMITS.invitesPerDayStart} invitations a day for a new account, rising to{" "}
          {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks. If you need thousands of touches
          a month, it is the wrong tool.
        </li>
        <li>It does not replace the judgment of someone who knows your buyers. It drafts; you approve.</li>
      </ul>
      <p>
        Weighing a hire against software? Read{" "}
        <Link href="/guides/ai-sdr-vs-human-sdr">AI SDR vs human SDR vs agency</Link>. Comparing agents?{" "}
        <Link href="/alternatives/artisan">Artisan alternatives</Link> sets the best-known one beside Nora.
      </p>
    </ArticleLayout>
  );
}
