import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { Gb1Timeline, type Gb1Step } from "@/components/seo/gb1-visuals";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/guides/linkedin-automation-tool-bans";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "Why did LinkedIn ban HeyReach?",
    a: "Nobody outside LinkedIn knows, because LinkedIn has published no reason. On March 25, 2026, it removed HeyReach’s company page and restricted several executives’ personal profiles. Competitors have attributed it to HeyReach’s cloud and proxy setup, but that is inference. HeyReach says it received no notice. The safe reading is that LinkedIn prohibits automation tools in general and acted against a well-known one.",
  },
  {
    q: "Are HeyReach users affected?",
    a: "As of October 2026 we found no public evidence that customers’ LinkedIn accounts were restricted because of the March action, and no report that HeyReach’s own page has been restored. HeyReach says customer accounts, campaigns and its platform kept running normally. Individual accounts using any automation tool can still be restricted for what they send, exactly as before.",
  },
  {
    q: "Is LinkedIn cracking down on automation?",
    a: "Two vendor-level actions are documented: against Apollo and Seamless in March 2025 and against HeyReach in March 2026. Each took down the vendor’s own LinkedIn presence, gave no public reason, and left the product reported as working. Two events are not a published policy. The rule itself has not changed: LinkedIn’s terms prohibit automated activity, and they did before either event.",
  },
  {
    q: "Did LinkedIn ban Apollo?",
    a: "It removed Apollo.io’s company page, not the product, in March 2025, along with Seamless.ai’s. That is the closest precedent for the HeyReach action: a vendor’s own presence on LinkedIn taken down without a published reason while the software kept working. Apollo’s page has reportedly returned since, which is one reason not to assume HeyReach’s removal is permanent.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "HeyReach: LinkedIn deleted HeyReach company page. Here’s what it didn’t delete.", url: "https://www.heyreach.io/blog/heyreach-ban" },
  { label: "HeyReach: Quick update from Nick, CEO (March 25, 2026)", url: "https://www.heyreach.io/blog/quick-update-from-nick" },
  { label: "MarTech: A pair of lead gen providers have disappeared from LinkedIn (March 2025)", url: "https://martech.org/a-pair-of-lead-gen-providers-have-disappeared-from-linkedin/" },
  { label: "Salesmotion: When LinkedIn removed Apollo’s brand page (March 2025)", url: "https://salesmotion.io/blog/linkedin-removed-apollo-brand-page-2025-alternatives" },
  { label: "Northlight: Northlight vs HeyReach (a competitor’s account of the cause)", url: "https://northlight.ai/blog/northlight-vs-heyreach" },
  { label: "Wonda: Is LinkedIn automation safe? The HeyReach ban, explained", url: "https://www.wonda.sh/blog/linkedin-automation-safety-heyreach-ban" },
  { label: "LinkedIn Help: Automated activity on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/90586" },
];

const CLAIMS = [
  {
    label: "“The ban is permanent”",
    values: [
      "Unverified",
      "Some competitor blogs call it permanent. HeyReach’s CEO called the restrictions temporary. LinkedIn has said nothing either way.",
    ],
  },
  {
    label: "“LinkedIn acted because of HeyReach’s cloud and proxy setup”",
    values: ["Unverified", "Inference by commentators, several of them competitors. LinkedIn has given no reason."],
  },
  {
    label: "“Customers\u2019 LinkedIn accounts were banned”",
    values: ["No public evidence", "HeyReach says customer accounts were unaffected, and we found no report of a customer-side outage tied to the removal."],
  },
  {
    label: "“Four executives were restricted”",
    values: ["Partly verified", "HeyReach’s own post names its CEO, CTO, CRO and CMO. Some third-party write-ups name fewer."],
  },
  {
    label: "“About 40% of automation users were restricted in early 2026”",
    values: ["Unverified", "Published by vendors without a method we could inspect. We could not trace it to any study."],
  },
  {
    label: "“LinkedIn flagged the accounts of Apollo and Seamless users” (2025)",
    values: ["Unverified", "One write-up says so; contemporaneous coverage and Apollo’s statement do not support it."],
  },
];

const STATUS_CLASS: Record<string, string> = {
  Unverified: "is-unverified",
  "Partly verified": "is-verified",
};

/*
 * The dated record the "verified" section rests on. Dates are the ones every
 * account agrees on; a step we could not date is labeled as such rather than
 * given a date nobody reported.
 */
