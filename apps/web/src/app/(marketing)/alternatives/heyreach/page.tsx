import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, Callout, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/alternatives/heyreach";
export const metadata: Metadata = articleMeta(PATH);

const FIRST_MESSAGE_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / 60_000);
const FIRST_MESSAGE_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / 60_000);

const HEYREACH_PRICING = "https://www.heyreach.io/pricing";
const HEYREACH_STATEMENT = "https://www.heyreach.io/blog/heyreach-ban";
const HEYREACH_LIMITS = "https://help.heyreach.io/en/articles/15128619-how-do-connection-request-limits-work-in-heyreach";
const HEYREACH_SAFE = "https://help.heyreach.io/en/articles/9877960-is-heyreach-safe-to-use";
const HEYREACH_LAUNCH = "https://help.heyreach.io/en/articles/9877952-how-to-launch-your-first-campaign";
const OVERLOOP = "https://overloop.com/blog/heyreach-review";
const COLDSAAS = "https://coldsaas.com/en/blog/heyreach-pricing";
const LGM = "https://lagrowthmachine.com/best-heyreach-alternatives/";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";

const FAQ: readonly Faq[] = [
  {
    q: "Is HeyReach still safe to use?",
    a: "No LinkedIn automation tool is safe in an absolute sense, because LinkedIn's User Agreement prohibits automated access. HeyReach says LinkedIn's March 2026 action was limited to its own company page and executives, and that customer accounts kept running; we have seen no evidence either way about individual customers. Your account's risk depends mostly on how much it sends, how fast it ramps and how many people accept.",
  },
  {
    q: "How much does HeyReach cost per sender?",
    a: "As of October 2026, sources agree that HeyReach's Growth plan is $79 per LinkedIn sender per month on monthly billing, cheaper on longer billing, with teammates free. Its agency and unlimited bundles are quoted differently by different 2026 reviews, both in price and in how many senders they include, so read the live pricing page before budgeting for more than a few senders.",
  },
  {
    q: "What is the best HeyReach alternative?",
    a: "It depends on why you are leaving. An agency running many sender accounts for clients needs another multi-sender platform. A team that wants LinkedIn and email in one sequence needs a multichannel tool. A founder or small team sending from their own profiles, who wants each person written to individually and a human approving every stage, is better served by an AI SDR such as Nora.",
  },
  {
    q: "Is HeyReach good for agencies?",
    a: "Yes, that is who it is built for. Pricing per sender with free teammates, sender rotation across a campaign, and one inbox across every connected account all fit an agency running outreach for several clients. Its published limits are also per sender, which suits a model where each client's account carries its own volume.",
  },
  {
    q: "Does Nora support multiple senders?",
    a: "Each teammate in a Nora workspace connects their own LinkedIn account, and each account has its own daily and weekly caps, shared across every campaign on it. Nora does not rotate one campaign across a pool of accounts. That is a deliberate scope for teams sending from their own profiles, not a setting waiting to be switched on.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "HeyReach: pricing page", url: HEYREACH_PRICING },
  { label: "Overloop: HeyReach review 2026, pricing and tiers (a competitor, which it discloses)", url: OVERLOOP },
  { label: "ColdSaaS: HeyReach pricing 2026, sender tiers", url: COLDSAAS },
  { label: "HeyReach help center: how connection request limits work (checked October 2026)", url: HEYREACH_LIMITS },
  { label: "HeyReach help center: is HeyReach safe to use", url: HEYREACH_SAFE },
  { label: "HeyReach help center: launching your first campaign, with exclusion filters", url: HEYREACH_LAUNCH },
  { label: "HeyReach: LinkedIn deleted HeyReach's company page, what it didn't delete (August 2026)", url: HEYREACH_STATEMENT },
  { label: "La Growth Machine: best HeyReach alternatives (a competitor, studied for this page)", url: LGM },
  { label: "Expandi: HeyReach alternatives (a competitor, studied for this page)", url: "https://expandi.io/blog/heyreach-alternatives/" },
  { label: "Salesforge: HeyReach alternatives (a competitor, studied for this page)", url: "https://www.salesforge.ai/blog/heyreach-alternatives" },
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
      h1="HeyReach alternatives for safe, personal LinkedIn outreach"
      lede="The right HeyReach alternatives depend on what you use HeyReach for: an agency running many sender accounts needs another multi-sender platform, while a founder or small team sending from their own profile is usually better served by an AI SDR that writes to each person. Nora is the second kind, with a note written for every prospect, a person approving the strategy, the copy and the launch, caps fixed in code, and no bill while it grows."
      faq={FAQ}
      sources={SOURCES}
    >
      <CompareTable
        caption="In short: which HeyReach alternative fits, as of October 2026"
        columns={["Look at"]}
        rows={[
          { label: "You run many sender accounts for clients", values: ["Stay with HeyReach, or another multi-sender platform"] },
          { label: "You want LinkedIn and email in one sequence", values: ["A multichannel tool such as Expandi or La Growth Machine"] },
          { label: "You send from your own profile and want it done for you", values: ["An AI SDR such as Nora, free while it grows"] },
          { label: "You mainly need LinkedIn data, not conversations", values: ["A scraping and enrichment tool such as PhantomBuster"] },
        ]}
      />

      <h2 id="why-alternative">Why people look for a HeyReach alternative</h2>
      <p>
        Plenty of people searching this are content with HeyReach and want to know their options
        after the news in March 2026. The rest usually fall into three groups:
      </p>
      <ul>
        <li>
          <strong>One rep paying for an agency tool.</strong> HeyReach is priced and designed around
          many senders. If you send from one or two profiles, much of what you pay for is
          coordination you do not need.
        </li>
        <li>
          <strong>Personalization that comes from somewhere else.</strong> Messages are templates with
          variables and fallbacks. Notes that say something real about each person usually mean
          building AI-written fields in another tool and importing them with the list.
        </li>
        <li>
          <strong>Work left after the send.</strong> Finding the list, answering replies and booking
          the meeting stay with you or your team.
        </li>
      </ul>

      <h2 id="heyreach-in-brief">HeyReach in brief, fairly</h2>
      <p>
        HeyReach is a cloud LinkedIn outreach platform built around one commercial idea: you pay per
        LinkedIn sender account, not per teammate, so an agency can add staff and clients without
        the bill growing. A campaign can rotate across several senders so each stays under its own
        daily volume, and one inbox gathers conversations from every connected account.
      </p>

      <h3 id="who-it-suits">Who it suits</h3>
      <p>
        Agencies and sales teams running outreach from many LinkedIn accounts, especially where
        LinkedIn is one channel next to an email tool and where lists and personalization already
        come from an enrichment workflow. For that job it is a strong, focused product.
      </p>

      <h3 id="pricing">Pricing as of October 2026 (sourced)</h3>
      <p>
        Every source we checked agrees on the entry plan: Growth is{" "}
        <Ext href={OVERLOOP}>$79 per sender per month</Ext> on monthly billing, with teammates free
        and a lower effective rate on longer billing. The bundles are where sources disagree. One
        2026 review lists an agency tier at $999 a month and unlimited senders at $2,999;{" "}
        <Ext href={COLDSAAS}>another</Ext> lists unlimited at $1,999 with a different fair-use cap.
        Check <Ext href={HEYREACH_PRICING}>HeyReach&rsquo;s pricing page</Ext> before budgeting
        anything beyond a few senders.
      </p>

      <h3 id="limits">How it handles limits and warm-up</h3>
      <p>
        HeyReach&rsquo;s <Ext href={HEYREACH_LIMITS}>help center</Ext> says each sender has a daily
        connection request limit shared across all its campaigns, defaulting to 25 and settable up to
        40, with a weekly cap of 200 per sender, after which sending pauses until Monday. A separate{" "}
        <Ext href={HEYREACH_SAFE}>safety article</Ext> mentions around 100 a week, so ask which is
        current. We could not find an automatic warm-up ramp; the guidance is to stay at the default
        once an account is warmed up. Campaigns can{" "}
        <Ext href={HEYREACH_LAUNCH}>skip leads already contacted</Ext> by other campaigns or senders
        in the workspace, through filters you switch on when setting the campaign up.
      </p>

      <h2 id="side-by-side">Nora vs HeyReach: side by side</h2>
      <CompareTable
        caption="Nora compared with HeyReach, as of October 2026"
        columns={["Nora", "HeyReach"]}
        rows={[
          { label: "Built for", values: ["Founders and small teams sending from their own profiles", "Agencies and teams running many sender accounts"] },
          { label: "Price", values: ["Free while it grows, no card", "Per sender, $79 a month on Growth, teammates free"] },
          { label: "Several senders in one campaign", values: ["No: each teammate's account runs its own campaigns", "Yes, with sender rotation"] },
          { label: "Who finds prospects", values: ["The agent, from a customer profile you approved", "You bring or build the list"] },
          {
            label: "Connection notes",
            values: [`Written per person from their profile, under ${INVITE_NOTE_MAX_CHARS} characters`, "Templates with variables and fallbacks"],
          },
          { label: "Human approval", values: ["Strategy, copy and launch, each by a person", "You build and launch the campaign"] },
          {
            label: "Invitation caps",
            values: [
              `${PUBLIC_LIMITS.invitesPerDayStart} rising to ${PUBLIC_LIMITS.invitesPerDayMax} a day from the first send, ${PUBLIC_LIMITS.invitesPerWeek} a week; can only be lowered`,
              "Default 25 a day, up to 40; 200 a week per sender",
            ],
          },
          { label: "Not contacting anyone twice", values: ["Always on, checked before each send", "Filters you choose per campaign"] },
          { label: "Replies", values: ["Answered from your documents under your rules, or held for you", "One inbox for your team"] },
          { label: "Meeting booking", values: ["Booking page or your own scheduling link", "Not covered by the sources we checked"] },
          { label: "Email steps", values: ["No, LinkedIn only", "Through integrations with email tools"] },
        ]}
      />

      <h3 id="finding-prospects">Finding prospects</h3>
      <p>
        HeyReach executes a list you supply. Nora starts from your website: it drafts three to five
        customer profiles and searches for nobody until a person approves one. It then searches on
        the LinkedIn tier your account actually has, names on the campaign any filter that tier
        cannot apply, opens each profile before it reaches the list, and leaves out anyone your
        workspace has already contacted.
      </p>

      <h3 id="writing-notes">Writing notes</h3>
      <p>
        Every connection note is written for one person from their own headline, role and company,
        and the review screen shows which details it used, so &ldquo;personalised&rdquo; is
        something you can check. A note containing a link is sent with no note at all, because
        links in invitations cut acceptance. You can split a campaign across two or three angles and
        compare them fairly, with people assigned evenly.
      </p>

      <h3 id="replies-booking">Replies and booking</h3>
      <p>
        Nora checks for new acceptances through the day and sends the first message{" "}
        {FIRST_MESSAGE_MIN} to {FIRST_MESSAGE_MAX} minutes after it notices one, inside your working
        hours. Replies are answered only from the documents you gave it. By default pricing, legal and
        negative replies wait for you; a workspace can choose to let them be answered. A prospect who
        asks for a person, or a message the agent could not read, always waits. Meeting times come
        from Nora&rsquo;s booking page, which knows what was booked through it, the times you block
        and any calendar feed you add, or Nora sends your own scheduling link.
      </p>

      <h3 id="safety">Safety guardrails</h3>
      <p>
        The caps are product rules: an owner can lower them, nobody can raise them, and the ramp
        counts from an account&rsquo;s first send rather than the day it was connected. A day&rsquo;s
        allowance is spread across working hours. The shared exclusion list and the
        never-contact-twice rule are checked immediately before every send, and an opt-out is
        matched by a fixed rule as well as by the model. The reasoning behind each number is on{" "}
        <Link href="/linkedin-automation-limits">the LinkedIn automation limits page</Link>.
      </p>

      <h3 id="price">Price</h3>
      <p>
        Nora is free for every workspace while it grows, with no card and no plan to pick, and the
        caps are the same for everyone. <Link href="/pricing">The pricing page</Link> says what
        happens if that ever changes. If you need dozens of senders, HeyReach&rsquo;s bundles are
        built for it and Nora is not.
      </p>

      <h2 id="march-2026">What the March 2026 enforcement means for HeyReach users</h2>
      <p>
        On 25 March 2026 LinkedIn removed HeyReach&rsquo;s company page and restricted the personal
        profiles of several of its executives. In{" "}
        <Ext href={HEYREACH_STATEMENT}>its own account of the event</Ext>, HeyReach says the action
        was limited to the company&rsquo;s own LinkedIn presence and that customer accounts and
        campaigns kept running. LinkedIn has not published a reason, and accounts from other vendors
        disagree on details such as whether the restrictions are permanent. Most of those accounts
        are written by competitors, ourselves included.
      </p>
      <p>
        We know of no public evidence that the event changed what happens to an individual
        customer&rsquo;s account, and we do not suggest it did. Our write-up of{" "}
        <Link href="/guides/linkedin-automation-tool-bans">what is verified about the HeyReach ban</Link>{" "}
        separates the facts from the claims. The practical takeaway is the same for every tool: the
        risk sits with the account doing the sending, and it is driven by volume, ramp speed and
        acceptance rate more than by which vendor&rsquo;s logo is on the dashboard.
      </p>
      <Callout tone="safety">
        <p>
          LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated access.
          No tool, Nora included, can promise an account will never be restricted. A tool can keep
          volume low, ramp slowly and send notes people want to accept.
        </p>
      </Callout>

      <h2 id="other-alternatives">Other HeyReach alternatives worth a look</h2>
      <ul>
        <li>
          <strong>Expandi</strong>, if you want branching LinkedIn and email sequences you design
          yourself. See <Link href="/alternatives/expandi">how Expandi compares</Link>.
        </li>
        <li>
          <strong>La Growth Machine</strong>, which <Ext href={LGM}>describes itself</Ext> as
          multichannel across LinkedIn, email and more, priced per identity.
        </li>
        <li>
          <strong>Waalaxy</strong> or <strong>Dripify</strong>, for simpler LinkedIn sequences priced
          per user. See <Link href="/alternatives/waalaxy">Waalaxy compared</Link> and{" "}
          <Link href="/alternatives/dripify">Dripify compared</Link>.
        </li>
      </ul>
      <p>
        Every tool side by side, by published caps, warm-up and price, is on{" "}
        <Link href="/alternatives">the LinkedIn automation tools comparison</Link>. If you are
        weighing agents rather than senders, the{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        lists the questions to ask any vendor, including us.
      </p>

      <h2 id="stay-with-heyreach">Who should stay with HeyReach</h2>
      <ul>
        <li>You run outreach for clients from many LinkedIn accounts and want one campaign spread across them.</li>
        <li>LinkedIn is one step in a sequence that also sends email through a tool you already use.</li>
        <li>Your lists and personalization come from an enrichment workflow, and you need a reliable sender.</li>
      </ul>
      <p>
        Nora does none of those. Agencies whose founder sends from their own profile are a different
        case, covered in <Link href="/for/agencies">LinkedIn lead generation for agencies</Link>.
      </p>

      <h2 id="switching">Switching without contacting anyone twice</h2>
      <ol>
        <li>
          <strong>Let running sequences finish or pause them.</strong> Two tools writing to one
          person in the same week is the quickest way to look automated.
        </li>
        <li>
          <strong>Export your contacted leads</strong> from HeyReach so you keep the history.
        </li>
        <li>
          <strong>Add anyone you must not contact</strong> to Nora&rsquo;s exclusion list, by person or
          by company.
        </li>
        <li>
          <strong>Connect your account and approve one customer profile.</strong> It starts at{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} invitations a day whatever it sent before, because the ramp
          counts from its first send through Nora.
        </li>
        <li>
          <strong>Read the notes, launch, and send one now</strong> if you want to see the first
          invitation go out and what happened to it.
        </li>
      </ol>
      <p>
        Read <Link href="/how-it-works">how Nora works step by step</Link>, or{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
