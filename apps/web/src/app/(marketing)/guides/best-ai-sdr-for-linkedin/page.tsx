import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { Json } from "@/components/schema";
import { PRICES_CHECKED, TOOL_PRICES, priceSources, type ToolId } from "@/components/seo/ga1-prices";
import { PUBLIC_LIMITS, canonical } from "@/lib/site";

const PATH = "/guides/best-ai-sdr-for-linkedin";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "What is the best AI SDR for LinkedIn?",
    a: "The one that keeps your account inside safe limits, writes to each person from their own details, and lets you approve the audience, the copy and the launch. For one person or a small team selling on LinkedIn, that usually means a LinkedIn-first AI SDR. Agencies running dozens of senders are better served by a sequence tool, and email-heavy teams by an email-first agent.",
  },
  {
    q: "Are AI SDRs fully autonomous?",
    a: "Some are sold that way, and most let you choose. Email-first agents such as 11x are pitched as autonomous; others offer review before sending. Full autonomy on LinkedIn is a bigger risk than on email, because every message goes out from your own personal account. At minimum you should approve who is targeted and what is said, and decide which replies wait for you.",
  },
  {
    q: "Which AI SDR works on LinkedIn?",
    a: "LinkedIn-first AI SDRs such as Valley and Nora are built around it. Email-first agents such as Artisan, 11x, AiSDR, Reply.io’s Jason and Salesforge’s Agent Frank include LinkedIn steps alongside email. Sequence tools such as Expandi, HeyReach, Waalaxy and Dripify work on LinkedIn but leave targeting, writing and replies to you, often with AI writing help added on top.",
  },
  {
    q: "Why do teams churn from AI SDRs?",
    a: "We have seen no independent churn study, and figures quoted online are mostly vendors describing competitors. The reasons buyers give in public reviews are consistent: annual contracts signed before results were proven, messages that read as generic, replies handled badly, and setup taking longer than the demo suggested. Each maps to a question in this guide.",
  },
  {
    q: "How much does an AI SDR cost?",
    a: "As of October 2026, from about $40 a month to about $45,000 a year at entry pricing. LinkedIn sequence tools cost roughly $40 to $100 per account a month, Valley $149 to $199 a seat, self-serve AI SDR agents from Artisan and AiSDR start around $250 a month, and 11x’s Growth tier is $3,750 a month billed annually. Larger volumes are quoted. Nora starts with a 14-day free trial with no card, and its plans are on the pricing page.",
  },
];

/** Every priced tool on this page, in the order the price table shows them. */
const PRICED: readonly ToolId[] = [
  "artisan",
  "elevenX",
  "aisdr",
  "amplemarket",
  "reply",
  "salesforge",
  "valley",
  "clay",
  "expandi",
  "heyreach",
  "waalaxy",
  "dripify",
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Automated activity on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/90586" },
  ...priceSources(PRICED),
  { label: "Salesforge: Agent Frank vs AiSDR, Auto-Pilot and Co-Pilot modes (Salesforge’s own page)", url: "https://www.salesforge.ai/comparison/agent-frank-vs-aisdr" },
  { label: "Waalaxy: FAQ on the Waalaxy Cloud and the free plan", url: "https://www.waalaxy.com/blog/linkedin-automation-software/waalaxy-faq" },
  { label: "HeyReach: LinkedIn connection automation, sender rotation and limits (HeyReach’s own blog)", url: "https://www.heyreach.io/blog/linkedin-connection-automation-tool" },
  { label: "Expandi: Expandi vs Dux-Soup, cloud with a dedicated address per account (Expandi’s own page)", url: "https://expandi.io/expandi-vs-dux-soup/" },
  { label: "Dripify: FAQ, runs with your browser closed", url: "https://dripify.com/faq/" },
];

const TOOLS = [...PRICED.map((id) => TOOL_PRICES[id].name), "Nora"];

