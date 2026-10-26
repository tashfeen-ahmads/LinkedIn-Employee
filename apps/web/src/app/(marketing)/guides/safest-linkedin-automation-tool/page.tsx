import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { Gb1Summary } from "@/components/seo/gb1-visuals";
import { Scorecard, type ScoreMark } from "@/components/seo/gb2-scorecard";

const PATH = "/guides/safest-linkedin-automation-tool";
export const metadata: Metadata = articleMeta(PATH);

/** Read off the same ramp the sender enforces, never retyped. */
const DAY = 86_400_000;
const FIRST_SEND = new Date("2026-01-05T09:00:00Z");
const CAP_NEVER_SENT = dailyInviteCap(null);
const CAP_WEEK_2 = dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + 7 * DAY));
const CAP_WEEK_4 = dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + 21 * DAY));
const MIN_GAP_MIN = Math.round(LINKEDIN_LIMITS.minGapMs / 60_000);
const VIEWS_PER_DAY = LINKEDIN_LIMITS.profileViewsPerDay;
const WITHDRAW_DAYS = LINKEDIN_LIMITS.withdrawAfterDays;

const LI_PROHIBITED = "https://www.linkedin.com/help/linkedin/answer/a1341387";
const LI_AGREEMENT = "https://www.linkedin.com/legal/user-agreement";
const HEYREACH_LIMITS = "https://help.heyreach.io/en/articles/15128619-how-do-connection-request-limits-work-in-heyreach";
const DRIPIFY_LIMITS = "https://help.dripify.com/en/articles/8201637-how-dripify-daily-limits-safeguard-your-linkedin-account";
const WAALAXY_QUOTAS = "https://intercom.help/waalaxy/en/articles/10327318-what-are-quotas";
const PHANTOM_LIMITS = "https://phantombuster.com/blog/linkedin-automation/linkedin-automation-safe-limits-2026/";
const EXPANDI_HELP_LIMITS = "https://help.expandi.io/en/articles/9688856-recommended-limits";
const EXPANDI_WARMUP = "https://help.expandi.io/en/articles/5405001-account-warm-up";
const EXPANDI_DUPES = "https://help.expandi.io/en/articles/5405809-duplicating-leads-in-multiple-campaigns-removing-duplicates";
const EXPANDI_BLACKLIST = "https://help.expandi.io/en/articles/5405272-blacklists";
const HEYREACH_LAUNCH = "https://help.heyreach.io/en/articles/9877952-how-to-launch-your-first-campaign";
const DRIPIFY_FILTERS = "https://help.dripify.io/en/articles/11199236-step-2-how-to-manage-lead-list-filters";
const DRIPIFY_BLACKLIST = "https://help.dripify.com/en/articles/5029130-how-to-blacklist-certain-linkedin-users-in-dripify";
const WAALAXY_LIMITS = "https://blog.waalaxy.com/en/what-is-the-linkedin-maximum-connections-per-day/";
const WAALAXY_WEEKLY = "https://blog.waalaxy.com/en/bypass-linkedin-limit/";
const WAALAXY_BLACKLIST = "https://blog.waalaxy.com/en/how-to-create-a-blacklist-with-prospectin/";

/*
 * The scorecard. Every competitor cell rests on a vendor page listed in
 * SOURCES (the same pages the comparison pages cite); Nora's column is our own
 * claim about our own product and the page says so.
 */
/** A soft hyphen lets the longest name break at its seam in a narrow header. */
const TOOLS = ["Nora", "HeyReach", "Dripify", "Waalaxy", "Expandi", "Phantom\u00ADBuster"] as const;
const SCORECARD: ReadonlyArray<{ check: string; marks: readonly ScoreMark[] }> = [
  { check: "1. Published daily and weekly caps", marks: ["Pass", "Partly", "Partly", "Partly", "Partly", "Partly"] },
  { check: "2. A ramp from the first send", marks: ["Pass", "Not published", "Not published", "Not published", "Partly", "Not published"] },
  { check: "3. Pacing inside the day", marks: ["Pass", "Not published", "Not published", "Not published", "Not published", "Partly"] },
  { check: "4. A weekly ceiling across campaigns", marks: ["Pass", "Partly", "Not published", "Partly", "Partly", "Not published"] },
  { check: "5. Never contacting anyone twice", marks: ["Pass", "Partly", "Partly", "Partly", "Partly", "Not published"] },
  { check: "6. Opt-outs checked by rule", marks: ["Pass", "Not published", "Not published", "Not published", "Not published", "Not published"] },
  { check: "7. A human approves before launch", marks: ["Pass", "Pass", "Pass", "Pass", "Pass", "Pass"] },
  { check: "8. Honesty about restrictions", marks: ["Pass", "Not published", "Not published", "Not published", "Not published", "Not published"] },
];

