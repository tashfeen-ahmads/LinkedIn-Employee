import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, alwaysHoldsSentence } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { CostBars } from "@/components/seo/ga1-diagrams";
import {
  HUMAN_SOURCES,
  OUTSOURCED,
  PLAN_FIGURES,
  PRICES_CHECKED,
  SDR,
  SDR_LOADED,
  TOOL_PRICES,
  usd,
} from "@/components/seo/ga1-prices";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/guides/ai-sdr-vs-human-sdr";
export const metadata: Metadata = articleMeta(PATH);

/* The same figures as /guides/ai-sdr-pricing, from components/seo/ga1-prices. */
const AGENT_TOP_YEARLY = TOOL_PRICES.elevenX.entryMonthly * 12;
const AGENT_ENTRY_YEARLY = PLAN_FIGURES.aisdrExplore * 12;

const GARTNER =
  "https://www.gartner.com/en/newsroom/press-releases/2026-07-28-gartner-predicts-ai-agents-will-outnumber-sellers-10-to-1-by-2028-yet-fewer-than-40-percent-of-sellers-will-say-agents-improved-productivity";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";

const FAQ: readonly Faq[] = [
  {
    q: "Will AI replace SDRs?",
    a: "Parts of the job, yes; the whole job, not soon. Research, list building and first drafts are already done well by software. Reading an ambiguous reply, handling a hard objection and building trust with a buying committee still need a person. Gartner predicted in July 2026 that AI agents will outnumber sellers ten to one by 2028, while fewer than 40% of sellers will say agents made them more productive.",
  },
  {
    q: "Is an AI SDR better than an SDR agency?",
    a: "It is cheaper and faster to start, and you keep control of the messages. An agency brings people who can make calls, judge replies and run several channels, and some bring industry experience you do not have. If your problem is volume and consistency, an AI SDR usually wins; if it is judgment and conversations, an agency or a hire does.",
  },
  {
    q: "What can an AI SDR not do?",
    a: "It cannot know what it was not told, so it should never invent a price, a date or a link. It cannot pick up the phone, read the room in a live conversation or build a relationship over months. It also cannot decide your strategy for you: a good one drafts customer profiles and copy and waits for a person to approve them.",
  },
  {
    q: "How long does an outsourced SDR take to ramp?",
    a: `Agencies often promise first meetings within weeks, because they arrive with process and tools. Learning your market well enough to qualify properly takes longer, and published estimates disagree, from a few weeks to three or four months. For comparison, the Bridge Group's 2025 report puts an in-house SDR's average ramp at ${SDR.rampMonths}.0 months.`,
  },
  {
    q: "Do AI SDRs work?",
    a: "They work at the parts of the job that are research and writing, and they fail when left alone with judgment calls. The results people report vary widely, and most published numbers come from vendors. The safest way to find out is a small campaign on one account, with every message read before it goes out.",
  },
];

