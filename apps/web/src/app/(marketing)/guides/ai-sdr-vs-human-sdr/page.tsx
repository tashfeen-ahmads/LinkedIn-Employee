import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/guides/ai-sdr-vs-human-sdr";
export const metadata: Metadata = articleMeta(PATH);

/*
 * Bridge Group 2025: median OTE $80K, ramp 3.0 months, tenure 1.9 years, 60%
 * at quota. BLS ECEC June 2026: pay is 68.5% of a full-time private-industry
 * worker's cost. The same arithmetic as /guides/ai-sdr-pricing.
 */
const SDR_OTE = 80_000;
const WAGE_SHARE_FULL_TIME = 0.685;
const LOADED = Math.round(SDR_OTE / WAGE_SHARE_FULL_TIME / 1000) * 1000;
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

const BRIDGE = "https://www.bridgegroupinc.com/research/2025-sdr-models-metrics-report-the-bridge-group";
const BLS = "https://www.bls.gov/opub/ted/2026/compensation-costs-for-private-industry-workers-averaged-46-89-per-hour-worked-in-june-2026.htm";
const GARTNER =
  "https://www.gartner.com/en/newsroom/press-releases/2026-07-28-gartner-predicts-ai-agents-will-outnumber-sellers-10-to-1-by-2028-yet-fewer-than-40-percent-of-sellers-will-say-agents-improved-productivity";
const REVNEW = "https://revnew.com/blog/sdr-outsourcing-cost";
const GIGRADAR = "https://gigradar.io/blog/outsource-sales";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";

