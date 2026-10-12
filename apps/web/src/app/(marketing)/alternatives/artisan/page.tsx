import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/alternatives/artisan";
export const metadata: Metadata = articleMeta(PATH);

const FIRST_MESSAGE_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / 60_000);
const FIRST_MESSAGE_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / 60_000);

const ARTISAN_AGENT = "https://www.artisan.co/ai-sales-agent";
const ARTISAN_PRICING = "https://artisan.co/pricing";
const ARTISAN_REVIEW = "https://www.salesrobot.co/blogs/artisan-ai-review";
const ARTISAN_PRIVATE = "https://www.joinvalley.co/blog/artisan-pricing-explained-2026";
const ZOOMINFO_REVIEW = "https://pipeline.zoominfo.com/sales/artisan-review";
const TECHCRUNCH = "https://techcrunch.com/2026/01/07/yes-linkedin-banned-ai-agent-startup-artisan-but-now-its-back";
const ELEVENX_DOCS = "https://docs.11x.ai/help-center/overview/11x-pricing-overview";
const ELEVENX_ALICE = "https://docs.11x.ai/alice/overview";
const ELEVENX_THIRD = "https://www.landbase.com/blog/11x-ai-pricing";
const AISDR_ZOOMINFO = "https://pipeline.zoominfo.com/sales/aisdr-pricing";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";