const SOURCES: readonly Source[] = [
  HUMAN_SOURCES.bridge,
  HUMAN_SOURCES.bls,
  { label: "Gartner: AI agents will outnumber sellers 10 to 1 by 2028 (press release, July 28, 2026)", url: GARTNER },
  HUMAN_SOURCES.revnew,
  HUMAN_SOURCES.gigradar,
  ...TOOL_PRICES.elevenX.sources,
  { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
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
      h1="AI SDR vs human SDR vs SDR agency: which should you use?"
      lede="In the AI SDR vs human SDR question, AI wins on cost, speed and volume of research and writing, and a human wins on judgment, live conversations and relationships; an agency sits between, buying people and process without a hire. For most small teams the best answer is the supervised one: an AI SDR does the work and a person approves what goes out."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">AI SDR vs human SDR: the short answer</h2>
      <CompareTable
        caption={`AI SDR, in-house SDR and SDR agency compared, from the sources on this page, ${PRICES_CHECKED}`}
        columns={["In-house SDR", "Outsourced SDR or agency", "AI SDR"]}
        rows={[
          {
            label: "Yearly cost",
            values: [
              `About ${usd(SDR_LOADED)} fully loaded, before tools`,
              `Roughly ${usd(OUTSOURCED.lowMonthly * 12)} to ${usd(OUTSOURCED.highMonthly * 12)} at ${usd(OUTSOURCED.lowMonthly)} to ${usd(OUTSOURCED.highMonthly)} a month`,
              `From free to about ${usd(AGENT_TOP_YEARLY)} at the best-known agents' entry prices`,
            ],
          },
          { label: "Time to first meetings", values: [`Months: the hire, then about ${SDR.rampMonths} months of ramp`, "Weeks, by agencies' own estimates", "Sending within days of approving a campaign; meetings follow acceptances and replies"] },
          { label: "Best at", values: ["Judgment, calls, relationships", "Process and channels you do not have", "Research, writing and consistency at volume"] },
          { label: "Weakest at", values: ["Cost, churn, consistency", "Knowing your product as well as you do", "Ambiguity, nuance and anything it was not told"] },
          { label: "Who controls the words", values: ["You, through coaching", "The agency, unless you insist on approval", "Depends on the tool: ask"] },
        ]}
      />
      <p>
        Most comparisons of the three are written by somebody selling one of the answers. The AI
        vendors conclude that AI wins; outsourcers conclude that people do. We sell an AI SDR, so read
        this with that in mind. We have tried to say where each option is genuinely better, and to cite
        the numbers rather than assert them.
      </p>

      <h2 id="day-to-day">What each option actually does day to day</h2>
      <p>
        <strong>An in-house SDR</strong> researches accounts, builds lists, writes emails and LinkedIn
        messages, makes calls, follows up, qualifies interest and books meetings for an account
        executive or founder. They learn your product deeply and get better every quarter, and they
        need managing, coaching and tools to do it.
      </p>
      <p>
        <strong>An outsourced SDR or agency</strong> does the same work with its own people, playbooks
        and software, usually across several clients. You trade some control of the message and the
        list for speed and the absence of a hire. The meetings are only as good as the agency&rsquo;s
        understanding of who you sell to.
      </p>
      <p>
        <strong>An AI SDR</strong> does the research and writing parts in software: it builds an
        audience, finds people, writes to each, follows up and handles replies, at a volume and
        consistency no person matches. What it does with judgment calls depends entirely on how it is
        built. Some send everything themselves; others hold anything uncertain for a person.
      </p>

      <h2 id="cost-ramp">Cost and ramp time, sourced</h2>

      <h3 id="in-house">In-house SDR</h3>
      <p>
        Median on-target earnings of {usd(SDR.ote)} in the Bridge Group&rsquo;s{" "}
        <Ext href={HUMAN_SOURCES.bridge.url}>2025 SDR report</Ext> come to about {usd(SDR_LOADED)} a year
        once taxes and benefits are added, before tools, recruiting and management time. The same report
        puts average ramp at {SDR.rampMonths}.0 months, tenure at {SDR.tenureYears} years and only{" "}
        {SDR.atQuotaPercent}% of SDRs at quota. The arithmetic, line by line, is in our{" "}
        <Link href="/guides/ai-sdr-pricing#human-sdr-cost">AI SDR pricing guide</Link>.
      </p>

      <h3 id="outsourced">Outsourced SDR or agency</h3>
      <p>
        Outsourcers publish ranges, not prices. One, Revnew, puts programs at{" "}
        <Ext href={HUMAN_SOURCES.revnew.url}>
          {usd(OUTSOURCED.lowMonthly)} to {usd(OUTSOURCED.highMonthly)} a month
        </Ext>{" "}
        as of {PRICES_CHECKED}, and <Ext href={HUMAN_SOURCES.gigradar.url}>setup fees and three to six month minimums</Ext>{" "}
        are common. Agencies
        claim first meetings within weeks; independent measurements of how long they take to learn a
        market well do not exist that we could find, and the published estimates disagree.
      </p>

      <h3 id="ai">AI SDR</h3>
      <p>
        Entry prices run from free to $3,750 a month as of October 2026, from monthly self-serve plans
        to annual contracts, and our <Link href="/guides/ai-sdr-pricing">pricing guide</Link> lists them
        with sources. Setup takes days, not months. On LinkedIn, though, an AI SDR cannot simply run at full
        speed from day one: a new account should ramp slowly however fast the software is. In Nora an
        account starts at {PUBLIC_LIMITS.invitesPerDayStart} connection requests a day and reaches{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} after about {PUBLIC_LIMITS.warmupWeeks} weeks. The AI&rsquo;s
        ramp is the account&rsquo;s ramp.
      </p>

      <h3 id="cost-per-meeting">Cost per meeting, not cost per month</h3>
      <p>
        Monthly price is the wrong comparison, because the options do not book the same number of
        meetings, and nobody publishes independent meeting rates for AI SDRs that we could find. What you
        can do is ask how many more meetings the expensive option must book to come out level. At the
        prices above, a fully loaded SDR costs about {Math.round(SDR_LOADED / AGENT_TOP_YEARLY * 10) / 10}{" "}
        times as much as the most expensive published AI SDR tier, so they need to book that many times as
        many meetings to match it per meeting. Our pricing guide has a{" "}
        <Link href="/guides/ai-sdr-pricing#cost-per-meeting">worked cost-per-meeting example</Link> with its
        assumptions stated, which you can redo with your own numbers.
      </p>
      <CostBars
        caption={`Yearly cost of each option at the published figures above, as of ${PRICES_CHECKED}. The person approving the work is not counted in any of them.`}
        bars={[
          { label: "Agency, top of the published range", value: OUTSOURCED.highMonthly * 12, note: "Seniority and scope set where in the range you land" },
          { label: "In-house SDR, fully loaded", value: SDR_LOADED, note: "Before tools, recruiting and management time" },
          { label: "Agency, bottom of the published range", value: OUTSOURCED.lowMonthly * 12, note: "Before setup fees and minimum terms" },
          { label: "AI SDR, 11x Growth tier", value: AGENT_TOP_YEARLY, note: "The highest published entry price; billed annually" },
          { label: "AI SDR, AiSDR Explore plan", value: AGENT_ENTRY_YEARLY, note: "Billed quarterly, or less billed annually" },
          { label: "Nora", value: null, note: "Free while we grow, no card" },
        ]}
      />

      <h2 id="better-worse">Where AI is better and where it is worse</h2>

      <h3 id="research-drafting">Research and drafting at scale</h3>
      <p>
        This is where software is simply better. Reading a hundred profiles and writing a note to each
        from that person&rsquo;s own headline, role and company is tedious for a person and trivial for
        a model, and the model does the hundredth as carefully as the first. In Nora, each connection
        note is written for one person, stays within LinkedIn&rsquo;s {INVITE_NOTE_MAX_CHARS}-character
        limit, and shows which of the prospect&rsquo;s details it used, so &ldquo;personalized&rdquo;
        is something you can check rather than take on trust. Software is also better at rules that
        must never slip: nobody contacted twice, every opt-out honored, every send inside the
        day&rsquo;s cap.
      </p>

      <h3 id="judgment">Judgment, relationships and edge cases</h3>
      <p>
        This is where people are better, and where unsupervised AI does damage. A model will answer a
        pricing question fluently whether or not it knows your prices. It will propose &ldquo;Tuesday
        at 3&rdquo; whether or not you are free. It can misread sarcasm, a polite no or a reply about a
        colleague. And it cannot build the slow trust a large deal needs. Gartner&rsquo;s{" "}
        <Ext href={GARTNER}>July 2026 prediction</Ext>, quoted in the questions below, captures the
        same tension from the seller&rsquo;s side.
      </p>

      <h2 id="supervised">The supervised option: AI does the work, a human approves</h2>
      <p>
        Most comparisons present a choice between a person and a machine. The option they leave out is
        the one that combines what each does best: software does the research, writing and sending,
        and a person makes the decisions that carry the risk. That is how Nora is built.
      </p>
      <ul>
        <li>
          <strong>You approve the strategy.</strong> Nora reads your website and drafts customer
          profiles. Nothing is searched for until a person approves one; the agent writes strategies
          and cannot approve them.
        </li>
        <li>
          <strong>You approve the copy and the launch.</strong> Every note is on a review screen before
          launch, and nothing is sent until someone presses the button.
        </li>
        <li>
          <strong>You choose which replies wait for you.</strong> By default Nora drafts each reply
          from your documents and you approve it before it goes. You can switch on autopilot so clean
          replies go out on their own, while replies about pricing, legal questions and negative replies
          still wait for a person; a workspace can release those too. {alwaysHoldsSentence()}
        </li>
        <li>
          <strong>The agent cannot invent facts.</strong> It answers only from the documents you give
          it, offers only meeting times it has actually checked, and a draft containing a link it was
          not given is held for you rather than sent.
        </li>
      </ul>
      <p>
        The person approving does not need to be an SDR. In a small company it is usually the founder,
        spending a few minutes a day in the inbox rather than hours writing. See{" "}
        <Link href="/how-it-works">how Nora works step by step</Link>.
      </p>
      <p>
        Whichever you choose, somebody&rsquo;s LinkedIn account does the sending, and LinkedIn&rsquo;s{" "}
        <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated access. Ask every option how many requests
        a day it sends and who approves them.
      </p>

      <h2 id="by-stage">Which to choose, by stage of company</h2>
      <ul className="ga1-stages">
        <li className="ga1-stage">
          <p className="ga1-stage-pick">You, with an AI SDR drafting</p>
          <p className="ga1-stage-title">Founder-led, before a repeatable sale</p>
          <p>
            Do the conversations yourself, because what you learn from them is the point. Let software find people and
            draft the first message so your hours go into replies. See{" "}
            <Link href="/for/small-business">Nora for small businesses</Link>.
          </p>
        </li>
        <li className="ga1-stage">
          <p className="ga1-stage-pick">A supervised AI SDR</p>
          <p className="ga1-stage-title">Early sales motion, no sales team</p>
          <p>
            Cover the top of the funnel while you test which customer profiles and angles work, before you commit{" "}
            {usd(SDR_LOADED)} a year to a hire.
          </p>
        </li>
        <li className="ga1-stage">
          <p className="ga1-stage-pick">Hire SDRs, give them AI</p>
          <p className="ga1-stage-title">Repeatable motion, larger deals</p>
          <p>Their judgment is worth the cost once each meeting is worth a lot. Software takes the research and drafting.</p>
        </li>
        <li className="ga1-stage">
          <p className="ga1-stage-pick">An agency</p>
          <p className="ga1-stage-title">Coverage now, across channels, without hiring</p>
          <p>The honest answer, especially for phone-heavy outreach. Insist on approving the messages and the list.</p>
        </li>
      </ul>
      <p>
        Comparing AI tools next? The{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link> gives seven
        questions to put to any vendor.
      </p>
    </ArticleLayout>
  );
}
