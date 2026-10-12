import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { Json } from "@/components/schema";
import { PUBLIC_LIMITS, SITE, canonical } from "@/lib/site";

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
    a: "LinkedIn-first AI SDRs such as Valley and Nora are built around it. Email-first agents such as Artisan and 11x treat LinkedIn as one channel among several. Sequence tools such as Expandi, HeyReach, Waalaxy and Dripify work on LinkedIn but leave targeting, writing and replies to you, often with AI writing help added on top.",
  },
  {
    q: "Why do teams churn from AI SDRs?",
    a: "We have seen no independent churn study, and figures quoted online are mostly vendors describing competitors. The reasons buyers give in public reviews are consistent: annual contracts signed before results were proven, messages that read as generic, replies handled badly, and setup taking longer than the demo suggested. Each maps to a question in this guide.",
  },
  {
    q: "How much does an AI SDR cost?",
    a: "As of October 2026, from nothing to tens of thousands of dollars a year. Reported prices run from Valley's published $149 to $199 a month per seat, through LinkedIn sequence tools at roughly $40 to $100 per account, to annual contracts for 11x reported at $45,000 to $60,000. Artisan quotes by volume. Nora is free while it grows, with no card.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Automated activity on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/90586" },
  { label: "Guideflow: best AI SDR tools (studied for this page)", url: "https://www.guideflow.com/blog/best-ai-sdr-tools" },
  { label: "Supademo: AI SDR tools (studied for this page)", url: "https://supademo.com/blog/ai-sdr-tools" },
  { label: "Snov.io: best AI SDR tools for 2026 (studied for this page)", url: "https://snov.io/blog/best-ai-sdr-tools/" },
  { label: "Landbase: Artisan AI pricing (Artisan quotes by volume)", url: "https://landbase.com/blog/artisan-ai-pricing" },
  { label: "MarketBetter: Artisan AI pricing 2026 (reported tiers)", url: "https://marketbetter.ai/blog/artisan-ai-pricing-2026/" },
  { label: "MarketBetter: 11x AI pricing 2026", url: "https://marketbetter.ai/blog/11x-ai-pricing-2026/" },
  { label: "Artisan: 11x pricing and reviews (a competitor's account of 11x pricing)", url: "https://www.artisan.co/blog/11x-pricing-and-reviews" },
  { label: "Valley: Valley AI pricing explained (2026)", url: "https://www.joinvalley.co/blog/valley-ai-pricing-explained-2026" },
  { label: "Valley: Expandi pricing explained (2026)", url: "https://www.joinvalley.co/blog/expandi-pricing-explained-2026" },
  { label: "Valley: HeyReach pricing explained (2026)", url: "https://www.joinvalley.co/blog/heyreach-pricing-explained-2026" },
  { label: "Valley: Waalaxy pricing explained (2026)", url: "https://www.joinvalley.co/blog/waalaxy-pricing-explained-2026" },
  { label: "PricingSaaS: Waalaxy pricing plans and history", url: "https://pricingsaas.com/companies/waalaxy" },
  { label: "Woodpecker: Dripify pricing 2026", url: "https://woodpecker.co/blog/2026-dripify-pricing-how-much-does-dripify-cost/" },
  { label: "LeadHaste: Dripify pricing 2026", url: "https://leadhaste.com/blog/dripify-pricing-2026" },
];

const TOOLS = ["Artisan", "11x", "Valley", "Nora", "Expandi", "HeyReach", "Waalaxy", "Dripify"];

