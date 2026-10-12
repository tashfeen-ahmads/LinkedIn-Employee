import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, Callout, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/alternatives/waalaxy";
export const metadata: Metadata = articleMeta(PATH);

const FIRST_MESSAGE_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / 60_000);
const FIRST_MESSAGE_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / 60_000);

const WAALAXY_PRICING = "https://www.waalaxy.com/pricing";
const WAALAXY_CLOUD = "https://intercom.help/waalaxy/en/articles/15587366-waalaxy-is-now-fully-cloud-based";
const WAALAXY_OLD_CLOUD = "https://blog.waalaxy.com/en/waalaxy-cloud/";
const WAALAXY_LIMITS = "https://blog.waalaxy.com/en/what-is-the-linkedin-maximum-connections-per-day/";
const WAALAXY_WEEKLY = "https://blog.waalaxy.com/en/bypass-linkedin-limit/";
const WAALAXY_BLACKLIST = "https://blog.waalaxy.com/en/how-to-create-a-blacklist-with-prospectin/";
const WAALAXY_WAAMI = "https://blog.waalaxy.com/en/waami-ai/";
const SUPERED = "https://www.supered.io/blog/waalaxy-pricing/";
const LGM_PRICING = "https://lagrowthmachine.com/waalaxy-pricing/";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";

