import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/guides/linkedin-automation-tool-bans";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "Why did LinkedIn ban HeyReach?",
    a: "Nobody outside LinkedIn knows, because LinkedIn has published no reason. On 25 March 2026 it removed HeyReach's company page and restricted several executives' personal profiles. Competitors have attributed it to HeyReach's cloud and proxy setup, but that is inference. HeyReach says it received no notice. The safe reading is that LinkedIn prohibits automation tools in general and acted against a well-known one.",
  },
  {
    q: "Are HeyReach users affected?",
    a: "As of October 2026 we found no public evidence that customers' LinkedIn accounts were restricted because of the March action. HeyReach says customer accounts, campaigns and its platform kept running normally. That says nothing about ordinary restrictions: individual accounts using any automation tool can still be restricted for what they send, exactly as before.",
  },
  {
    q: "Is LinkedIn cracking down on automation?",
    a: "Two vendor-level actions are documented: against Apollo and Seamless in March 2025 and against HeyReach in March 2026. Each took down the vendor's own LinkedIn presence, gave no public reason, and left the product reported as working. Two events are not a published policy. The rule itself has not changed: LinkedIn's terms prohibit automated activity, and they did before either event.",
  },
  {
    q: "Did LinkedIn ban Apollo?",
    a: "LinkedIn removed Apollo.io's company page, along with Seamless.ai's, around 6 March 2025, as MarTech reported at the time. Apollo's CEO said the company was working with LinkedIn to understand the restriction and that it did not disrupt Apollo's services. Later reports say Apollo's brand page has since been restored. LinkedIn has not explained either the removal or the return.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "HeyReach: LinkedIn deleted HeyReach company page. Here's what it didn't delete.", url: "https://www.heyreach.io/blog/heyreach-ban" },
  { label: "HeyReach: Quick update from Nick, CEO (25 March 2026)", url: "https://www.heyreach.io/blog/quick-update-from-nick" },
  { label: "MarTech: A pair of lead gen providers have disappeared from LinkedIn (March 2025)", url: "https://martech.org/a-pair-of-lead-gen-providers-have-disappeared-from-linkedin/" },
  { label: "Salesmotion: When LinkedIn removed Apollo's brand page (March 2025)", url: "https://salesmotion.io/blog/linkedin-removed-apollo-brand-page-2025-alternatives" },
  { label: "Overloop: HeyReach review 2026 (a competitor, studied for this page)", url: "https://overloop.com/blog/heyreach-review" },
  { label: "Valley: LinkedIn automation safety 2026 (a competitor, studied for this page)", url: "https://www.joinvalley.co/blog/linkedin-automation-safety-2026" },
  { label: "AIwithKay: HeyReach review 2026 (studied for this page)", url: "https://aiwithkay.com/blog/heyreach-review-2026" },
  { label: "Northlight: Northlight vs HeyReach (a competitor's account of the cause)", url: "https://northlight.ai/blog/northlight-vs-heyreach" },
  { label: "Wonda: Is LinkedIn automation safe? The HeyReach ban, explained", url: "https://www.wonda.sh/blog/linkedin-automation-safety-heyreach-ban" },
  { label: "LinkedIn Help: Automated activity on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/90586" },
];

