import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { Glance, NORA, Verdict, NOT_DOCUMENTED, withGlanceSources, type GlanceTool } from "../_glance";

const PATH = "/alternatives/waalaxy";
export const metadata: Metadata = articleMeta(PATH);

const GLANCE: readonly GlanceTool[] = ["nora", "waalaxy", "expandi", "dripify", "heyreach", "phantombuster"];

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
    a: "Not for running campaigns, according to Waalaxy's help center as of October 2026: you can browse the app on any plan, but importing prospects and launching campaigns needs a paid subscription. Reviews disagree on whether a free tier still exists at all; one dated October 2, 2026 found only a 14-day trial on each paid plan. Check the live pricing page before deciding.",
  },
  {
    q: "Is Waalaxy safe?",
    a: "No LinkedIn automation tool is fully safe, because LinkedIn's User Agreement prohibits automated access. Waalaxy now runs in the cloud and respects LinkedIn's weekly ceiling by postponing invitations past it. Its blog gives 80 to 100 invitations a day as the range on its top plans, which is well above where a new account should start. Keep your own volume low and ramp slowly.",
  },
  {
    q: "How much is Waalaxy per month?",
    a: "Sources disagree. A review based on Waalaxy's pricing page in October 2026 lists Pro, Advanced and Business at €19, €49 and €69 per user per month on monthly billing, roughly $22, $56 and $79, with about half that on annual billing. Other 2026 guides quote higher figures, up to €39, €99 and €139. Read the live pricing page, and check whether the price shown is monthly or annual.",
  },
  {
    q: "Does Waalaxy need Chrome open?",
    a: "Not any more. Waalaxy's help center says the Chrome extension has been removed and the tool runs in the browser at its web app, with campaigns running in the background whatever your browser is doing. An optional extension remains for faster imports. Older Waalaxy posts telling free users to keep a LinkedIn tab open predate that change.",
  },
  {
    q: "What is better than Waalaxy?",
    a: "Better for what you need. For LinkedIn and email in branching sequences, Expandi or Dripify. For agencies with many senders, HeyReach. For a founder who wants the prospecting, the writing and the reply drafts done, with a person approving each stage and nothing to pay while we grow, Nora. Waalaxy remains a good first tool for someone learning automated outreach.",
  },
];