const PRICES = [
  {
    label: "Artisan",
    values: [
      "Quote by outreach volume",
      "No fixed public price. Third-party reports run from about $250 a month at entry to $600 or more a month billed annually, and higher for volume.",
      "Reports conflict on tiers and on monthly versus annual terms.",
    ],
  },
  {
    label: "11x",
    values: [
      "Annual contract",
      "Reported at roughly $45,000 to $60,000 a year; one competitor review says plans start at $3,750 a month billed annually.",
      "Figures come from competitors and aggregators.",
    ],
  },
  {
    label: "Valley",
    values: ["Per seat", "$149 a month billed quarterly or $199 month to month, per Valley's own July 2026 pricing article.", "Higher tiers for deeper research and a done-for-you service."],
  },
  { label: "Expandi", values: ["Per LinkedIn account", "$99 a month, or $79 a month paid yearly.", "Agency pricing on request."] },
  {
    label: "HeyReach",
    values: ["Per sender", "$79 a month per sender; a flat $999 a month for 25 senders on the agency tier.", "Older posts quote different tier prices."],
  },
  {
    label: "Waalaxy",
    values: ["Per user", "Free plan with a small monthly quota. Paid tiers reported anywhere from about €19 to $59 a month at entry.", "Sources disagree sharply; check the live page."],
  },
  { label: "Dripify", values: ["Per user", "About $39 a month billed yearly to $59 monthly at entry.", "No free plan, a trial only."] },
  { label: "Nora", values: ["Free while it grows", "$0, no card.", "LinkedIn only; no email channel."] },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="Best AI SDR tools for LinkedIn in 2026: how to choose one"
      lede="The best AI SDR tools for LinkedIn are the ones that keep your account inside safe limits, write to each person from their own details, and let you approve the audience, the copy and the launch before anyone is contacted. Which one is best for you depends on whether LinkedIn or email is your channel and how many sending accounts you run; this guide gives seven safety questions, dated prices and who each approach suits."
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
      <p>In short:</p>
      <CompareTable
        caption="Which kind of tool suits which buyer, as of October 2026"
        columns={["Examples", "Suits"]}
        rows={[
          { label: "Email-first AI SDR", values: ["Artisan, 11x", "Teams whose buyers answer email, with budget for an annual contract"] },
          { label: "LinkedIn-first AI SDR", values: ["Valley, Nora", "Founders and small teams for whom LinkedIn is the channel that works"] },
          { label: "LinkedIn sequence tool", values: ["Expandi, HeyReach, Waalaxy, Dripify", "People who write their own copy, and agencies running many senders"] },
        ]}
      />
      <p>
        Most &quot;best AI SDR tools&quot; lists are written by vendors and rank their author first, and almost all are email-first:
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
        <li>Write a connection request each person would recognise as written to them.</li>
        <li>Follow up after they accept, at a pace that reads as a person.</li>
        <li>Read replies correctly, answer the ones it can, and stop at &quot;no&quot;.</li>
        <li>Offer real times and book the meeting.</li>
      </ol>
      <p>
        Every step can go wrong in front of a real person under your name, from your personal account. That is the difference
        from email, where a bad message costs a sending domain. On LinkedIn it costs the profile you built your career on.
      </p>

      <h2 id="seven-questions">Seven questions that separate a safe AI SDR from a risky one</h2>
      <p>
        LinkedIn&apos;s terms prohibit automated activity, so no tool can promise zero risk. These questions decide how much risk a
        tool adds. Ask them in the demo and ask to be shown, not told.
      </p>

      <h3 id="caps">Are the caps published?</h3>
      <p>
        Ask for the daily and weekly invitation caps in numbers, whether they are enforced or only suggested, and whether a
        pricier plan raises them. A daily cap with no weekly ceiling lets a busy Monday spend the week. Nora&apos;s are published
        and are product rules: {PUBLIC_LIMITS.invitesPerDayStart} invitations a day at the start, at most{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} after the warm-up, never more than {PUBLIC_LIMITS.invitesPerWeek} a week, and{" "}
        {PUBLIC_LIMITS.messagesPerDay} messages a day. The <Link href="/linkedin-automation-limits">LinkedIn limits page</Link>{" "}
        explains each one.
      </p>

      <h3 id="ramp">When does the ramp start?</h3>
      <p>
        A warm-up measured from the day you connected an account hands one that has never sent anything its full allowance on its
        first day of sending. Ask whether the clock starts at connection or at the first send. Nora&apos;s ramp runs over{" "}
        {PUBLIC_LIMITS.warmupWeeks} weeks from the first send.
      </p>

      <h3 id="pace">How is a day paced?</h3>
      <p>
        A cap says how many, not when. Ask how a day&apos;s allowance is spread. Our own first live account sent seven invitations in
        27 minutes on its first day, inside its cap, and LinkedIn refused its invitations for days afterwards. Nora now divides a
        day&apos;s allowance across your working hours. Ask too what happens on LinkedIn&apos;s first &quot;try again later&quot;: hours of
        silence, or another attempt in minutes.
      </p>

      <h3 id="approval">Does a human approve strategy, copy and launch?</h3>
      <p>
        The safest tools make three decisions yours: the audience, the words and the launch. A tool that writes its own strategy
        should not also approve it, and a campaign should arrive as a draft you can read, not something already running. Ask to
        see five notes from one campaign side by side; if they are the same sentence with a different name, it personalises a
        template, not a message. In Nora each note is written from the person&apos;s own details, in {INVITE_NOTE_MAX_CHARS}{" "}
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
        &quot;Please remove me&quot; must stop everything, every time. Ask whether that depends on the model reading the message
        correctly, or whether there is a plain check in code as well. Nora does both: an opt-out phrase is caught before any model
        is asked, and the model&apos;s reading is a second line, not the only one.
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
          <Link href="/guides/cloud-vs-browser-extension-linkedin-automation">Cloud vs browser-extension automation</Link> covers
          the architecture question, which matters less than these.
        </p>
      </Callout>

      <h2 id="approaches">Best AI SDR tools: the main approaches compared</h2>

      <h3 id="email-first">Email-first AI SDRs (Artisan, 11x)</h3>
      <p>
        Autonomous agents that prospect, research and write across channels, built around email. Third-party reviews describe 11x
        as pitched at replacing outbound SDR capacity and Artisan as offering a choice between autonomous and reviewed sending.
        LinkedIn is one channel among several. Their strength is volume and research across email; if LinkedIn is your main
        channel, put the seven questions above to them before you sign. Pricing is by quote or annual
        contract. Our <Link href="/alternatives/artisan">Artisan alternatives page</Link> compares in more detail.
      </p>

      <h3 id="linkedin-first">LinkedIn-first AI SDRs (Valley, Nora)</h3>
      <p>
        Agents built around LinkedIn: they plan the audience, write per person, follow up and handle replies, with
        LinkedIn&apos;s limits as the central constraint. Valley publishes per-seat pricing and, per its own July 2026 pricing
        article, now includes email outreach in every plan. Nora is LinkedIn only, approval-first and free while it grows. Both
        suit founders, consultants and small teams for whom LinkedIn is the channel that works.
      </p>

      <h3 id="sequence-tools">Sequence tools (Expandi, HeyReach, Waalaxy, Dripify)</h3>
      <p>
        Tools that send connection requests and a fixed series of follow-ups, increasingly with AI writing help. You keep
        targeting, copy and replies. They are cheaper per account and give direct control of every step. HeyReach&apos;s flat
        multi-sender pricing suits agencies; Expandi, Waalaxy and Dripify suit individuals and small teams who already know what
        they want to say. Compare them in detail on our{" "}
        <Link href="/alternatives/heyreach">HeyReach</Link>, <Link href="/alternatives/expandi">Expandi</Link>,{" "}
        <Link href="/alternatives/waalaxy">Waalaxy</Link> and <Link href="/alternatives/dripify">Dripify</Link> pages. If what you
        actually need is scraping and data workflows, see <Link href="/alternatives/phantombuster">PhantomBuster alternatives</Link>.
      </p>

      <h2 id="prices">Prices as of October 2026, with sources</h2>
      <p>
        Prices below come from vendors&apos; own pages where available and otherwise from third-party write-ups, several of them by
        competitors (Valley publishes pricing explainers for many tools in this table). Where sources disagree we say so. Check
        the live pricing page before you buy; these change often.
      </p>
      <CompareTable
        caption="AI SDR and LinkedIn outreach tool prices as reported in October 2026"
        columns={["Pricing model", "Reported price", "Note"]}
        rows={PRICES}
      />
      <p>
        Price the plan at the volume your account can safely send, not the volume the plan allows: a single LinkedIn account
        should not send more than about {PUBLIC_LIMITS.invitesPerWeek} invitations a week, however many credits a plan includes.
        Our <Link href="/guides/ai-sdr-pricing">guide to AI SDR pricing</Link> compares these with the cost of hiring, and{" "}
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
        You launch the campaign. It sends inside the caps above, spread across your working hours, answers replies from the facts
        you gave it, holds the ones your rules say a person should see, and books meetings from times it actually holds.{" "}
        <Link href="/how-it-works">How Nora works</Link> covers every step, and it is free while it grows, with no card:{" "}
        <Link href="/free-linkedin-automation-tool">a free LinkedIn automation tool</Link> in the plainest sense, with details on
        the <Link href="/pricing">pricing page</Link>.
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
          <strong>Clicks are not measured.</strong> That would mean wrapping your link in a redirect we own, which breaks tracking
          parameters and puts an unfamiliar domain in a LinkedIn message.
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
        More comparisons are on the <Link href="/alternatives">alternatives hub</Link>, and more guides in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>

      <h2 id="test">A 30-minute test you can run on any tool</h2>
      <ol>
        <li>Connect an account and check what the first day&apos;s allowance is.</li>
        <li>Build a campaign and read ten notes. Count how many could only be for that person.</li>
        <li>Find the launch button and confirm nothing has gone out before you press it.</li>
        <li>Send a test reply saying &quot;please remove me&quot; and see what happens next.</li>
        <li>Ask a pricing question that is not on your website and see whether it invents an answer.</li>
        <li>Add a contacted person to a second campaign and see whether they are dropped.</li>
      </ol>
      <Callout tone="info">
        <p>
          Run that test on Nora too. <a href={`${SITE.app}/signup`}>Sign up free</a>, connect an account, and nothing is sent
          until you launch.
        </p>
      </Callout>
    </ArticleLayout>
  );
}