const PRICES = [
  ...PRICED.map((id) => ({
    label: TOOL_PRICES[id].name,
    values: [TOOL_PRICES[id].model, TOOL_PRICES[id].price, TOOL_PRICES[id].billing],
  })),
  { label: "Nora", values: ["Two plans", "See the pricing page", "Monthly or yearly, after a 14-day free trial with no card"] },
];

/*
 * One card per tool: what it is, who it suits and how it treats LinkedIn,
 * from each vendor's own pages as of PRICES_CHECKED. The price line is read
 * from the shared dataset so this page and the pricing guide cannot disagree.
 */
const CARDS: ReadonlyArray<{ id: ToolId; slug: string; what: string; suits: string; linkedin: string }> = [
  {
    id: "elevenX",
    slug: "11x",
    what: "An autonomous AI SDR, Alice, sold as outbound SDR capacity and built around email.",
    suits: "Teams whose buyers answer email, with budget for an annual contract.",
    linkedin: "One channel among several. Ask what it sends on LinkedIn, and at what daily volume, before you sign.",
  },
  {
    id: "artisan",
    slug: "artisan",
    what: "An AI BDR, Ava, that prospects, researches and writes. Self-serve since May 2026; larger volumes are quoted.",
    suits: "Email-heavy teams that want to start on a monthly plan before committing.",
    linkedin: "LinkedIn steps alongside email. Reviews describe a choice between autonomous and reviewed sending.",
  },
  {
    id: "aisdr",
    slug: "aisdr",
    what: "An AI SDR priced by leads a month, with a set number of mailboxes and LinkedIn accounts on each plan.",
    suits: "Small teams running email and LinkedIn together who can commit quarterly.",
    linkedin: "Included on every plan, with more LinkedIn accounts on the larger ones.",
  },
  {
    id: "amplemarket",
    slug: "amplemarket",
    what: "An all-in-one outbound platform: contact data, sequences, AI writing, intent signals and deliverability.",
    suits: "Sales teams that want data and sending in one tool on an annual term.",
    linkedin: "LinkedIn automation is bundled rather than sold as an add-on.",
  },
  {
    id: "reply",
    slug: "reply",
    what: "Reply.io’s AI SDR, Jason, which builds and runs multichannel sequences and is priced by active contacts.",
    suits: "Teams already running sequences across email, LinkedIn and calls.",
    linkedin: "Connection requests, profile views and messages as sequence steps, with branches when someone accepts.",
  },
  {
    id: "salesforge",
    slug: "salesforge",
    what: "Salesforge’s AI SDR, Agent Frank, sold through a demo, with about two weeks of mailbox warm-up before it sends.",
    suits: "Cold email teams that want an agent, with the option to review its drafts.",
    linkedin: "Email and LinkedIn in one sequence. Co-Pilot mode waits for your approval; Auto-Pilot does not.",
  },
  {
    id: "clay",
    slug: "clay",
    what: "Not an AI SDR: a data platform that finds and enriches lists, then hands them to a sending tool. Unlimited seats.",
    suits: "Operations-minded teams building precise lists for another tool to send.",
    linkedin: "Sends nothing itself, so the account risk sits with whichever tool does the sending.",
  },
  {
    id: "valley",
    slug: "valley",
    what: "A LinkedIn-first outreach platform priced per seat, with email added on higher tiers.",
    suits: "Founders and small teams for whom LinkedIn is the channel that works.",
    linkedin: "The main channel; the product is built around it.",
  },
  {
    id: "expandi",
    slug: "expandi",
    what: "A cloud LinkedIn sequencer, priced per account, which says it gives each account a fixed address in its own country.",
    suits: "People who write their own copy and want direct control of each step.",
    linkedin: "LinkedIn only. You set the volume, so check its settings against the caps further up this page.",
  },
  {
    id: "heyreach",
    slug: "heyreach",
    what: "A cloud LinkedIn sequencer priced per sender, with flat plans for agencies and one inbox across accounts.",
    suits: "Agencies running outreach for clients from many LinkedIn profiles.",
    linkedin: "Spreads a campaign across several sender accounts; each account still carries its own risk.",
  },
  {
    id: "waalaxy",
    slug: "waalaxy",
    what: "A LinkedIn tool set up through a Chrome extension. Paid plans run in its cloud; the free plan needs your browser open.",
    suits: "Individuals starting small who want a free plan to try the idea.",
    linkedin: "The main channel, with email sequences on the top plan.",
  },
  {
    id: "dripify",
    slug: "dripify",
    what: "A cloud LinkedIn sequencer priced per user that keeps running with your browser closed.",
    suits: "Individuals and small teams who already know what they want to say.",
    linkedin: "LinkedIn only. A trial rather than a free plan.",
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="Best AI SDR tools for LinkedIn in 2026: how to choose one"
      lede="The best AI SDR tools for LinkedIn keep your account inside safe limits, write to each person from their own details, and let you approve the audience, the copy and the launch before anyone is contacted. Which one suits you depends on whether LinkedIn or email is your channel and how many sending accounts you run."
      faq={FAQ}
      sources={SOURCES}
    >
      <Json
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "AI SDR and LinkedIn outreach tools compared in this guide",
          url: canonical(PATH),
          itemListElement: TOOLS.map((name, i) => ({ "@type": "ListItem", position: i + 1, name })),
        }}
      />
      <Callout tone="info">
        <div className="ga1-summary">
          <p>
            <strong>The short version</strong>
          </p>
          <ul>
            <li>
              <strong>Three kinds of tool:</strong> email-first AI SDRs that add LinkedIn steps, LinkedIn-first AI SDRs,
              and LinkedIn sequence tools that send what you write.
            </li>
            <li>
              <strong>Judge each on seven questions</strong> about caps, ramp, pacing, approval, repeat contact, opt-outs
              and invented details.
            </li>
            <li>
              <strong>Prices as of {PRICES_CHECKED}</strong> run from free plans to $3,750 a month at entry, with{" "}
              <a href="#prices">every figure sourced</a>.
            </li>
          </ul>
        </div>
      </Callout>
      <p>
        Most &ldquo;best AI SDR tools&rdquo; lists are written by vendors and rank their author first, and almost all are email-first:
        LinkedIn account safety barely appears. This guide is written by a vendor too, so it gives you the questions to rank
        tools yourself, including us, and says plainly where Nora is the wrong choice.
      </p>

      <h2 id="ai-sdr-vs-automation">AI SDR or LinkedIn automation tool? The difference</h2>
      <p>
        A <strong>LinkedIn automation tool</strong> sends what you tell it: a connection request, then a series of templated
        follow-ups on a timer. You choose the audience, write the copy and answer the replies. An <strong>AI SDR</strong> does the
        job of a sales development rep: it decides or proposes who to go after, finds them, writes to each one, follows up, reads
        replies, answers the ones it can and books meetings. The line is blurring, because most sequence tools now add AI writing.
      </p>
      <p>The job an AI SDR is doing on LinkedIn is the same whatever the product calls itself:</p>
      <ol>
        <li>Decide who to go after, from what your business sells and who actually buys it.</li>
        <li>Find real people who match, and drop anybody already contacted or excluded.</li>
        <li>Write a connection request each person would recognize as written to them.</li>
        <li>Follow up after they accept, at a pace that reads as a person.</li>
        <li>Read replies correctly, answer the ones it can, and stop at &ldquo;no&rdquo;.</li>
        <li>Offer real times and book the meeting.</li>
      </ol>
      <p>
        Every step can go wrong in front of a real person under your name, from your personal account. That is the difference
        from email, where a bad message costs a sending domain. On LinkedIn it costs the profile you built your career on.
      </p>

      <h2 id="seven-questions">Seven questions that separate a safe AI SDR from a risky one</h2>
      <p>
        LinkedIn&rsquo;s terms prohibit automated activity, so no tool can promise zero risk. These questions decide how much risk a
        tool adds. Ask them in the demo and ask to be shown, not told.
      </p>

      <h3 id="caps">Are the caps published?</h3>
      <p>
        Ask for the daily and weekly invitation caps in numbers, whether they are enforced or only suggested, and whether a
        pricier plan raises them. A daily cap with no weekly ceiling lets a busy Monday spend the week. Nora&rsquo;s are published
        and are product rules: {PUBLIC_LIMITS.invitesPerDayStart} invitations a day at the start, at most{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} after the warm-up, never more than {PUBLIC_LIMITS.invitesPerWeek} a week, and{" "}
        {PUBLIC_LIMITS.messagesPerDay} messages a day. The <Link href="/linkedin-automation-limits">LinkedIn limits page</Link>{" "}
        explains each one.
      </p>

      <h3 id="ramp">When does the ramp start?</h3>
      <p>
        A warm-up measured from the day you connected an account hands one that has never sent anything its full allowance on its
        first day of sending. Ask whether the clock starts at connection or at the first send. Nora&rsquo;s ramp runs over{" "}
        {PUBLIC_LIMITS.warmupWeeks} weeks from the first send.
      </p>

      <h3 id="pace">How is a day paced?</h3>
      <p>
        A cap says how many, not when. Ask how a day&rsquo;s allowance is spread: our own first live account was refused invitations
        for days after sending seven in 27 minutes inside its cap, as{" "}
        <Link href="/guides/is-linkedin-automation-safe#seven-in-27">our safety guide explains</Link>. Nora now divides a
        day&rsquo;s allowance across your working hours. Ask too what happens on LinkedIn&rsquo;s first &ldquo;try again later&rdquo;: hours of
        silence, or another attempt in minutes.
      </p>

      <h3 id="approval">Does a human approve strategy, copy and launch?</h3>
      <p>
        The safest tools make three decisions yours: the audience, the words and the launch. A tool that writes its own strategy
        should not also approve it, and a campaign should arrive as a draft you can read, not something already running. Ask to
        see five notes from one campaign side by side; if they are the same sentence with a different name, it personalizes a
        template, not a message. In Nora each note is written from the person&rsquo;s own details, in {INVITE_NOTE_MAX_CHARS}{" "}
        characters or fewer, with the details it used shown on the review screen.
      </p>

      <h3 id="twice">Does it ever contact someone twice?</h3>
      <p>
        The second message a stranger gets from the same company under a different pretext makes the first look like a mail
        merge. Ask whether a person contacted by one campaign can be reached by another, and whether exclusions are checked
        immediately before each send or only when a list is built. In Nora, once somebody has been contacted from a workspace, no
        campaign can invite them again, checked right before the send.
      </p>

      <h3 id="opt-outs">How are opt-outs detected?</h3>
      <p>
        &ldquo;Please remove me&rdquo; must stop everything, every time. Ask whether that depends on the model reading the message
        correctly, or whether there is a plain check in code as well. Nora does both: an opt-out phrase is caught before any model
        is asked, and the model&rsquo;s reading is a second line, not the only one.
      </p>

      <h3 id="invent">Can it invent links or meeting times?</h3>
      <p>
        Language models write a plausible date or URL fluently and wrongly. Ask where offered meeting times come from, and what
        stops a made-up link or price. In Nora the times offered come only from a list of free slots computed from your calendar,
        booking re-checks the slot before it is taken, and a draft containing a link the agent was not given is held for you
        rather than sent.
      </p>
      <Callout tone="safety">
        <p>
          Our guide to the <Link href="/guides/safest-linkedin-automation-tool">safest LinkedIn automation tool</Link> turns these
          into eight checks and a table of what each vendor publishes.{" "}
          <Link href="/guides/cloud-vs-browser-extension-linkedin-automation">Cloud vs Chrome extension automation</Link> covers
          the architecture question, which matters less than these.
        </p>
      </Callout>

      <h2 id="approaches">Best AI SDR tools: the main approaches compared</h2>

      <h3 id="email-first">Email-first AI SDRs (Artisan, 11x and others)</h3>
      <p>
        Autonomous agents that prospect, research and write across channels, built around email. Third-party reviews describe 11x
        as pitched at replacing outbound SDR capacity and Artisan as offering a choice between autonomous and reviewed sending.
        LinkedIn is one channel among several. Their strength is volume and research across email; if LinkedIn is your main
        channel, put the seven questions above to them before you sign. AiSDR, Amplemarket, Reply.io&rsquo;s Jason and
        Salesforge&rsquo;s Agent Frank belong here too: each runs LinkedIn steps inside an email-led sequence. Our{" "}
        <Link href="/alternatives/artisan">Artisan alternatives page</Link> compares in more detail.
      </p>

      <h3 id="linkedin-first">LinkedIn-first AI SDRs (Valley, Nora)</h3>
      <p>
        Agents built around LinkedIn: they plan the audience, write per person, follow up and handle replies, with
        LinkedIn&rsquo;s limits as the central constraint. Valley publishes per-seat pricing and adds email on its higher tiers.
        Nora is LinkedIn only, approval-first and free to try for 14 days. Both
        suit founders, consultants and small teams for whom LinkedIn is the channel that works.
      </p>

      <h3 id="sequence-tools">Sequence tools (Expandi, HeyReach, Waalaxy, Dripify)</h3>
      <p>
        Tools that send connection requests and a fixed series of follow-ups, increasingly with AI writing help. You keep
        targeting, copy and replies. They are cheaper per account and give direct control of every step. HeyReach&rsquo;s flat
        multi-sender pricing suits agencies; Expandi, Waalaxy and Dripify suit individuals and small teams who already know what
        they want to say. Compare them in detail on our{" "}
        <Link href="/alternatives/heyreach">HeyReach</Link>, <Link href="/alternatives/expandi">Expandi</Link>,{" "}
        <Link href="/alternatives/waalaxy">Waalaxy</Link> and <Link href="/alternatives/dripify">Dripify</Link> pages. If what you
        actually need is scraping and data workflows, see <Link href="/alternatives/phantombuster">PhantomBuster alternatives</Link>.
      </p>

      <h2 id="tools">The tools one by one</h2>
      <p>
        What each tool is, who it suits and how it treats LinkedIn, from each vendor&rsquo;s own pages as of {PRICES_CHECKED}.
        No ratings: the seven questions above are the test, and you are better placed to run it than we are to score
        competitors. Clay is here because it is often shortlisted next to AI SDRs, though it sends nothing itself. Prices
        follow in <a href="#prices">one table</a>.
      </p>
      <ul className="ga1-tools">
        {CARDS.map((card) => {
          const tool = TOOL_PRICES[card.id];
          return (
            <li key={card.id} className="ga1-tool">
              <h3 id={`tool-${card.slug}`}>{tool.name}</h3>
              <p>{card.what}</p>
              <dl>
                <div>
                  <dt>Best for</dt>
                  <dd>{card.suits}</dd>
                </div>
                <div>
                  <dt>On LinkedIn</dt>
                  <dd>{card.linkedin}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>

      <h2 id="prices">Prices as of October 2026, with sources</h2>
      <p>
        Prices below come from vendors&rsquo; own pages and blogs, checked in {PRICES_CHECKED}, and are the same figures our{" "}
        <Link href="/guides/ai-sdr-pricing">AI SDR pricing guide</Link> uses. Where a vendor&rsquo;s own pages disagree we say
        so. Check the live pricing page before you buy; these change often.
      </p>
      <CompareTable
        caption={`AI SDR and LinkedIn outreach tool prices as published in ${PRICES_CHECKED}`}
        columns={["Pricing model", "Reported price", "Billing"]}
        rows={PRICES}
      />
      <p>
        Price the plan at the volume your account can safely send, not the volume the plan allows: a single LinkedIn account
        should not send more than about {PUBLIC_LIMITS.invitesPerWeek} invitations a week, however many credits a plan includes.
        The pricing guide compares these with the cost of hiring, including a worked cost-per-meeting example, and{" "}
        <Link href="/guides/ai-sdr-vs-human-sdr">AI SDR vs human SDR</Link> covers when a person is still the better hire.
      </p>

      <h2 id="who-suits">Who each suits</h2>
      <ul>
        <li>
          <strong>You sell to people who answer email, have budget and want volume:</strong> an email-first agent. Negotiate a
          short first term.
        </li>
        <li>
          <strong>You run outreach for clients from many LinkedIn profiles:</strong> a multi-sender sequence tool with flat pricing.
        </li>
        <li>
          <strong>You are one person who writes well and wants control of every message:</strong> a low-cost sequence tool, used
          slowly.
        </li>
        <li>
          <strong>You are a founder, consultant or small team, LinkedIn is where your buyers answer, and you want the targeting,
          writing and replies done for you with your approval:</strong> a LinkedIn-first AI SDR.
        </li>
        <li>
          <strong>You cannot afford any restriction on your profile:</strong> none of them. Send by hand.
        </li>
      </ul>

      <h2 id="where-nora-fits">Where Nora fits, and where it does not (no email channel)</h2>
      <p>
        Nora is a LinkedIn-first AI SDR. It reads your website and drafts customer profiles; you approve one before anything is
        searched. It finds real people, opens each profile before it reaches the list, and writes one connection note per person.
        You launch the campaign. It sends inside the caps above, spread across your working hours, and drafts each reply from the
        facts you gave it for you to approve; switch on autopilot and the clean ones go out on their own. It offers meeting times
        only from the free slots in its booking calendar.{" "}
        <Link href="/how-it-works">How Nora works</Link> covers every step, and you can try it free for 14 days with no
        card. The <Link href="/free-linkedin-automation-tool">free LinkedIn automation tool</Link> page says what the trial
        includes, and the <Link href="/pricing">pricing page</Link> lists the plans after it.
      </p>
      <p>What it does not do, as of October 2026:</p>
      <ul>
        <li>
          <strong>No email channel.</strong> Nora works on LinkedIn only. Following up by email with people who accept and go quiet
          is on the roadmap, not in the product. If your buyers live in their inbox, choose an email-first tool.
        </li>
        <li>
          <strong>Not built around dozens of senders in one place.</strong> Each LinkedIn account is connected by its own owner
          and runs under its own caps; an agency managing many client profiles is better served by a multi-sender tool.
        </li>
        <li>
          <strong>Clicks are not measured.</strong> Nora does not wrap your links in a tracking redirect.
        </li>
        <li>
          <strong>It does not read your Google Calendar.</strong> Its booking calendar knows the meetings it booked, the times you
          block out and any calendar feed you add, and nothing else; meetings booked on your own scheduling link are not counted.
        </li>
        <li>
          <strong>Search is only as precise as your LinkedIn tier.</strong> Without Sales Navigator, seniority and company size
          cannot be filtered, and the campaign names the filters it dropped before you launch.
        </li>
      </ul>
      <p>
        Head-to-head comparisons with each of these tools are on the <Link href="/alternatives">alternatives hub</Link>.
      </p>

      <h2 id="test">A 30-minute test you can run on any tool</h2>
      <p>
        Six steps that put most of the seven questions to work on a trial account. Pacing needs a full day of sending to judge,
        so check the first day&rsquo;s send times separately.
      </p>
      <ol>
        <li>Connect an account and check what the first day&rsquo;s allowance is (caps and ramp).</li>
        <li>Build a campaign and read ten notes. Count how many could only be for that person (approval).</li>
        <li>Find the launch button and confirm nothing has gone out before you press it (approval).</li>
        <li>Send a test reply saying &ldquo;please remove me&rdquo; and see what happens next (opt-outs).</li>
        <li>Ask a pricing question that is not on your website and see whether it invents an answer (invented details).</li>
        <li>Add a contacted person to a second campaign and see whether they are dropped (repeat contact).</li>
      </ol>
      <p>Run it on Nora too: nothing is sent until you launch.</p>
    </ArticleLayout>
  );
}