const TIMELINE: readonly Gb1Step[] = [
  {
    when: "Around March 6, 2025",
    dateTime: "2025-03-06",
    title: "Apollo.io and Seamless.ai company pages disappear from LinkedIn",
    body: (
      <p>
        Reported by MarTech at the time, which noted that both sold sales data and that coverage linked the removals to
        LinkedIn&rsquo;s stance on scraping. That link was inference: LinkedIn gave no reason. Apollo&rsquo;s CEO said the
        company was working with LinkedIn to understand the restriction and that Apollo&rsquo;s services were not disrupted.
      </p>
    ),
  },
  {
    when: "Later, date not reported",
    title: "Apollo\u2019s company page is reported restored",
    body: <p>Neither side has explained the removal or the return.</p>,
    gap: { label: "Months later", size: 1 },
    tone: "muted",
  },
  {
    when: "March 25, 2026",
    dateTime: "2026-03-25",
    title: "HeyReach\u2019s company page removed; executives\u2019 profiles restricted",
    body: (
      <ul>
        <li>The date comes from HeyReach&rsquo;s own posts, and every third-party account we read agrees.</li>
        <li>
          HeyReach&rsquo;s later post names its CEO, CTO, CRO and CMO as restricted. Some third-party write-ups name fewer, so
          treat the list as HeyReach&rsquo;s account.
        </li>
        <li>HeyReach says there was no notice beforehand, and we found no statement from LinkedIn about the action.</li>
        <li>
          HeyReach says only its own presence was hit (no page, posts or ads) while customer accounts, campaigns and the
          platform carried on, and its CEO called the restrictions temporary the same day. We cannot check that, and found no
          report contradicting it.
        </li>
      </ul>
    ),
    gap: { label: "About a year after the Apollo removal", size: 3 },
  },
  {
    when: "As of October 2026",
    dateTime: "2026-10",
    title: "No reported restoration and no statement from LinkedIn",
    body: (
      <p>
        HeyReach&rsquo;s own account still describes the page as gone. We could not check LinkedIn directly, so read this as
        the latest reported state. If the page returns, it would follow the Apollo precedent: a removal and a return, neither
        explained.
      </p>
    ),
    gap: { label: "Seven months on", size: 2 },
    tone: "muted",
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="The HeyReach ban: what LinkedIn did in March 2026, and what is verified"
      lede="The HeyReach ban was LinkedIn removing HeyReach’s company page and restricting several of its executives’ personal profiles on March 25, 2026. HeyReach says its product and its customers’ campaigns kept running; LinkedIn has published no reason, and as of October 2026 we found no report that the page has been restored."
      faq={FAQ}
      sources={SOURCES}
    >
      <p>
        This page separates what is documented from what is claimed, then turns to what it means for the LinkedIn account you
        send from. We make a LinkedIn automation tool ourselves, so we label every source: where it is only HeyReach, or a
        competitor of HeyReach, we say so. As of October 2026 no general news outlet had covered the HeyReach event; the 2025
        Apollo and Seamless removals were covered by the trade press at the time.
      </p>

      <h2 id="verified">What is verified about the HeyReach ban, with dates</h2>
      <Gb1Timeline label="LinkedIn’s actions against automation vendors, 2025 to October 2026" steps={TIMELINE} />

      <h2 id="unverified">What is claimed but not verified</h2>
      <p>
        A lot has been written about these events, much of it by tools selling an alternative. These are the claims we could not
        verify, and why.
      </p>
      <CompareTable
        caption="Claims about LinkedIn’s action against automation vendors, and their status as of October 2026"
        columns={["Status", "Why"]}
        rows={CLAIMS.map((claim) => ({
          label: claim.label,
          values: [<span key="status" className={`gb1-status ${STATUS_CLASS[claim.values[0] ?? ""] ?? ""}`}>{claim.values[0]}</span>, claim.values[1]],
        }))}
      />
      <p>
        The pattern to notice: the claims that would sell a competing product most effectively (permanent, caused by the very
        architecture the competitor does not use, harming customers) are the ones with the least evidence behind them.
      </p>

      <h2 id="two-levels">Platform-level enforcement versus account-level restriction</h2>
      <p>
        Two different things get called a &ldquo;ban&rdquo;, and confusing them is where most of the panic comes from.
      </p>
      <CompareTable
        caption="Vendor-level action compared with account-level restriction"
        columns={["Vendor-level action", "Account-level restriction"]}
        rows={[
          { label: "Who it hits", values: ["The tool company’s own page and its executives’ profiles", "Your personal LinkedIn account"] },
          { label: "How often", values: ["Rare: two documented events in two years", "Routine, every day, across every tool"] },
          { label: "What triggers it", values: ["Not published", "Published in outline: volume, speed, ignored or reported invitations, suspected automation"] },
          { label: "Whether you control it", values: ["No", "Mostly: it follows what your account sends"] },
          { label: "What it costs you", values: ["Vendor risk: the tool may change or stop", "Days to weeks without invitations, or worse"] },
        ]}
      />
      <p>
        As far as the public evidence goes, both documented actions targeted companies, not the people using their products.
        Individual accounts are restricted for what they do, and LinkedIn&rsquo;s help center says it does not allow third-party
        software that automates activity on its site, and that an account restricted for automated activity is re-enabled once
        the software is disabled. That rule applies to every tool, including ours, and was true before March 2026.
      </p>

      <h2 id="if-affected">If your tool is affected</h2>
      <p>
        Whether your vendor is HeyReach or the next company this happens to, the steps are the same.
      </p>
      <ol>
        <li>
          <strong>Export your data today.</strong> Prospect lists, conversations, who was contacted and when. A vendor losing its
          LinkedIn presence is the vendor&rsquo;s business risk; it becomes yours if your history lives only inside it.
        </li>
        <li>
          <strong>Check your own account, not the news.</strong> Can you send an invitation by hand? Any notice on login? If the
          account is fine, nothing about it changed when the vendor&rsquo;s page disappeared.
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
          warm-up start from my first send? What happens on LinkedIn&rsquo;s first refusal? Do you store my LinkedIn password? Can I
          export everything today without asking support?
        </li>
      </ol>
      <p>
        If you are comparing replacements, our <Link href="/alternatives/heyreach">HeyReach alternatives page</Link> sets out who
        each kind of tool suits, and{" "}
        <Link href="/guides/cloud-vs-browser-extension-linkedin-automation">cloud vs browser-extension automation</Link> covers
        the architecture argument competitors made after March.
      </p>

      <h2 id="lesson">The lesson: behavior matters more than which vendor you use</h2>
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
    </ArticleLayout>
  );
}