const CLAIMS = [
  {
    label: "\"The ban is permanent\"",
    values: [
      "Unverified",
      "Some competitor blogs call it permanent. HeyReach's CEO called the restrictions temporary. LinkedIn has said nothing either way.",
    ],
  },
  {
    label: "\"LinkedIn acted because of HeyReach's cloud and proxy setup\"",
    values: ["Unverified", "Inference by commentators, several of them competitors. LinkedIn has given no reason."],
  },
  {
    label: "\"Customers' LinkedIn accounts were banned\"",
    values: ["No public evidence", "HeyReach says customer accounts were unaffected, and we found no report of a customer-side outage tied to the removal."],
  },
  {
    label: "\"Four executives were restricted\"",
    values: ["Partly verified", "HeyReach's own post names its CEO, CTO, CRO and CMO. Some third-party write-ups name fewer."],
  },
  {
    label: "\"About 40% of automation users were restricted in early 2026\"",
    values: ["Unverified", "Published by vendors without a method we could inspect. We could not trace it to any study."],
  },
  {
    label: "\"LinkedIn flagged the accounts of Apollo and Seamless users\" (2025)",
    values: ["Unverified", "One write-up says so; contemporaneous coverage and Apollo's statement do not support it."],
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="When LinkedIn acts against an automation tool: what happened in 2026"
      lede="The HeyReach ban, as it is usually called, was LinkedIn removing HeyReach's company page and restricting several of its executives' personal profiles on 25 March 2026. HeyReach says its product and its customers' campaigns kept running; LinkedIn has published no reason, and much of what has been written since, often by competitors, is unverified."
      faq={FAQ}
      sources={SOURCES}
    >
      <p>
        This page separates what is documented from what is claimed, then turns to the question most readers actually have: what
        it means for the LinkedIn account you send from. We make a LinkedIn automation tool ourselves, so we have tried to be
        careful. Where the only source is HeyReach, we say so. Where the source is a competitor of HeyReach, we say that too.
      </p>
      <Callout tone="info">
        <p>
          <strong>A note on sources, as of October 2026:</strong> we found no coverage of the HeyReach event by a general news
          outlet. The primary sources are HeyReach&apos;s own posts. The other write-ups are by software companies, several of
          which compete with HeyReach. The 2025 Apollo and Seamless event was covered by the trade press at the time.
        </p>
      </Callout>

      <h2 id="verified">What is verified about the HeyReach ban and the 2025 precedent, with dates</h2>

      <h3 id="apollo-seamless">Apollo and Seamless pages (March 2025)</h3>
      <ul>
        <li>
          <strong>Around 6 March 2025</strong> the LinkedIn company pages of Apollo.io and Seamless.ai disappeared. MarTech reported
          it at the time, noting that both sold sales data and that coverage linked the removals to LinkedIn&apos;s stance on
          scraping. That link was inference; LinkedIn gave no reason.
        </li>
        <li>
          <strong>Apollo&apos;s CEO</strong> said the company was working with LinkedIn to understand the brand page restriction, and
          that it did not disrupt Apollo&apos;s services.
        </li>
        <li>
          <strong>Later reports</strong> say Apollo&apos;s brand page has since been restored. We found no explanation of the
          restoration from either side.
        </li>
      </ul>

      <h3 id="heyreach">HeyReach company page and executives (March 2026)</h3>
      <ul>
        <li>
          <strong>On 25 March 2026</strong> LinkedIn removed HeyReach&apos;s company page. HeyReach&apos;s own posts give that date and
          every third-party account we read agrees.
        </li>
        <li>
          <strong>Executives&apos; personal profiles were restricted.</strong> HeyReach&apos;s later post names its CEO, CTO, CRO and
          CMO. Some third-party write-ups name fewer, so treat the exact list as HeyReach&apos;s account.
        </li>
        <li>
          <strong>No warning.</strong> HeyReach says there was no notice beforehand.
        </li>
        <li>
          <strong>No reason from LinkedIn.</strong> We found no statement from LinkedIn about the action.
        </li>
        <li>
          <strong>HeyReach&apos;s position</strong> is that the action was limited to its own presence on LinkedIn: no page, no
          posts, no ads, while customer accounts, campaigns and the platform carried on. Its CEO&apos;s same-day post called the
          restrictions temporary. We cannot check those statements independently, and we found no public report contradicting
          the claim that the software kept running.
        </li>
      </ul>

      <h2 id="unverified">What is claimed but not verified</h2>
      <p>
        A lot has been written about these events, much of it by tools selling an alternative. These are the claims we could not
        verify, and why.
      </p>
      <CompareTable
        caption="Claims about LinkedIn's action against automation vendors, and their status as of October 2026"
        columns={["Status", "Why"]}
        rows={CLAIMS}
      />
      <p>
        The pattern to notice: the claims that would sell a competing product most effectively (permanent, caused by the very
        architecture the competitor does not use, harming customers) are the ones with the least evidence behind them.
      </p>

      <h2 id="two-levels">Platform-level enforcement versus account-level restriction</h2>
      <p>
        Two different things get called a &quot;ban&quot;, and confusing them is where most of the panic comes from.
      </p>
      <CompareTable
        caption="Vendor-level action compared with account-level restriction"
        columns={["Vendor-level action", "Account-level restriction"]}
        rows={[
          { label: "Who it hits", values: ["The tool company's own page and staff profiles", "Your personal LinkedIn account"] },
          { label: "How often", values: ["Rare: two documented events in two years", "Routine, every day, across every tool"] },
          { label: "What triggers it", values: ["Not published", "Published in outline: volume, speed, ignored or reported invitations, suspected automation"] },
          { label: "Whether you control it", values: ["No", "Mostly: it follows what your account sends"] },
          { label: "What it costs you", values: ["Vendor risk: the tool may change or stop", "Days to weeks without invitations, or worse"] },
        ]}
      />
      <p>
        As far as the public evidence goes, both documented actions targeted companies, not the people using their products.
        Individual accounts are restricted for what they do, and LinkedIn&apos;s help center says it does not allow third-party
        software that automates activity on its site, and that an account restricted for automated activity is re-enabled once
        the software is disabled. That rule applies to every tool, including ours, and was true before March 2026.
      </p>

      <h2 id="this-week">If your tool was affected: what to do this week</h2>
      <ol>
        <li>
          <strong>Export your data today.</strong> Prospect lists, conversations, who was contacted and when. A vendor losing its
          LinkedIn presence is the vendor&apos;s business risk; it becomes yours if your history lives only inside it.
        </li>
        <li>
          <strong>Check your own account, not the news.</strong> Can you send an invitation by hand? Any notice on login? If the
          account is fine, nothing about it changed when the vendor&apos;s page disappeared.
        </li>
        <li>
          <strong>Do not switch in a panic.</strong> Moving tools mid-campaign often means re-importing prospects into a tool that
          does not know who was already contacted, and the second message under a different pretext is how a careful campaign
          starts to look like spam. Finish or pause what is running, export, then decide.
        </li>
        <li>
          <strong>Never run two tools on one account at once.</strong> Each counts only its own sends and believes it has the whole
          day and week to itself.
        </li>
        <li>
          <strong>If you do move, restart low.</strong> The new tool does not know your history. Start near{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} invitations a day and ramp, as described in{" "}
          <Link href="/guides/linkedin-warm-up-schedule">how to warm up a LinkedIn account</Link>.
        </li>
        <li>
          <strong>Ask any vendor five questions.</strong> What are the daily and weekly caps, and can a plan raise them? Does the
          warm-up start from my first send? What happens on LinkedIn&apos;s first refusal? Do you store my LinkedIn password? Can I
          export everything today without asking support?
        </li>
      </ol>
      <p>
        If you are comparing replacements, our <Link href="/alternatives/heyreach">HeyReach alternatives page</Link> sets out who
        each kind of tool suits, and{" "}
        <Link href="/guides/cloud-vs-browser-extension-linkedin-automation">cloud vs browser-extension automation</Link> covers
        the architecture argument competitors made after March.
      </p>

      <h2 id="lesson">The lesson: behaviour matters more than which vendor you use</h2>
      <p>
        Neither documented action reached an individual account as far as anyone has shown. What reaches individual accounts,
        every day, is the pattern they send: a burst of invitations from an account with no history, a list of people who do not
        accept, a refusal answered with another attempt five minutes later. Those patterns travel with you from tool to tool. Our
        guide to <Link href="/guides/is-linkedin-automation-safe">whether LinkedIn automation is safe</Link> sets out what
        LinkedIn can observe and a checklist to hold any tool to.
      </p>
      <p>
        Nora is subject to the same rules as every tool on this page, and LinkedIn could act against us the same way. What we can
        control is how an account behaves while it uses us. Every account starts at {PUBLIC_LIMITS.invitesPerDayStart} connection
        requests a day, ramps to at most {PUBLIC_LIMITS.invitesPerDayMax} over {PUBLIC_LIMITS.warmupWeeks} weeks counted from its
        first send, and never passes {PUBLIC_LIMITS.invitesPerWeek} a week. Those caps are product rules, not a plan setting. A
        warning or restriction reported by LinkedIn pauses the account, and a restriction emails you. An owner or admin can
        export the whole workspace as a file at any time, so your work never depends on any single vendor, including us. The
        numbers are explained on the <Link href="/linkedin-automation-limits">LinkedIn limits page</Link>,{" "}
        <Link href="/how-it-works">how Nora works</Link> covers the rest, and more safety guides are in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>
      <Callout tone="safety">
        <p>
          If you want outreach that stays well under the line by design, <a href={`${SITE.app}/signup`}>Sign up free</a>. Nothing is
          sent until you approve and launch.
        </p>
      </Callout>
    </ArticleLayout>
  );
}
