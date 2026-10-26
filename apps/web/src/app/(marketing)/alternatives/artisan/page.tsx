import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { Glance, NORA, Verdict, NOT_DOCUMENTED, withGlanceSources, type GlanceTool } from "../_glance";

const PATH = "/alternatives/artisan";
export const metadata: Metadata = articleMeta(PATH);

const GLANCE: readonly GlanceTool[] = ["nora", "artisan", "elevenx", "aisdr", "heyreach", "expandi", "waalaxy"];

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
    a: "Yes. As of October 2026 LinkedIn sequencers often cost under $100 per sender a month. Nora starts with a 14-day free trial with no card, and its plans are on the pricing page. The trade-off is scope: Nora works on LinkedIn only and sends at a careful pace, while Artisan runs email at volume with its own contact database. If email is your channel, a cheaper email-first agent is the closer swap.",
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

const SOURCES: readonly Source[] = withGlanceSources(
  [
    { label: "Artisan: AI sales agent product page (checked October 2026)", url: ARTISAN_AGENT },
    { label: "Artisan: pricing page (checked October 2026)", url: ARTISAN_PRICING },
    { label: "SalesRobot: Artisan AI review with plan prices (a vendor in the same market)", url: ARTISAN_REVIEW },
    { label: "Valley: Artisan pricing explained, reporting quote-only plans (a vendor in the same market)", url: ARTISAN_PRIVATE },
    { label: "ZoomInfo Pipeline: Artisan review 2026", url: ZOOMINFO_REVIEW },
    { label: "TechCrunch: LinkedIn banned AI agent startup Artisan, but now it's back (January 7, 2026)", url: TECHCRUNCH },
    { label: "11x help center: pricing overview (checked October 2026)", url: ELEVENX_DOCS },
    { label: "11x docs: Alice overview", url: ELEVENX_ALICE },
    { label: "Landbase: 11x pricing breakdown (a vendor in the same market)", url: ELEVENX_THIRD },
    { label: "ZoomInfo Pipeline: AiSDR pricing, verified May 2026", url: AISDR_ZOOMINFO },
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
      h1="Artisan AI alternatives: an AI SDR for buyers who answer on LinkedIn"
      lede="The best Artisan AI alternative depends on your channel. If you sell by email at volume, another email-first agent such as 11x or AiSDR is the closer swap. If your buyers answer on LinkedIn, an AI SDR built for LinkedIn fits better: Nora writes a note for each person, and a human approves the strategy, the copy and the launch."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">Nora or Artisan: the short answer</h2>
      <Verdict
        rival="Artisan"
        nora={["Your buyers answer on LinkedIn more readily than by email.", "You want to read every note and approve the launch before anything is sent.", "You want to start with a 14-day free trial, with no card."]}
        them={["Your buyers reply to email, and you need volume in the thousands a month.", "You want contact data, sequencing and deliverability tools from one vendor.", "You are comfortable with an agent that runs largely on its own once configured."]}
      />

      <h2 id="at-a-glance">Artisan alternatives at a glance</h2>
      <p>
        Seven tools people weigh against Artisan, by who each suits, what it costs to start and what
        it publishes about LinkedIn volume. &ldquo;Not published&rdquo; means we could not find it,
        not that it does not exist.
      </p>
      <Glance tools={GLANCE} />

      <h2 id="why-alternative">Why people look for Artisan AI alternatives</h2>
      <p>
        Artisan is one of the best-known AI SDRs, and plenty of teams are happy with it. The reasons
        people look elsewhere are usually one of four:
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

      <h2 id="artisan-in-brief">Artisan in brief, fairly</h2>
      <p>
        Artisan&rsquo;s agent, Ava, finds leads from a large B2B contact database Artisan provides,
        researches them, writes personalized email sequences and follows up. Artisan&rsquo;s{" "}
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
        source reports that those plans were withdrawn mid-2026 in favor of{" "}
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
        page and its employees&rsquo; profiles, and reinstated them by early January 2026.
        Artisan&rsquo;s CEO told <Ext href={TECHCRUNCH}>TechCrunch</Ext> that LinkedIn objected to the
        use of LinkedIn&rsquo;s name on Artisan&rsquo;s website and to data brokers Artisan used that
        had scraped LinkedIn, and that both were addressed. That was about the company&rsquo;s own
        presence; we have seen no evidence about customers&rsquo; accounts and suggest none.
      </p>

      <h2 id="side-by-side">Nora vs Artisan: side by side</h2>
      <CompareTable
        caption="Nora compared with Artisan, as of October 2026"
        columns={["Nora", "Artisan (Ava)"]}
        rows={[
          { label: "Main channel", values: ["LinkedIn only", "Email, with LinkedIn touchpoints"] },
          { label: "Who finds prospects", values: ["LinkedIn search on your own account's tier", "Artisan's own B2B contact database"] },
          { label: "Connection notes", values: [NORA.notes, "Not published for LinkedIn"] },
          { label: "Human approval", values: [NORA.approval, "A largely autonomous agent you configure"] },
          { label: "Daily invitations", values: [NORA.daily, "Not published"] },
          { label: "Weekly ceiling", values: [NORA.weekly, "Not published"] },
          { label: "Replies", values: [NORA.replies, "Email replies suggested for you to send"] },
          { label: "Meeting booking", values: [NORA.booking, NOT_DOCUMENTED] },
          { label: "Email deliverability tools", values: ["None: no email channel", "Warm-up, monitoring, sending limits"] },
        ]}
      />

      <h2 id="where-nora-differs">Where Nora differs from Artisan</h2>
      <p>
        Nora drafts customer profiles from your website, searches LinkedIn through your own account
        once you approve one, and writes each connection note from that person&rsquo;s profile.
        Nothing reaches anyone until a person launches the campaign; the full flow is on{" "}
        <Link href="/how-it-works">how Nora works</Link>.
      </p>
      <p>
        Against Artisan, the real difference is which channel the guardrails were built for.
        Artisan&rsquo;s published safety work is email deliverability: mailbox warm-up, placement
        monitoring, sending limits. Nora sends no email, so it has none of that. It has the LinkedIn
        version instead, which we could not find for Ava: {PUBLIC_LIMITS.invitesPerDayStart}{" "}
        invitations a day at the start, rising over about {PUBLIC_LIMITS.warmupWeeks} weeks from the
        account&rsquo;s first send, a ceiling of {PUBLIC_LIMITS.invitesPerWeek} a week across every
        campaign, and a day&rsquo;s invitations spread across your working hours instead of sent in a
        burst. The reasoning is on <Link href="/linkedin-automation-limits">the limits page</Link>.
        LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits automated access, so
        no tool, Nora included, is risk-free.
      </p>
      <p>
        The other difference is where the prospects come from. A database gives Artisan reach a
        LinkedIn account cannot match; a LinkedIn search gives Nora people whose profile it can open
        and read before writing a word, and the review screen shows which of those details each note
        used. If your buyers rarely open cold email, that trade usually favors the profile.
      </p>

      <h2 id="11x">If you were also looking at 11x</h2>
      <p>
        11x is the other name most often compared with Artisan. Its{" "}
        <Ext href={ELEVENX_ALICE}>documentation</Ext> describes its outbound agent, Alice, working
        across email, phone, LinkedIn and SMS. Its <Ext href={ELEVENX_DOCS}>help center</Ext> says
        pricing comes in Growth, Pro and Enterprise tiers billed annually, with no setup fee, and a
        third-party breakdown reports the <Ext href={ELEVENX_THIRD}>Growth tier at $3,750 a month</Ext>{" "}
        as of 2026. It suits larger teams who want one agent across many channels. The reasons to
        look elsewhere are the same as for Artisan: contract size, and LinkedIn being one channel
        among several rather than the one the product is built around.
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
        gives seven questions to put to any vendor, including us.
      </p>

      <h2 id="switching">Switching without contacting anyone twice</h2>
      <p>
        Moving from Artisan is less a migration than a split: email can stay where it is while
        LinkedIn moves. The risk is one person hearing from both tools in the same week.
      </p>
      <ol>
        <li>
          <strong>Stop Ava&rsquo;s LinkedIn actions on the account you will connect.</strong> If Ava
          keeps sending connection requests from that profile, Nora&rsquo;s caps no longer describe
          what the account is doing.
        </li>
        <li>
          <strong>Exclude the people Ava is already working.</strong> Nora&rsquo;s rule against
          contacting anyone twice only knows who Nora has contacted. Add open deals, current customers
          and anyone mid-sequence in Artisan to Nora&rsquo;s exclusion list, by company or by profile
          link.
        </li>
        <li>
          <strong>Connect the account and approve one customer profile.</strong> It starts at{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} invitations a day whatever it sent before, because the
          warm-up counts from its first send through Nora.
        </li>
        <li>
          <strong>Read the notes, then launch.</strong> A campaign stays a draft until you do, so
          nothing reaches anyone while you are still deciding.
        </li>
      </ol>
    </ArticleLayout>
  );
}