const FAQ: readonly Faq[] = [
  {
    q: "Will AI replace SDRs?",
    a: "Parts of the job, yes; the whole job, not soon. Research, list building and first drafts are already done well by software. Reading an ambiguous reply, handling a hard objection and building trust with a buying committee still need a person. Gartner predicted in July 2026 that AI agents will outnumber sellers ten to one by 2028, while fewer than 40% of sellers will say agents made them more productive.",
  },
  {
    q: "Is an AI SDR better than an SDR agency?",
    a: "It is cheaper and faster to start, and you keep control of the messages. An agency brings people who can make calls, judge replies and run several channels, and some bring industry experience you do not have. If your problem is volume and consistency, an AI SDR usually wins; if it is judgement and conversations, an agency or a hire does.",
  },
  {
    q: "What can an AI SDR not do?",
    a: "It cannot know what it was not told, so it should never invent a price, a date or a link. It cannot pick up the phone, read the room in a live conversation or build a relationship over months. It also cannot decide your strategy for you: a good one drafts customer profiles and copy and waits for a person to approve them.",
  },
  {
    q: "How long does an outsourced SDR take to ramp?",
    a: "Agencies often promise first meetings within weeks, because they arrive with process and tools. Learning your market well enough to qualify properly takes longer, and published estimates disagree, from a few weeks to three or four months. For comparison, the Bridge Group's 2025 report puts an in-house SDR's average ramp at 3.0 months.",
  },
  {
    q: "Do AI SDRs work?",
    a: "They work at the parts of the job that are research and writing, and they fail when left alone with judgement calls. The results people report vary widely, and most published numbers come from vendors. The safest way to find out is a small campaign on one account, with every message read before it goes out.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "The Bridge Group: 2025 SDR models and metrics report", url: BRIDGE },
  { label: "US Bureau of Labor Statistics: employer compensation costs, June 2026", url: BLS },
  { label: "Gartner: AI agents will outnumber sellers 10 to 1 by 2028 (press release, 28 July 2026)", url: GARTNER },
  { label: "Revnew: SDR outsourcing cost (an outsourcing provider)", url: REVNEW },
  { label: "GigRadar: outsourcing sales, retainers, setup fees and minimums", url: GIGRADAR },
  { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
  { label: "Bitscale: AI SDR vs human SDR (a vendor comparison, studied for this page)", url: "https://bitscale.ai/blogs/ai-sdr-vs-human-sdr" },
  { label: "Autobound: AI SDR vs human SDR (a vendor comparison, studied for this page)", url: "https://www.autobound.ai/blog/ai-sdr-vs-human-sdr" },
  { label: "Instantly: AI SDR vs human SDR (a vendor comparison, studied for this page)", url: "https://instantly.ai/blog/ai-sdr-vs-human-sdr-comparison/" },
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
      lede="In the AI SDR vs human SDR question, AI wins on cost, speed and volume of research and writing, and a human wins on judgement, live conversations and relationships; an agency sits between, buying people and process without a hire. For most small teams the best answer is the supervised one: an AI SDR does the work and a person approves what goes out."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">AI SDR vs human SDR: the short answer</h2>
      <CompareTable
        caption="AI SDR, in-house SDR and SDR agency compared, from the sources on this page, October 2026"
        columns={["In-house SDR", "Outsourced SDR or agency", "AI SDR"]}
        rows={[
          {
            label: "Yearly cost",
            values: [`About ${usd(LOADED)} fully loaded, before tools`, "Roughly $48,000 to $216,000 at $4,000 to $18,000 a month", "Free to tens of thousands"],
          },
          { label: "Time to first meetings", values: ["Months: hire, then about 3 to ramp", "Weeks, by agencies' own estimates", "Sending within days of approving a campaign; meetings follow acceptances and replies"] },
          { label: "Best at", values: ["Judgement, calls, relationships", "Process and channels you do not have", "Research, writing and consistency at volume"] },
          { label: "Weakest at", values: ["Cost, churn, consistency", "Knowing your product as well as you do", "Ambiguity, nuance and anything it was not told"] },
          { label: "Who controls the words", values: ["You, through coaching", "The agency, unless you insist on approval", "Depends on the tool: ask"] },
        ]}
      />
      <p>
        Most pages ranking for this question are written by somebody selling one of the three answers.
        The AI vendors conclude that AI wins; outsourcers conclude that people do. We sell an AI SDR,
        so read this with that in mind. We have tried to say where each option is genuinely better, and
        to cite the numbers rather than assert them.
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
        consistency no person matches. What it does with judgement calls depends entirely on how it is
        built. Some send everything themselves; others hold anything uncertain for a person.
      </p>

      <h2 id="cost-ramp">Cost and ramp time, sourced</h2>

      <h3 id="in-house">In-house SDR</h3>
      <p>
        The Bridge Group&rsquo;s <Ext href={BRIDGE}>2025 SDR report</Ext> puts median on-target
        earnings at {usd(SDR_OTE)}, average ramp at 3.0 months, and average tenure at 1.9 years. Only
        60% of SDRs were at quota, the lowest in the study&rsquo;s history. Adding taxes and benefits,
        using the <Ext href={BLS}>Bureau of Labor Statistics figure</Ext> that pay is 68.5% of a
        full-time private-sector employee&rsquo;s cost, brings the yearly cost to about {usd(LOADED)},
        before tools, recruiting and management time. The full breakdown is in our{" "}
        <Link href="/guides/ai-sdr-pricing">AI SDR pricing guide</Link>.
      </p>

      <h3 id="outsourced">Outsourced SDR or agency</h3>
      <p>
        Outsourcers publish ranges, not prices. One, Revnew, puts programmes at{" "}
        <Ext href={REVNEW}>$4,000 to $18,000 a month</Ext> as of October 2026, and{" "}
        <Ext href={GIGRADAR}>setup fees and three to six month minimums</Ext> are common. Agencies
        claim first meetings within weeks; independent measurements of how long they take to learn a
        market well do not exist that we could find, and the published estimates disagree.
      </p>

      <h3 id="ai">AI SDR</h3>
      <p>
        Prices run from free to several thousand dollars a month, often on annual or quarterly
        contracts, and our <Link href="/guides/ai-sdr-pricing">pricing guide</Link> lists them with
        dates. Setup takes days, not months. On LinkedIn, though, an AI SDR cannot simply run at full
        speed from day one: a new account should ramp slowly however fast the software is. In Nora an
        account starts at {PUBLIC_LIMITS.invitesPerDayStart} connection requests a day and reaches{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} after about {PUBLIC_LIMITS.warmupWeeks} weeks. The AI&rsquo;s
        ramp is the account&rsquo;s ramp.
      </p>

      <h2 id="better-worse">Where AI is better and where it is worse</h2>

      <h3 id="research-drafting">Research and drafting at scale</h3>
      <p>
        This is where software is simply better. Reading a hundred profiles and writing a note to each
        from that person&rsquo;s own headline, role and company is tedious for a person and trivial for
        a model, and the model does the hundredth as carefully as the first. In Nora, each connection
        note is written for one person, stays under LinkedIn&rsquo;s {INVITE_NOTE_MAX_CHARS}-character
        limit, and shows which of the prospect&rsquo;s details it used, so &ldquo;personalised&rdquo;
        is something you can check rather than take on trust. Software is also better at rules that
        must never slip: nobody contacted twice, every opt-out honoured, every send inside the
        day&rsquo;s cap.
      </p>

      <h3 id="judgement">Judgement, relationships and edge cases</h3>
      <p>
        This is where people are better, and where unsupervised AI does damage. A model will answer a
        pricing question fluently whether or not it knows your prices. It will propose &ldquo;Tuesday
        at 3&rdquo; whether or not you are free. It can misread sarcasm, a polite no or a reply about a
        colleague. And it cannot build the slow trust a large deal needs. Gartner&rsquo;s{" "}
        <Ext href={GARTNER}>July 2026 prediction</Ext> captures the tension: AI agents outnumbering
        sellers ten to one by 2028, and fewer than 40% of sellers saying agents improved their
        productivity.
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
          <strong>You choose which replies wait for you.</strong> By default, replies about pricing,
          legal questions and negative replies are held for a person. A workspace can let the agent
          answer those too. Two kinds always wait whatever the setting: a message the agent could not
          read confidently, and a prospect asking to speak to a human. An opt-out stops everything.
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
      <Callout tone="safety">
        <p>
          Whichever option you choose, somebody&rsquo;s LinkedIn account does the sending.
          LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated access, so
          an AI SDR, a sequencer or an agency&rsquo;s software all carry some risk to that account. Ask
          every option how many requests a day it sends and who approves them.
        </p>
      </Callout>

      <h2 id="by-stage">Which to choose, by stage of company</h2>
      <ul>
        <li>
          <strong>Founder-led, before a repeatable sale.</strong> Do the conversations yourself, because
          what you learn from them is the point. Use an AI SDR to find people and draft the first
          message so your hours go into replies, not research. This is where a supervised, free tool
          makes most sense; see <Link href="/for/small-business">Nora for small businesses</Link>.
        </li>
        <li>
          <strong>Early sales motion, no sales team.</strong> A supervised AI SDR covers the top of the
          funnel while you test which customer profiles and angles work, before you commit{" "}
          {usd(LOADED)} a year to a hire.
        </li>
        <li>
          <strong>Repeatable motion, larger deals.</strong> Hire SDRs and give them AI for research and
          drafting. Their judgement is worth the cost once each meeting is worth a lot.
        </li>
        <li>
          <strong>Need coverage now, across channels, without hiring.</strong> An agency is the honest
          answer, especially for phone-heavy outreach. Insist on approving the messages and the list.
        </li>
      </ul>
      <p>
        Comparing AI tools next? The{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        gives eight questions to put to any vendor, and the <Link href="/guides">outreach guides</Link>{" "}
        cover the rest.
      </p>
      <Callout tone="info">
        <p>
          Try the supervised option on one account. <a href={`${SITE.app}/signup`}>Sign up free</a>;
          nothing is sent until you approve it.
        </p>
      </Callout>
    </ArticleLayout>
  );
}
