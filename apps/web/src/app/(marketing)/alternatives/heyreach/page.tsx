import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, CompareTable, Callout, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { Glance, NORA, Verdict, NOT_DOCUMENTED, withGlanceSources, type GlanceTool } from "../_glance";

const PATH = "/alternatives/heyreach";
export const metadata: Metadata = articleMeta(PATH);

const GLANCE: readonly GlanceTool[] = ["nora", "heyreach", "expandi", "waalaxy", "dripify", "phantombuster"];

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

const SOURCES: readonly Source[] = withGlanceSources(
  [
    { label: "HeyReach: pricing page", url: HEYREACH_PRICING },
    { label: "Overloop: HeyReach review 2026, pricing and tiers (a competitor, which it discloses)", url: OVERLOOP },
    { label: "ColdSaaS: HeyReach pricing 2026, sender tiers", url: COLDSAAS },
    { label: "HeyReach help center: how connection request limits work (checked October 2026)", url: HEYREACH_LIMITS },
    { label: "HeyReach help center: is HeyReach safe to use", url: HEYREACH_SAFE },
    { label: "HeyReach help center: launching your first campaign, with exclusion filters", url: HEYREACH_LAUNCH },
    { label: "HeyReach: LinkedIn deleted HeyReach's company page, what it didn't delete (August 2026)", url: HEYREACH_STATEMENT },
    { label: "La Growth Machine: best HeyReach alternatives, describing its own product (a competitor)", url: LGM },
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
      h1="HeyReach alternatives: for one rep sending from their own profile"
      lede="The right HeyReach alternative depends on what you use HeyReach for. An agency running many sender accounts needs another multi-sender platform; a founder or small team sending from their own profiles is usually better served by an AI SDR such as Nora, which writes a note for every prospect and waits for a person to approve the strategy, the copy and the launch."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">Nora or HeyReach: the short answer</h2>
      <Verdict
        rival="HeyReach"
        nora={["You send from your own profile, or a few teammates send from theirs.", "You want a note written for each prospect and a person approving the launch.", "You want caps that can only be lowered, and a 14-day free trial to start."]}
        them={["You run outreach for clients from many LinkedIn accounts and want one campaign spread across them.", "LinkedIn is one step in a sequence that also sends email through a tool you already use.", "Your lists and personalization come from an enrichment workflow, and you need a reliable sender."]}
      />
      <p>
        An agency whose founder sends from their own profile is the second case, covered in{" "}
        <Link href="/for/agencies">LinkedIn lead generation for agencies</Link>.
      </p>

      <h2 id="at-a-glance">HeyReach alternatives at a glance</h2>
      <p>
        Six tools people weigh against HeyReach, by who each suits, what it costs to start and what
        each publishes about LinkedIn volume. HeyReach&rsquo;s caps are per sender; Nora&rsquo;s are
        per account, across every campaign on it.
      </p>
      <Glance tools={GLANCE} />

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
        LinkedIn sender account, not per teammate, so an agency can add teammates and clients without
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
          { label: "Several senders in one campaign", values: ["No: each teammate's account runs its own campaigns", "Yes, with sender rotation"] },
          { label: "Who finds prospects", values: [NORA.prospects, "You bring or build the list"] },
          { label: "Connection notes", values: [NORA.notes, "Templates with variables and fallbacks"] },
          { label: "Human approval", values: [NORA.approval, "You build and launch the campaign"] },
          { label: "Daily invitations", values: [NORA.daily, "Default 25 per sender, settable to 40"] },
          { label: "Weekly ceiling", values: [NORA.weekly, "200 per sender"] },
          { label: "Never contacting anyone twice", values: [NORA.twice, "Filters you choose per campaign"] },
          { label: "Replies", values: [NORA.replies, "One inbox for your team; you reply"] },
          { label: "Meeting booking", values: [NORA.booking, NOT_DOCUMENTED] },
        ]}
      />

      <h2 id="where-nora-differs">Where Nora differs from HeyReach</h2>
      <p>
        HeyReach executes a list you supply. Nora starts a step earlier: it drafts customer profiles
        from your website, searches only once a person approves one, and writes every note from the
        prospect&rsquo;s own profile. The rest is on <Link href="/how-it-works">how Nora works</Link>.
      </p>
      <p>
        The bigger difference is the unit each product is built around. HeyReach&rsquo;s unit is the
        sender: a campaign can spread across a pool of accounts, each allowed up to 200 invitations a
        week, and adding senders is how volume grows. Nora&rsquo;s unit is one person&rsquo;s own
        profile. It never rotates a campaign across accounts, each account&rsquo;s ceiling is{" "}
        {PUBLIC_LIMITS.invitesPerWeek} a week across every campaign on it, and the daily allowance
        is spread across that person&rsquo;s working hours. That makes Nora the wrong tool for an
        agency&rsquo;s sender pool and a careful one for a founder whose own name is on every note.
        The reasoning behind each number is on{" "}
        <Link href="/linkedin-automation-limits">the LinkedIn automation limits page</Link>.
      </p>

      <h2 id="march-2026">What the March 2026 enforcement means for HeyReach users</h2>
      <p>
        On March 25, 2026 LinkedIn removed HeyReach&rsquo;s company page and restricted the personal
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
        <li>
          <strong>PhantomBuster</strong>, if what you mainly need from LinkedIn is data rather than
          conversations. See <Link href="/alternatives/phantombuster">PhantomBuster compared</Link>.
        </li>
      </ul>
      <p>
        Every tool side by side, by published caps, warm-up and price, is on{" "}
        <Link href="/alternatives">the LinkedIn automation tools comparison</Link>. If you are
        weighing agents rather than senders, the{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        lists the questions to ask any vendor, including us.
      </p>

      <h2 id="switching">Switching without contacting anyone twice</h2>
      <p>
        Leaving a multi-sender tool is mostly about one question: which of those senders is the
        profile you are moving, and who has it already written to.
      </p>
      <ol>
        <li>
          <strong>Take the profile out of HeyReach&rsquo;s rotation.</strong> If it stays in a
          sender pool, HeyReach can keep sending from it while Nora counts a different day.
        </li>
        <li>
          <strong>Let its running campaigns finish, or pause them.</strong> One person hearing from two
          tools in the same week is the quickest way to look automated.
        </li>
        <li>
          <strong>Keep your own record of who it contacted,</strong> then put the people and companies
          you must not reach twice on Nora&rsquo;s exclusion list. Nora&rsquo;s own rule against
          contacting anyone twice starts from its first send, so the history has to come with you.
        </li>
        <li>
          <strong>Connect the account and approve one customer profile.</strong> It begins at{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} invitations a day however long it sent through HeyReach,
          because the warm-up counts from its first send through Nora.
        </li>
        <li>
          <strong>Read the notes and launch.</strong> If you would rather not wait for the schedule,
          you can send the first invitation straight away and see what happened to it.
        </li>
      </ol>
    </ArticleLayout>
  );
}