const FAQ: readonly Faq[] = [
  {
    q: "How much does Artisan Ava cost?",
    a: "As of October 2026 the sources disagree. Reviews checked in early October list self-serve plans at $250 and $600 a month billed annually, with higher monthly rates, while another source reports those plans were replaced mid-2026 by quote-only tiers. Artisan sells mainly through a sales call, so ask for a written quote that states the credit allowance and the contract length.",
  },
  {
    q: "Does Artisan work on LinkedIn?",
    a: "Yes, as one channel. Artisan says Ava sends LinkedIn connection requests and messages for your team, and independent reviews describe LinkedIn as a set of touchpoints, such as profile views and connection requests, inside a workflow where email is the main channel. We could not find published LinkedIn daily limits or warm-up rules for Ava.",
  },
  {
    q: "Is there a cheaper alternative to Artisan?",
    a: "Yes. LinkedIn sequencers often cost under $100 per sender a month. Nora is free for now, with no card and no contract. The trade-off is scope: Nora works on LinkedIn only and sends at a careful pace, while Artisan runs email at volume with its own contact database. If email is your channel, a cheaper email-first agent is the closer swap.",
  },
  {
    q: "How much does 11x cost?",
    a: "11x's help center says its agents are priced on Growth, Pro and Enterprise tiers, billed annually, with no setup fee, and that Pro and Enterprise are quoted. A third-party breakdown reports Alice's Growth tier at $3,750 a month as of 2026, which is about $45,000 a year. Confirm with 11x before budgeting.",
  },
  {
    q: "Is Artisan AI worth it?",
    a: "For a team that sells by email at volume, wants a contact database and deliverability tooling in one product, and can commit to a contract, it can be. For a founder or small team whose buyers answer on LinkedIn, much of what you pay for is email infrastructure you will not use, and a LinkedIn-native tool fits better.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "Artisan: AI sales agent product page (checked October 2026)", url: ARTISAN_AGENT },
  { label: "Artisan: pricing page (checked October 2026)", url: ARTISAN_PRICING },
  { label: "SalesRobot: Artisan AI review with plan prices (a vendor in the same market)", url: ARTISAN_REVIEW },
  { label: "Valley: Artisan pricing explained, reporting quote-only plans (a vendor in the same market)", url: ARTISAN_PRIVATE },
  { label: "ZoomInfo Pipeline: Artisan review 2026", url: ZOOMINFO_REVIEW },
  { label: "TechCrunch: LinkedIn banned AI agent startup Artisan, but now it's back (7 January 2026)", url: TECHCRUNCH },
  { label: "11x help center: pricing overview (checked October 2026)", url: ELEVENX_DOCS },
  { label: "11x docs: Alice overview", url: ELEVENX_ALICE },
  { label: "Landbase: 11x pricing breakdown (a vendor in the same market)", url: ELEVENX_THIRD },
  { label: "ZoomInfo Pipeline: AiSDR pricing, verified May 2026", url: AISDR_ZOOMINFO },
  { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
  { label: "Marketbetter: best Artisan alternatives (studied for this page)", url: "https://marketbetter.ai/blog/best-artisan-alternatives-2026" },
  { label: "Tooljunction: Artisan AI alternatives (studied for this page)", url: "https://www.tooljunction.io/ai-tools/artisan-ai/alternatives" },
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
      h1="Artisan AI alternatives for teams whose buyers live on LinkedIn"
      lede="The best Artisan AI alternatives depend on your channel: if you sell by email at volume, another email-first agent such as 11x or AiSDR is the closer swap, and if your buyers answer on LinkedIn, a LinkedIn-native AI SDR fits better. Nora is the second kind: it writes one note per person, a human approves the strategy, the copy and the launch, and it is free for now with no contract."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="why-alternative">Why people look for Artisan AI alternatives</h2>
      <p>
        Artisan is one of the best-known AI SDRs, and plenty of teams are happy with it. The reasons people search
        for an alternative are usually one of four:
      </p>
      <ul>
        <li>
          <strong>Price and contract.</strong> Artisan sells largely through sales calls, and annual
          terms are the norm on its published tiers. That is a lot to commit before you know whether
          outbound works for you.
        </li>
        <li>
          <strong>Channel.</strong> Ava is built around email. If your buyers ignore cold email but
          answer on LinkedIn, much of the product is aimed at the wrong inbox.
        </li>
        <li>
          <strong>Control.</strong> Some teams want to read every message before it goes out under
          their name, rather than supervise a largely autonomous agent.
        </li>
        <li>
          <strong>Fit for a small team.</strong> A contact database and email infrastructure are
          valuable at volume and overhead for a founder sending a few dozen messages a week.
        </li>
      </ul>
      <p>
        The pages ranking for this search mostly list other email-first agents, or are directories.
        This one is for people whose problem is the channel.
      </p>

      <h2 id="artisan-in-brief">Artisan in brief, fairly</h2>
      <p>
        Artisan&rsquo;s agent, Ava, finds leads from a large B2B contact database Artisan provides,
        researches them, writes personalised email sequences and follows up. Artisan&rsquo;s{" "}
        <Ext href={ARTISAN_AGENT}>product page</Ext> says Ava also sends LinkedIn connection requests
        and messages for your team. Its <Ext href={ARTISAN_PRICING}>pricing page</Ext> lists email
        deliverability tools: mailbox warm-up, health and placement monitoring and dynamic sending
        limits. Independent reviews describe the LinkedIn side as basic next to the email side, and
        ZoomInfo&rsquo;s <Ext href={ZOOMINFO_REVIEW}>2026 review</Ext> notes that Ava suggests replies
        to incoming email rather than sending them.
      </p>

      <h3 id="artisan-who-it-suits">Who it suits</h3>
      <p>
        Teams that sell by email, want a database, sequencing and deliverability in one product, and
        are ready for a contract. If you were going to buy a data provider and an email sequencer
        anyway, Artisan bundles them with an agent.
      </p>

      <h3 id="artisan-pricing">Pricing as of October 2026 (sourced)</h3>
      <p>
        This is genuinely unclear, and we would rather say so than pick a number. A review checked in
        early October 2026 lists <Ext href={ARTISAN_REVIEW}>self-serve plans</Ext> at $250 and $600 a
        month billed annually, higher on monthly billing, each with a monthly credit allowance. Another
        source reports that those plans were withdrawn mid-2026 in favour of{" "}
        <Ext href={ARTISAN_PRIVATE}>quote-only tiers</Ext>. Both are written by competitors. Ask
        Artisan for a written quote, and ask how many credits a full campaign to one person uses. Our{" "}
        <Link href="/guides/ai-sdr-pricing">AI SDR pricing guide</Link> sets these figures beside the
        cost of a human SDR.
      </p>

      <h3 id="artisan-limits">How it handles limits and warm-up</h3>
      <p>
        For email, Artisan publishes warm-up and dynamic sending limits. For LinkedIn, we could not
        find published daily caps, a weekly ceiling or a warm-up schedule for Ava as of October 2026.
        That does not mean none exist; ask before you connect an account you care about.
      </p>
      <p>
        One piece of history is worth knowing. In late 2025 LinkedIn removed Artisan&rsquo;s company
        page and its staff&rsquo;s profiles, and reinstated them by early January 2026. Artisan&rsquo;s
        CEO told <Ext href={TECHCRUNCH}>TechCrunch</Ext> that LinkedIn objected to the use of
        LinkedIn&rsquo;s name on Artisan&rsquo;s website and to data brokers Artisan used that had
        scraped LinkedIn, and that both were addressed. That was about the company&rsquo;s own
        presence; we have seen no evidence about customers&rsquo; accounts and suggest none.
      </p>

      <h2 id="side-by-side">Nora vs Artisan: side by side</h2>
      <CompareTable
        caption="Nora compared with Artisan, as of October 2026"
        columns={["Nora", "Artisan (Ava)"]}
        rows={[
          { label: "Main channel", values: ["LinkedIn only", "Email, with LinkedIn touchpoints"] },
          { label: "Where prospects come from", values: ["LinkedIn search on your own account's tier", "Artisan's own B2B contact database"] },
          {
            label: "Connection notes",
            values: [`Written per person from their own profile, under ${INVITE_NOTE_MAX_CHARS} characters`, "Personalised emails; LinkedIn depth not published"],
          },
          { label: "Human approval", values: ["Strategy, copy and launch each approved by a person", "A largely autonomous agent you configure"] },
          {
            label: "LinkedIn pacing",
            values: [
              `${PUBLIC_LIMITS.invitesPerDayStart} rising to ${PUBLIC_LIMITS.invitesPerDayMax} a day from the first send, ${PUBLIC_LIMITS.invitesPerWeek} a week`,
              "Not published",
            ],
          },
          { label: "Replies", values: ["Answered from your documents, or held under your rules", "Email replies suggested for you to send"] },
          { label: "Meeting booking", values: ["Times from the availability you set, or your own scheduling link", "Not covered by the sources we checked"] },
          { label: "Email deliverability tools", values: ["None: no email channel", "Warm-up, monitoring, sending limits"] },
          { label: "Price", values: ["Free for now, no card", "Published tiers or a quote; sources disagree"] },
        ]}
      />

      <h3 id="finding-prospects">Finding prospects</h3>
      <p>
        Artisan starts from its database. Nora starts from your website: it drafts three to five
        customer profiles and waits until a person approves one. Then it searches LinkedIn on the tier
        your account actually has, opens each profile before it reaches the list, and drops anyone
        your workspace has already contacted. Without Sales Navigator some filters cannot be applied,
        and the campaign names them before launch.
      </p>

      <h3 id="writing-notes">Writing notes</h3>
      <p>
        Every connection note is written for one person from their own headline, role and company,
        and the review screen shows which details it used. A note containing a link is sent with no
        note at all, because links in invitations cut acceptance. You can test different angles side
        by side, with prospects split evenly between them.
      </p>

      <h3 id="replies-booking">Replies and booking</h3>
      <p>
        Nora checks for new acceptances every hour, and the first message goes out{" "}
        {FIRST_MESSAGE_MIN} to {FIRST_MESSAGE_MAX} minutes after it sees one, inside your working
        hours. Replies are answered only from the documents you
        give Nora; pricing, legal and negative replies wait for you unless you choose otherwise, and a
        prospect asking for a human always waits. Meeting times are picked from the availability you
        set, minus meetings already booked and times you have blocked out, never invented by the
        model.
      </p>

      <h3 id="safety">Safety guardrails</h3>
      <p>
        The caps above are product rules: an owner can lower them, nobody can raise them, and the
        ramp counts from an account&rsquo;s first send, not the day it was connected. A day&rsquo;s
        allowance is spread across working hours. Nobody contacted once is contacted again by another
        campaign, the shared exclusion list is checked before every send, and opt-outs are matched by
        rule as well as by the model. LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext>{" "}
        prohibits automated access, so no tool, Nora included, is risk-free.
      </p>

      <h3 id="price">Price</h3>
      <p>
        Nora is free for now for every workspace, with no card and no plan to choose; the{" "}
        <Link href="/pricing">pricing page</Link> says what happens if that changes.
      </p>

      <h2 id="11x">If you were also looking at 11x</h2>
      <p>
        11x is the other name most often compared with Artisan. Its{" "}
        <Ext href={ELEVENX_ALICE}>documentation</Ext> describes its outbound agent, Alice, working
        across email, phone, LinkedIn and SMS. Its <Ext href={ELEVENX_DOCS}>help center</Ext> says
        pricing comes in Growth, Pro and Enterprise tiers billed annually, with no setup fee, and a
        third-party breakdown reports the <Ext href={ELEVENX_THIRD}>Growth tier at $3,750 a month</Ext>.
        It suits larger teams who want one agent across many channels. The reasons to look elsewhere
        are the same as for Artisan: contract size, and LinkedIn being one channel among several
        rather than the one the product is built around.
      </p>

      <h2 id="other-alternatives">Other alternatives worth a look</h2>
      <ul>
        <li>
          <strong>AiSDR</strong>, if you want an email and LinkedIn agent on shorter terms: reported
          at <Ext href={AISDR_ZOOMINFO}>$900 or $2,500 a month on quarterly billing</Ext>.
        </li>
        <li>
          <strong>HeyReach</strong>, if you run many LinkedIn sender accounts for clients. See{" "}
          <Link href="/alternatives/heyreach">how Nora compares with HeyReach</Link>.
        </li>
        <li>
          <strong>Expandi</strong> or <strong>Waalaxy</strong>, if you want to build LinkedIn
          sequences yourself. See <Link href="/alternatives/expandi">Expandi compared</Link> and{" "}
          <Link href="/alternatives/waalaxy">Waalaxy compared</Link>.
        </li>
      </ul>
      <p>
        Every comparison is on the <Link href="/alternatives">LinkedIn automation tools</Link> page,
        and the <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        gives eight questions to put to any vendor, including us.
      </p>

      <h2 id="stay-with-artisan">Who should stay with Artisan</h2>
      <ul>
        <li>Your buyers reply to email, and you need volume measured in thousands a month.</li>
        <li>You want the contact data, the sequencing and the deliverability tooling from one vendor.</li>
        <li>You are comfortable with an agent that runs largely on its own once configured.</li>
      </ul>
      <p>
        Nora does none of those. If your buyers are on LinkedIn and you want to read what goes out
        before it does, it is worth an afternoon.
      </p>
      <Callout tone="info">
        <p>
          <a href={`${SITE.app}/signup`}>Sign up free</a>, connect one LinkedIn account and approve one
          customer profile. Nothing is sent until you launch.
        </p>
      </Callout>
    </ArticleLayout>
  );
}