const FAQ: readonly Faq[] = [
  {
    q: "Which LinkedIn automation tool is safest?",
    a: "No independent body measures it, so every published ranking is a vendor ranking itself. The safest tool is the one whose caps are published and enforced, whose warm-up counts from the first send, which spreads a day’s sending across the day, never contacts anyone twice, checks opt-outs by rule and makes you approve the launch. Run the 8 checks on this page against each candidate.",
  },
  {
    q: "Is LinkedIn automation safe?",
    a: "Not entirely. LinkedIn’s User Agreement prohibits bots and automated access, and its help center says accounts using third-party automation may be restricted. What a careful tool can change is how likely and how severe trouble is: low daily volume, a slow ramp, no bursts, and notes people want to accept. Read the full answer in our guide to whether LinkedIn automation is safe.",
  },
  {
    q: "Do dedicated IPs prevent LinkedIn bans?",
    a: "No. A fixed IP per account avoids one obvious red flag, an account jumping between addresses or sharing one with strangers, but LinkedIn also sees how much you send, how fast, and how many people accept or ignore you. A tool sending 75 invitations a day from a perfect IP is riskier than one sending 15 from an ordinary one.",
  },
  {
    q: "Is a cloud tool safer than a Chrome extension?",
    a: "Neither architecture is safe on its own. Extensions run in your browser, where LinkedIn’s page can see what is installed; cloud tools run your session on a server, so you must trust how they store it. What decides risk is volume, pacing and acceptance rate, which both kinds of tool control in the same way.",
  },
  {
    q: "Can any tool guarantee my account will not be restricted?",
    a: "No, and a tool that promises it is telling you something false. LinkedIn does not publish its limits, changes them, and judges accounts on signals no vendor can see in full. A tool can lower the odds and respond well when LinkedIn pushes back, by stopping, waiting hours rather than minutes, and telling you what happened.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Prohibited software and extensions", url: LI_PROHIBITED },
  { label: "LinkedIn User Agreement", url: LI_AGREEMENT },
  { label: "HeyReach help center: how connection request limits work (checked October 2026)", url: HEYREACH_LIMITS },
  { label: "Dripify help center: how daily limits safeguard your account (checked October 2026)", url: DRIPIFY_LIMITS },
  { label: "Waalaxy help center: what are quotas (checked October 2026)", url: WAALAXY_QUOTAS },
  { label: "PhantomBuster: LinkedIn automation safe limits 2026 (checked October 2026)", url: PHANTOM_LIMITS },
  { label: "Expandi help center: recommended limits (checked October 2026)", url: EXPANDI_HELP_LIMITS },
  { label: "Expandi help center: account warm-up", url: EXPANDI_WARMUP },
  { label: "Expandi help center: duplicated leads across campaigns", url: EXPANDI_DUPES },
  { label: "Expandi help center: blacklists", url: EXPANDI_BLACKLIST },
  { label: "HeyReach help center: launching your first campaign, with filters for leads already contacted", url: HEYREACH_LAUNCH },
  { label: "Dripify help center: lead list filters", url: DRIPIFY_FILTERS },
  { label: "Dripify help center: blacklisting LinkedIn users", url: DRIPIFY_BLACKLIST },
  { label: "Waalaxy blog: LinkedIn maximum connections per day", url: WAALAXY_LIMITS },
  { label: "Waalaxy blog: weekly limit on invitations sent on LinkedIn", url: WAALAXY_WEEKLY },
  { label: "Waalaxy blog: how to create a blacklist", url: WAALAXY_BLACKLIST },
];