const SOURCES: readonly Source[] = withGlanceSources(
  [
    { label: "Waalaxy help center: Waalaxy is now fully cloud-based (checked October 2026)", url: WAALAXY_CLOUD },
    { label: "Waalaxy: pricing page", url: WAALAXY_PRICING },
    { label: "Supered: Waalaxy pricing 2026, reviewed October 2, 2026", url: SUPERED },
    { label: "La Growth Machine: Waalaxy pricing 2026 (a competitor, quoting different prices)", url: LGM_PRICING },
    { label: "Waalaxy blog: the Waalaxy Cloud (older, before the extension was removed)", url: WAALAXY_OLD_CLOUD },
    { label: "Waalaxy blog: LinkedIn maximum connections per day", url: WAALAXY_LIMITS },
    { label: "Waalaxy blog: weekly limit on invitations sent on LinkedIn", url: WAALAXY_WEEKLY },
    { label: "Waalaxy blog: how to create a blacklist", url: WAALAXY_BLACKLIST },
    { label: "Waalaxy blog: using Waami AI to write prospecting messages", url: WAALAXY_WAAMI },
    { label: "Waalaxy blog: the Waalaxy Inbox, with tags and saved replies", url: "https://blog.waalaxy.com/en/why-inbox-waalaxy" },
    { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
  ],
  GLANCE,
);

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
      h1="Waalaxy alternatives: free, with a note for every person"
      lede="The best Waalaxy alternative depends on what you outgrew. If it was the price or the free plan, Nora is free while we grow and runs whole campaigns; if it was the template messages, Nora writes a connection note for each person and drafts the replies. If you need LinkedIn and email in one sequence, Waalaxy's top plan or another multichannel tool fits better, because Nora works on LinkedIn only."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">Nora or Waalaxy: the short answer</h2>
      <Verdict
        rival="Waalaxy"
        nora={["You want to run real campaigns free, with no card.", "You want a note written for each person instead of a template.", "You want replies drafted for you and meetings booked."]}
        them={["You want LinkedIn and email steps in one campaign, with an email finder built in.", "You like starting from a template library and editing it yourself.", "You already know exactly who to target and mostly need a sender."]}
      />

      <h2 id="at-a-glance">Waalaxy alternatives at a glance</h2>
      <p>
        Six tools people compare with Waalaxy, by who each suits, the cheapest way in, whether there
        is a free plan or a trial, and what each publishes about LinkedIn volume.
      </p>
      <Glance tools={GLANCE} />

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
        Waalaxy&rsquo;s pricing page and dated <Ext href={SUPERED}>October 2, 2026</Ext> lists Pro at
        €19, Advanced at €49 and Business at €69 per user per month on monthly billing, roughly $22,
        $56 and $79 at recent exchange rates. Pro covers 300 invitations a month and the higher plans
        800, and Business adds cold email and email finder credits. Other 2026 guides, including{" "}
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
          { label: "Where it runs", values: ["Cloud, nothing to install", "Cloud web app; optional extension for imports"] },
          { label: "Who finds prospects", values: [NORA.prospects, "You, from LinkedIn searches you import"] },
          { label: "Connection notes", values: [NORA.notes, "Templates with variables; AI drafting help"] },
          { label: "Human approval", values: [NORA.approval, "You build and launch the campaign"] },
          { label: "Daily invitations", values: [NORA.daily, "80 to 100 on top plans"] },
          { label: "Weekly ceiling", values: [NORA.weekly, "200; invitations past it wait for the next week"] },
          { label: "Never contacting anyone twice", values: [NORA.twice, "One list per prospect; a do-not-contact list you keep"] },
          { label: "Replies", values: [NORA.replies, "Inbox with tags and templates; you reply"] },
          { label: "Meeting booking", values: [NORA.booking, NOT_DOCUMENTED] },
          { label: "Email steps", values: [NORA.email, "Yes, on the top plan"] },
        ]}
      />

      <h2 id="where-nora-differs">Where Nora differs from Waalaxy</h2>
      <p>
        Where Waalaxy hands you a campaign library and a search to import, Nora drafts customer
        profiles from your website, finds the people once you approve one, and writes to each of
        them. <Link href="/how-it-works">How Nora works</Link> has the full flow.
      </p>
      <p>
        The writing is the clearest difference. Waami drafts a message for a campaign from your
        persona and offer. Nora writes one note per person from that person&rsquo;s own headline,
        role and company, up to {INVITE_NOTE_MAX_CHARS} characters, and the review screen shows which
        details each note drew on. A draft that would put a link in the invitation goes out with no
        note instead. If you would rather write your own, the{" "}
        <Link href="/guides/linkedin-connection-request-templates">connection request templates guide</Link>{" "}
        shows what makes a note specific.
      </p>
      <p>
        The other is what free buys. In Nora, free does not mean a smaller quota and paying would not
        mean a bigger one: every account ramps from {PUBLIC_LIMITS.invitesPerDayStart} invitations a
        day to {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks, under{" "}
        {PUBLIC_LIMITS.invitesPerWeek} a week and {PUBLIC_LIMITS.messagesPerDay} messages a day. See{" "}
        <Link href="/free-linkedin-automation-tool">what the free LinkedIn automation tool includes</Link>.
      </p>

      <h2 id="free-plan-2026">Waalaxy&rsquo;s free plan in 2026: what the sources say</h2>
      <p>
        This is the question most people comparing Waalaxy alternatives are really asking, and the
        honest answer is that the sources do not agree:
      </p>
      <ul>
        <li>
          Waalaxy&rsquo;s <Ext href={WAALAXY_CLOUD}>help center</Ext> says you can browse the app on
          any plan, but importing prospects and launching campaigns needs a paid subscription.
        </li>
        <li>
          A review dated <Ext href={SUPERED}>October 2, 2026</Ext> found no free plan on the pricing
          page, only a 14-day trial on each paid plan.
        </li>
        <li>
          Several other 2026 roundups still describe a free tier with a small monthly invitation
          allowance, and Waalaxy&rsquo;s <Ext href={WAALAXY_OLD_CLOUD}>older blog posts</Ext> told free
          users to keep a computer on with a LinkedIn tab open.
        </li>
      </ul>
      <p>
        The help center is the most recent first-party source, so we read it as: a free account
        exists to look around, and outreach is paid. Whichever is true when you read this, compare
        any free plan on whether it actually sends, at what pace, and for how long. A free period
        shorter than about {PUBLIC_LIMITS.warmupWeeks} weeks ends before a careful warm-up does. And
        no plan, free or paid, changes the fact that LinkedIn&rsquo;s{" "}
        <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated access.
      </p>

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

      <h2 id="switching">Switching without contacting anyone twice</h2>
      <p>
        Waalaxy holds invitations back when a week is full, so a campaign can still be sending after
        you have stopped thinking about it.
      </p>
      <ol>
        <li>
          <strong>Stop the campaigns, not just the imports.</strong> Invitations postponed past the
          weekly ceiling go out the following week unless the campaign is stopped.
        </li>
        <li>
          <strong>Use your lists as the record.</strong> A prospect sits in one Waalaxy list at a time,
          so those lists, plus your do-not-contact list, are the history of who you reached. Nora
          only knows who Nora has contacted, so put the people and companies that must not hear from
          you again on Nora&rsquo;s exclusion list.
        </li>
        <li>
          <strong>Connect the account and approve one customer profile.</strong> It starts at{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} invitations a day whatever Waalaxy sent, because the
          warm-up counts from its first send through Nora.
        </li>
        <li>
          <strong>Read each note before you launch.</strong> Nothing is sent until you do.
        </li>
      </ol>
    </ArticleLayout>
  );
}