const FAQ: readonly Faq[] = [
  {
    q: "Is Waalaxy free?",
    a: "Not for running campaigns, as of October 2026. Waalaxy's help center says you can browse the app on any plan, but importing prospects and launching campaigns needs a paid subscription. Reviews disagree on whether a free tier still exists at all; one dated 2 October 2026 found only a 14-day trial on each paid plan. Check the live pricing page before deciding.",
  },
  {
    q: "Is Waalaxy safe?",
    a: "No LinkedIn automation tool is fully safe, because LinkedIn's User Agreement prohibits automated access. Waalaxy now runs in the cloud and respects LinkedIn's weekly ceiling by postponing invitations past it. Its blog gives 80 to 100 invitations a day as the range on its top plans, which is well above where a new account should start. Keep your own volume low and ramp slowly.",
  },
  {
    q: "How much is Waalaxy per month?",
    a: "Sources disagree. A review based on Waalaxy's pricing page in October 2026 lists Pro, Advanced and Business at €19, €49 and €69 per user per month on monthly billing, with roughly half that on annual billing. Other 2026 guides quote higher figures, up to €39, €99 and €139. Read the live pricing page, and check whether the price shown is monthly or annual.",
  },
  {
    q: "Does Waalaxy need Chrome open?",
    a: "Not any more. Waalaxy's help center says the Chrome extension has been removed and the tool runs in the browser at its web app, with campaigns running in the background whatever your browser is doing. An optional extension remains for faster imports. Older Waalaxy posts telling free users to keep a LinkedIn tab open predate that change.",
  },
  {
    q: "What is better than Waalaxy?",
    a: "Better for what you need. For LinkedIn and email in branching sequences, Expandi or Dripify. For agencies with many senders, HeyReach. For a founder who wants the prospecting, the writing and the replies done, with a person approving each stage and nothing to pay while it grows, Nora. Waalaxy remains a good first tool for someone learning automated outreach.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "Waalaxy help center: Waalaxy is now fully cloud-based (checked October 2026)", url: WAALAXY_CLOUD },
  { label: "Waalaxy: pricing page", url: WAALAXY_PRICING },
  { label: "Supered: Waalaxy pricing 2026, reviewed 2 October 2026", url: SUPERED },
  { label: "La Growth Machine: Waalaxy pricing 2026 (a competitor, quoting different prices)", url: LGM_PRICING },
  { label: "Waalaxy blog: the Waalaxy Cloud (older, before the extension was removed)", url: WAALAXY_OLD_CLOUD },
  { label: "Waalaxy blog: LinkedIn maximum connections per day", url: WAALAXY_LIMITS },
  { label: "Waalaxy blog: weekly limit on invitations sent on LinkedIn", url: WAALAXY_WEEKLY },
  { label: "Waalaxy blog: how to create a blacklist", url: WAALAXY_BLACKLIST },
  { label: "Waalaxy blog: using Waami AI to write prospecting messages", url: WAALAXY_WAAMI },
  { label: "Waalaxy blog: the Waalaxy Inbox, with tags and saved replies", url: "https://blog.waalaxy.com/en/why-inbox-waalaxy" },
  { label: "Emelia: Waalaxy alternatives (a competitor directory, studied for this page)", url: "https://emelia.io/software/waalaxy/alternatives" },
  { label: "ToolJunction: Waalaxy alternatives (studied for this page)", url: "https://www.tooljunction.io/alternatives/waalaxy" },
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
      h1="Waalaxy alternatives with a free plan that runs real campaigns"
      lede="The best Waalaxy alternatives depend on what you outgrew: if it was the price or the free plan, Nora is free while it grows and the free version runs whole campaigns, and if it was the template messages, Nora writes a connection note for each person and answers the replies. If you need LinkedIn and email in one sequence, Waalaxy's top plan or another multichannel tool fits better than Nora, which works on LinkedIn only."
      faq={FAQ}
      sources={SOURCES}
    >
      <CompareTable
        caption="In short: Waalaxy and Nora, as of October 2026"
        columns={["Waalaxy", "Nora"]}
        rows={[
          { label: "Can you run campaigns free?", values: ["No, a paid plan is needed to import and launch", "Yes, the whole product, no card"] },
          { label: "Messages", values: ["Templates with variables, AI drafting help", "A note written for each person"] },
          { label: "Email steps", values: ["Yes, on the top plan", "No, LinkedIn only"] },
          { label: "Replies and booking", values: ["You reply from the inbox", "Answered under your rules, meetings booked"] },
        ]}
      />

      <h2 id="why-alternative">Why people look for a Waalaxy alternative</h2>
      <p>
        Waalaxy is many people&rsquo;s first LinkedIn automation tool, and for good reasons: it is
        quick to set up and ships ready-made campaigns that make the first week easy. People who
        look elsewhere usually hit one of three things:
      </p>
      <ul>
        <li>
          <strong>The free plan stopped being enough.</strong> Whatever the free tier allows this
          month, Waalaxy&rsquo;s own help center now says launching campaigns needs a paid plan.
        </li>
        <li>
          <strong>Templates read like templates.</strong> A message with a first-name field says the
          same thing to everyone, and the people receiving it can tell.
        </li>
        <li>
          <strong>The work after the send.</strong> Choosing who to target, answering replies and
          booking the meeting still sit with you.
        </li>
      </ul>

      <h2 id="waalaxy-in-brief">Waalaxy in brief, fairly</h2>
      <p>
        Waalaxy is a LinkedIn prospecting tool priced per user per month. You import prospects from
        a LinkedIn search, pick a campaign from its library, and Waalaxy runs the steps: visit,
        invite, message, and on the top plan, email. Its AI assistant,{" "}
        <Ext href={WAALAXY_WAAMI}>Waami</Ext>, drafts messages from your persona and offer. As of
        October 2026 its <Ext href={WAALAXY_CLOUD}>help center</Ext> says the tool is fully
        cloud-based: the Chrome extension has been removed, campaigns run in the background, and an
        optional extension remains only to speed up imports.
      </p>

      <h3 id="who-it-suits">Who it suits</h3>
      <p>
        Beginners who want to learn automated outreach from ready-made campaigns, solo users who
        already know who to target, and anyone who wants an email finder and cold email steps in the
        same tool. It is quick to start and does not ask you to design a sequence from scratch.
      </p>

      <h3 id="pricing">Pricing as of October 2026 (sourced)</h3>
      <p>
        The figures conflict, and we would rather show that than pick one. A review built from
        Waalaxy&rsquo;s pricing page and dated <Ext href={SUPERED}>2 October 2026</Ext> lists Pro at
        €19, Advanced at €49 and Business at €69 per user per month on monthly billing, with Pro
        covering 300 invitations a month and the higher plans 800, and Business adding cold email
        and email finder credits. Other 2026 guides, including{" "}
        <Ext href={LGM_PRICING}>one from a competitor</Ext>, quote higher prices for the same plans.
        Read <Ext href={WAALAXY_PRICING}>the live pricing page</Ext> and note whether it shows monthly
        or annual billing.
      </p>

      <h3 id="limits">How it handles limits and warm-up</h3>
      <p>
        Waalaxy&rsquo;s <Ext href={WAALAXY_LIMITS}>blog</Ext> gives a daily range of 80 to 100
        invitations on its top plans, and treats 200 a week as LinkedIn&rsquo;s ceiling: invitations
        past it are <Ext href={WAALAXY_WEEKLY}>postponed to the following week</Ext>. We could not find
        an automatic warm-up ramp for a new account. To avoid contacting someone twice, a prospect can
        only sit in one list at a time, and you can keep a{" "}
        <Ext href={WAALAXY_BLACKLIST}>do-not-contact list</Ext> of your own.
      </p>

      <h2 id="side-by-side">Nora vs Waalaxy: side by side</h2>
      <CompareTable
        caption="Nora compared with Waalaxy, as of October 2026"
        columns={["Nora", "Waalaxy"]}
        rows={[
          { label: "Price", values: ["Free while it grows, no card", "Per user per month; prices vary by source"] },
          { label: "Where it runs", values: ["Cloud, nothing to install", "Cloud web app; optional extension for imports"] },
          { label: "Who finds prospects", values: ["The agent, from a customer profile you approved", "You, from LinkedIn searches you import"] },
          {
            label: "Connection notes",
            values: [`Written per person, under ${INVITE_NOTE_MAX_CHARS} characters, details used shown`, "Templates with variables; AI drafting help"],
          },
          { label: "Human approval", values: ["Strategy, copy and launch, each by a person", "You build and launch the campaign"] },
          {
            label: "Invitation pace",
            values: [
              `${PUBLIC_LIMITS.invitesPerDayStart} rising to ${PUBLIC_LIMITS.invitesPerDayMax} a day, ${PUBLIC_LIMITS.invitesPerWeek} a week, same for everyone`,
              "80 to 100 a day on top plans; 200 a week",
            ],
          },
          { label: "Replies", values: ["Answered from your documents under your rules, or held", "Inbox with tags and templates; you reply"] },
          { label: "Meeting booking", values: ["Booking page or your own scheduling link", "Not covered by the sources we checked"] },
          { label: "Email steps", values: ["No", "Yes, on the top plan"] },
        ]}
      />

      <h3 id="finding-prospects">Finding prospects</h3>
      <p>
        In Waalaxy you bring the search. Nora reads your website, proposes three to five customer
        profiles, and searches for nobody until a person approves one. It searches on the LinkedIn
        tier your account has, names any filter that tier cannot apply before you launch, opens
        every profile before it reaches the list, and skips anyone your workspace has contacted.
      </p>

      <h3 id="writing-notes">Writing notes</h3>
      <p>
        Waami drafts a message for a campaign; Nora writes one for each person. Every note comes from
        that person&rsquo;s own headline, role and company, stays under {INVITE_NOTE_MAX_CHARS} characters, the safe side of
        LinkedIn&rsquo;s note limit, and shows on the review screen which details it
        used. A note with a link in it is sent with no note at all. If you would rather write your
        own, the{" "}
        <Link href="/guides/linkedin-connection-request-templates">connection request templates guide</Link>{" "}
        shows what makes a note specific.
      </p>

      <h3 id="replies-booking">Replies and booking</h3>
      <p>
        Nora checks for acceptances through the day and sends the first message {FIRST_MESSAGE_MIN} to{" "}
        {FIRST_MESSAGE_MAX} minutes after it notices one, inside your working hours. Replies are
        answered only from the documents you gave it, with links only to destinations you set.
        Pricing, legal and negative replies wait for you unless you choose otherwise, and a prospect
        who asks for a person always waits. Meetings are offered from Nora&rsquo;s booking page or
        through your own scheduling link.
      </p>

      <h3 id="safety">Safety guardrails</h3>
      <p>
        Free does not mean a smaller quota, and paying would not mean a bigger one. The ramp starts
        at {PUBLIC_LIMITS.invitesPerDayStart} a day from an account&rsquo;s first send and reaches{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks, under{" "}
        {PUBLIC_LIMITS.invitesPerWeek} a week and {PUBLIC_LIMITS.messagesPerDay} messages a day. A
        day&rsquo;s allowance is spread across working hours, and the exclusion list and
        never-contact-twice rule are checked before every send.
      </p>

      <h3 id="price">Price</h3>
      <p>
        Nora is free for every workspace while it grows, with no card. See{" "}
        <Link href="/free-linkedin-automation-tool">what the free LinkedIn automation tool includes</Link>.
      </p>

      <h2 id="free-plan-2026">Waalaxy&rsquo;s free plan in 2026: what the sources say</h2>
      <p>
        This is the question most people searching &ldquo;Waalaxy alternatives&rdquo; are really
        asking, and the honest answer is that the sources do not agree:
      </p>
      <ul>
        <li>
          Waalaxy&rsquo;s <Ext href={WAALAXY_CLOUD}>help center</Ext> says you can browse the app on
          any plan, but importing prospects and launching campaigns needs a paid subscription.
        </li>
        <li>
          A review dated <Ext href={SUPERED}>2 October 2026</Ext> found no free plan on the pricing
          page, only a 14-day trial on each paid plan.
        </li>
        <li>
          Several other 2026 roundups still describe a free tier with a small monthly invitation allowance,
          and Waalaxy&rsquo;s <Ext href={WAALAXY_OLD_CLOUD}>older blog posts</Ext> told free users to
          keep a computer on with a LinkedIn tab open.
        </li>
      </ul>
      <p>
        The help center is the most recent first-party source, so we read it as: a free account
        exists to look around, and outreach is paid. Whichever is true when you read this, compare
        any free plan on whether it actually sends, at what pace, and for how long. A free period
        shorter than about {PUBLIC_LIMITS.warmupWeeks} weeks ends before a careful warm-up does.
      </p>
      <Callout tone="safety">
        <p>
          LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated access.
          No tool, free or paid, can promise an account will never be restricted. Low volume, a slow
          ramp and notes people accept are what reduce the risk.
        </p>
      </Callout>

      <h2 id="other-alternatives">Other Waalaxy alternatives worth a look</h2>
      <ul>
        <li>
          <strong>Expandi</strong>, the usual &ldquo;Expandi vs Waalaxy&rdquo; comparison: a cloud
          sequence builder with branching conditions and email steps, priced per account. See{" "}
          <Link href="/alternatives/expandi">Expandi compared</Link>.
        </li>
        <li>
          <strong>Dripify</strong>, for drip sequences with team dashboards, priced per user with a
          short trial. See <Link href="/alternatives/dripify">Dripify compared</Link>.
        </li>
        <li>
          <strong>HeyReach</strong>, if you run many sender accounts. See{" "}
          <Link href="/alternatives/heyreach">HeyReach compared</Link>.
        </li>
      </ul>
      <p>
        All of them, by published caps and dated prices, are on{" "}
        <Link href="/alternatives">the LinkedIn automation tools comparison</Link>. If you are weighing
        how tools run, the{" "}
        <Link href="/guides/cloud-vs-browser-extension-linkedin-automation">
          cloud versus browser extension guide
        </Link>{" "}
        explains why pacing matters more than either. If you are choosing an agent, start with the{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to the best AI SDR for LinkedIn</Link>.
      </p>

      <h2 id="stay-with-waalaxy">Who should stay with Waalaxy</h2>
      <ul>
        <li>You want LinkedIn and email steps in one campaign, with an email finder built in.</li>
        <li>You like starting from a template library and editing it yourself.</li>
        <li>You already know exactly who to target and mostly need a sender.</li>
      </ul>
      <p>
        If instead you want the targeting, the writing and the replies handled, with your approval
        on each, <a href={`${SITE.app}/signup`}>Sign up free</a>. Nothing is sent until you launch.
      </p>
    </ArticleLayout>
  );
}