function Ext({ href, children, cell = false }: { href: string; children: React.ReactNode; cell?: boolean }) {
  return (
    <a href={href} rel="noopener nofollow" target="_blank" className={cell ? "gb2-src" : undefined}>
      {children}
    </a>
  );
}

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="The safest LinkedIn automation tool is the one that passes these 8 checks"
      lede="The safest LinkedIn automation tool is the one that publishes and enforces low caps, ramps a new account from its first send, spreads each day’s sending across the day, never contacts the same person twice and makes a person approve the launch. No tool is risk-free, because LinkedIn’s terms prohibit automation, so judge every candidate on the 8 checks below rather than on who wrote the ranking."
      faq={FAQ}
      sources={SOURCES}
    >
      <Gb1Summary>
        <ul>
          <li>
            <strong>There is no neutral &ldquo;safest tool&rdquo; ranking.</strong> The lists you will
            find are written by vendors, and each puts itself at or near the top.
          </li>
          <li>
            <strong>Safety is behavior, not infrastructure.</strong> A dedicated IP or a cloud server
            helps a little; volume, bursts and acceptance rate decide most of the outcome.
          </li>
          <li>
            <strong>Check what is published and enforced.</strong> A cap you can raise to 75 a day is a
            default, not a guardrail.
          </li>
        </ul>
      </Gb1Summary>

      <h2 id="scorecard">The 8 checks, tool by tool</h2>
      <p>
        Six tools against the 8 checks this page explains, from what each vendor&rsquo;s own help center
        or blog said in October 2026. <strong>Pass</strong> means the vendor says the tool does it.{" "}
        <strong>Partly</strong> means it is published but looser than the check asks, or left to your
        settings. <strong>Not published</strong> means we could not find it, which is not proof the tool
        lacks it: ask. Nora&rsquo;s column is our own claim about our own product, so test it like the
        others.
      </p>
      <Scorecard
        caption="Scorecard: the 8 safety checks across six LinkedIn automation tools, as published by each vendor, October 2026"
        tools={TOOLS}
        rows={SCORECARD}
      />
      <ul>
        <li>
          <strong>Nora:</strong> passes all 8 by design; the cost is speed, with {CAP_NEVER_SENT} invitations
          a day in the first week.
        </li>
        <li>
          <strong>HeyReach:</strong> caps are published and shared across a sender&rsquo;s campaigns, but the
          200-a-week ceiling is twice what most guides report, and we found no automatic ramp.
        </li>
        <li>
          <strong>Dripify:</strong> a daily cap of up to 75 is published, with no weekly ceiling or ramp we
          could find; avoiding double contact is filters and a blacklist you apply.
        </li>
        <li>
          <strong>Waalaxy:</strong> publishes 80 to 100 a day on top plans and holds invitations past 200 a
          week to the next week; we found no automatic ramp.
        </li>
        <li>
          <strong>Expandi:</strong> the most conservative published guidance after Nora&rsquo;s, under 100 a
          week, and an optional ramp, but as recommendations and settings rather than enforced caps.
        </li>
        <li>
          <strong>PhantomBuster:</strong> sensible advice (15 to 25 a day for aged accounts) and pacing
          controls; the volume and the deduplication are yours to build.
        </li>
      </ul>

      <h2 id="why-rankings">Why every &ldquo;safest LinkedIn automation tool&rdquo; list ranks its author first</h2>
      <p>
        The best-known &ldquo;safest LinkedIn automation tool&rdquo; lists, as of October 2026, are
        written by vendors in this market, and each ranks its author at or near the top. Most are
        useful on the basics. None explains how a score was reached, and the ban rates quoted across
        vendor posts disagree widely, with no method we could check behind any of them.
      </p>
      <p>
        That is not a criticism of the writers; nobody outside LinkedIn has the data. LinkedIn does
        not publish its limits or its restriction rates, and no tool can see why a given account was
        restricted. So this page does something different. It gives you checks you can run yourself,
        in an afternoon, on any tool, including ours, and it shows what each tool actually puts in
        writing.
      </p>
      <Callout tone="safety">
        <p>
          LinkedIn&rsquo;s <Ext href={LI_AGREEMENT}>User Agreement</Ext> prohibits bots and automated
          access, and its help center says accounts using{" "}
          <Ext href={LI_PROHIBITED}>third-party automation software</Ext> may be restricted. Every
          tool on this page, Nora included, operates under that risk. The question is how much of it
          a tool takes on for you.
        </p>
      </Callout>

      <h2 id="eight-checks">8 checks you can run yourself</h2>
      <p>
        Each check has a question to ask the vendor and a test you can run before you commit. Where we
        say what Nora does, it is a rule built into the product, not a setting you could change.
      </p>

      <h3 id="caps">1. Published daily and weekly caps</h3>
      <p>
        Ask for numbers and ask whether you can raise them. A tool that lets you type 100 into a
        daily field has handed the safety decision to you on the day you are most impatient. Nora
        caps connection requests at {PUBLIC_LIMITS.invitesPerDayMax} a day at most and{" "}
        {PUBLIC_LIMITS.invitesPerWeek} a week, plus {PUBLIC_LIMITS.messagesPerDay} messages a day.
        An account owner can set lower caps, never higher, and no paid plan changes them. The
        reasoning is on <Link href="/linkedin-automation-limits">the LinkedIn automation limits page</Link>.
      </p>

      <h3 id="ramp">2. A ramp measured from the first send</h3>
      <p>
        Most tools offer a warm-up. The detail that matters is when it starts. A ramp counted from
        the day you connected the account gives an account connected a month ago, which has never
        sent anything, its full allowance on the first day it ever sends. Nora counts from the first
        action: an account that has never sent starts at {CAP_NEVER_SENT} a day however long ago it
        was connected, reaches {CAP_WEEK_2} a day a week after its first send, {CAP_WEEK_4} after
        three weeks, and {PUBLIC_LIMITS.invitesPerDayMax} after about {PUBLIC_LIMITS.warmupWeeks}{" "}
        weeks. The <Link href="/tools/linkedin-limit-calculator">LinkedIn limit calculator</Link>{" "}
        runs the same function for any start date.
      </p>

      <h3 id="pacing">3. Pacing inside the day</h3>
      <p>
        A daily cap with nothing underneath it is a burst with a maximum size. Ten invitations sent
        in forty minutes look nothing like ten sent across a working day, and the burst is the
        pattern detection systems are built to notice. We learned it the hard way, in{" "}
        <Link href="/guides/is-linkedin-automation-safe#incident">an incident we describe in full on our safety guide</Link>.
        Nora now spreads the day&rsquo;s allowance across the working hours left, never sends two
        actions less than {MIN_GAP_MIN} minutes apart, varies every gap at random, and sends only
        inside your working hours. Ask any vendor how a day&rsquo;s allowance is spread,
        not just how big it is.
      </p>

      <h3 id="weekly">4. A weekly ceiling across campaigns</h3>
      <p>
        Two campaigns each &ldquo;capped at 20 a day&rdquo; on one account is 40 a day. Check whether
        limits belong to the account or to each campaign. In Nora the daily allowance counts what
        every campaign on the account has sent today and has already queued, and the weekly ceiling
        of {PUBLIC_LIMITS.invitesPerWeek} covers all of them together. Profile views used to warm up
        a prospect have their own, lower allowance of {VIEWS_PER_DAY} a day, so warming somebody up
        never spends the budget for writing to them.
      </p>

      <h3 id="never-twice">5. Never contacting anyone twice, plus an exclusion list</h3>
      <p>
        A second message from the same company under a different campaign is what turns a polite
        request into spam, and it is how people come to press &ldquo;I don&rsquo;t know this
        person&rdquo;. Ask whether deduplication
        is per campaign or across the workspace, and when it is checked. Two campaigns built from
        the same audience can queue the same person legitimately, so the only safe moment to check is
        immediately before sending. That is where Nora checks both its record of everyone ever
        contacted and the shared exclusion list your team keeps, so a customer added to the list
        mid-morning stops an invitation that was already queued for later that day.
      </p>

      <h3 id="opt-outs">6. Opt-outs checked by rule</h3>
      <p>
        &ldquo;Please remove me&rdquo; has to stop everything, every time. A tool that relies only on
        a language model to notice will eventually miss one. Ask whether opt-out phrases are matched
        deterministically as well. In Nora they are matched before any model reads the message, and
        a match stops the conversation whatever the model would have said.
      </p>

      <h3 id="approval">7. A human approves before launch</h3>
      <p>
        The most common way an account gets into trouble is a campaign that went out before anybody
        read it: a list of the wrong people, or a note that reads like a template. Nora makes three
        decisions yours: the customer profile it searches for, the copy, and the launch. Each
        connection note is written for one person from their own profile, stays within LinkedIn&rsquo;s{" "}
        {INVITE_NOTE_MAX_CHARS}-character limit, and is sent with no note at all if it contains a link,
        because a link in an invitation reads as the first message of a sales sequence.
      </p>

      <h3 id="honesty">8. Honesty about restrictions</h3>
      <p>
        Ask the vendor what happens when LinkedIn says no. The wrong answer is &ldquo;we retry.&rdquo;
        Retrying every few minutes against an account LinkedIn is already throttling is how a
        temporary limit becomes a long one. When LinkedIn refuses an invitation, Nora waits hours,
        not minutes, and waits longer each time the refusal repeats. It withdraws invitations still
        pending after {WITHDRAW_DAYS} days, flags any account whose acceptance rate falls below{" "}
        {PUBLIC_LIMITS.healthyAcceptance}% for review, and a one-off test send from any campaign shows
        you LinkedIn&rsquo;s exact error message when it refuses, rather than a quiet zero. Also look at the
        marketing: a vendor promising
        &ldquo;100% safe&rdquo; or a precise ban rate is claiming something it cannot know. LinkedIn
        can act against a vendor as well as its users: read{" "}
        <Link href="/guides/linkedin-automation-tool-bans">what is and is not verified about LinkedIn&rsquo;s 2026 action against HeyReach</Link>.
      </p>

      <h2 id="what-tools-publish">What each tool publishes (as of October 2026)</h2>
      <p>
        This table records what each vendor&rsquo;s own help center or blog says, checked in October
        2026. It is not a test of what the tools do, and vendors change these numbers, so follow the
        links before relying on any of them. &ldquo;Not published&rdquo; means we could not find it,
        not that it does not exist.
      </p>
      <CompareTable
        caption="Connection request limits and warm-up, as published by each vendor, October 2026"
        columns={["Daily connection requests", "Weekly ceiling", "Warm-up"]}
        rows={[
          {
            label: "Nora",
            values: [
              `${PUBLIC_LIMITS.invitesPerDayStart} rising to ${PUBLIC_LIMITS.invitesPerDayMax}, enforced; owners can only lower it`,
              `${PUBLIC_LIMITS.invitesPerWeek}, across all campaigns`,
              `Automatic, about ${PUBLIC_LIMITS.warmupWeeks} weeks from the first send`,
            ],
          },
          {
            label: "HeyReach",
            values: [
              <>
                Default 25 per sender, settable up to 40 (<Ext cell href={HEYREACH_LIMITS}>help center</Ext>)
              </>,
              "200 per sender, then a cooldown until Monday",
              "Manual guidance, not an automatic ramp we could find",
            ],
          },
          {
            label: "Dripify",
            values: [
              <>
                Up to 75, adjustable, with a random range (<Ext cell href={DRIPIFY_LIMITS}>help center</Ext>)
              </>,
              "Not published",
              "Not published",
            ],
          },
          {
            label: "Waalaxy",
            values: [
              <>
                Up to 100 on top plans, varied at random between 80% and 100% of it (<Ext cell href={WAALAXY_QUOTAS}>help center</Ext>)
              </>,
              "Follows LinkedIn’s weekly limit; invitations past it wait for the next week",
              "Not published",
            ],
          },
          {
            label: "Expandi",
            values: [
              "Not published; set by you",
              <>
                Recommends staying under 100, not stated as enforced (<Ext cell href={EXPANDI_HELP_LIMITS}>help center</Ext>)
              </>,
              <>
                Optional: plus 2 a day every 1 to 3 days, off at 21 (<Ext cell href={EXPANDI_WARMUP}>help center</Ext>)
              </>,
            ],
          },
          {
            label: "PhantomBuster",
            values: [
              <>
                Suggests 15 to 25 for aged accounts, lower for new ones (<Ext cell href={PHANTOM_LIMITS}>blog</Ext>)
              </>,
              "Suggests 60 to 100",
              "Advice to start low, set by you",
            ],
          },
        ]}
      />
      <p>
        Two things stand out. First, the published weekly ceilings range from Nora&rsquo;s{" "}
        {PUBLIC_LIMITS.invitesPerWeek} to 200, and the published daily maximums from{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} to 100, which tells you how much each vendor leaves to you.
        Second, vendors&rsquo; own pages often disagree with each other: Dripify&rsquo;s help center,
        FAQ and features page give different message caps, and PhantomBuster&rsquo;s blog uses both
        30% and 40% as the acceptance rate to stay above. When the numbers matter, ask the vendor
        which page is current.
      </p>

      <h2 id="dedicated-ips">Do dedicated IPs or cloud hosting make a tool safe?</h2>
      <p>
        They help with one signal and do nothing about the others. A dedicated IP per account, often
        matched to your country, avoids an account appearing from a new address every session or
        sharing an address with hundreds of strangers. That is worth having. But LinkedIn also sees
        how many requests an account sends, how evenly they are spaced, how many are accepted,
        ignored or marked &ldquo;I don&rsquo;t know this person&rdquo;, and how many replies say
        stop. A tool sending at the top of its range from a perfect IP is riskier than one sending
        modestly from an ordinary connection.
      </p>
      <p>
        The same goes for the cloud-versus-extension debate. Vendors argue both ways: some say
        extensions are riskier because LinkedIn&rsquo;s page can see what is installed in your
        browser, others say cloud tools are riskier because their servers act for many accounts.
        Both points are true, and neither decides the outcome. Our{" "}
        <Link href="/guides/cloud-vs-browser-extension-linkedin-automation">
          comparison of cloud and browser-extension automation
        </Link>{" "}
        goes through the trade-offs, and{" "}
        <Link href="/guides/is-linkedin-automation-safe">is LinkedIn automation safe</Link> covers
        the behaviors that get accounts restricted.
      </p>

      <h2 id="where-nora-falls-short">Where Nora passes, and where it falls short</h2>
      <p>
        Nora was built around the 8 checks, so it passes them by design, and our safety rules are
        covered by automated tests that run on every change. That still leaves honest gaps:
      </p>
      <ul>
        <li>
          <strong>It does not remove the risk.</strong> Nora automates LinkedIn actions, which
          LinkedIn&rsquo;s terms prohibit. It sends less, more slowly and more carefully than most
          tools allow, and that is all any tool can do.
        </li>
        <li>
          <strong>It runs in the cloud.</strong> Your LinkedIn password never reaches us, and tokens
          are encrypted before they are stored, but your session is handled on a server rather than
          on your own computer. The <Link href="/security">security page</Link> explains how.
        </li>
        <li>
          <strong>It is slower.</strong> {CAP_NEVER_SENT} invitations a day in the first week is a
          real cost if you are used to sending fifty. If speed matters more to you than the account,
          another tool will suit you better.
        </li>
        <li>
          <strong>It has no ban rate to show you.</strong> We are a young product and will not quote a
          number we cannot stand behind. We are not SOC 2 audited either.
        </li>
        <li>
          <strong>Acceptances are found by checking.</strong> No notification reaches Nora when
          somebody accepts, so it checks every hour. The first message usually goes out within a
          couple of hours of the acceptance, which can be later than it would by hand.
        </li>
      </ul>
      <p>
        If you are choosing between tools, the{" "}
        <Link href="/alternatives">LinkedIn automation tools comparison</Link> sets Nora beside
        specific competitors, and the{" "}
        <Link href="/guides/best-ai-sdr-for-linkedin">guide to choosing an AI SDR for LinkedIn</Link>{" "}
        covers what to ask beyond safety. More reading is in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>. And run the 8 checks on Nora too: connect
        an account and you can see its first day&rsquo;s allowance before anything is sent. More on{" "}
        <Link href="/free-linkedin-automation-tool">Nora&rsquo;s free trial</Link>.
      </p>
    </ArticleLayout>
  );
}
