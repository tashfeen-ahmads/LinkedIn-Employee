import type { Metadata } from "next";
import Link from "next/link";
import { LINKEDIN_LIMITS, MIN_SENDS_TO_COMPARE, stagesFor, wilson } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { RangeFigure, RateBars, type RangeRow } from "@/components/seo/ga1-diagrams";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/guides/linkedin-acceptance-rate";

export const metadata: Metadata = articleMeta(PATH);

const HEALTHY = PUBLIC_LIMITS.healthyAcceptance;
const MIN_GAP_MIN = Math.round(LINKEDIN_LIMITS.minGapMs / 60_000);

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** A rate and its 95% Wilson range, computed by the same function Nora's campaign screen uses. */
function reading(accepted: number, sent: number): { rate: string; range: string } {
  const { low, high } = wilson(accepted, sent);
  return { rate: pct(accepted / sent), range: `${pct(low)} to ${pct(high)}` };
}

const PAIRS = [
  { label: "11 invitations each", a: [3, 11], b: [6, 11] },
  { label: "40 invitations each", a: [10, 40], b: [16, 40] },
  { label: "200 invitations each", a: [50, 200], b: [80, 200] },
] as const;

const PAIR_ROWS: RangeRow[] = PAIRS.map((pair) => {
  const versions = [
    { name: "A", counts: pair.a },
    { name: "B", counts: pair.b },
  ].map(({ name, counts }) => {
    const [accepted, sent] = counts;
    const { low, high } = wilson(accepted, sent);
    const r = reading(accepted, sent);
    return { name, rate: accepted / sent, low, high, text: `${accepted} of ${sent}: ${r.rate}, likely ${r.range}` };
  });
  const separated = versions[1]!.low > versions[0]!.high;
  return {
    label: pair.label,
    versions,
    separated,
    verdict: separated ? "Yes: the ranges no longer overlap" : "Not yet: the ranges overlap",
  };
});

const INDUSTRY_BARS = [
  { label: "Staffing and recruiting", value: 36.5, note: "Highest of the 38; 423,792 requests from 462 accounts" },
  { label: "Design", value: 31.3, note: "148,589 requests from 118 accounts" },
  { label: "All industries", value: 28.5, note: "13.2 million requests from 13,302 accounts" },
  { label: "Information technology and services", value: 28.4, note: "1,731,259 requests" },
  { label: "Telecommunications", value: 21.8, note: "Lowest of the 38" },
];

const SMALL = reading(4, 11);
const ZERO = wilson(0, 8);

const GOALS = [
  { label: "Book a meeting", kind: "meeting" as const },
  { label: "Send people to a link", kind: "link" as const },
  { label: "Start a conversation", kind: "reply" as const },
];

const FAQ: readonly Faq[] = [
  {
    q: "What is a good LinkedIn acceptance rate?",
    a: `Around 30% or higher on cold requests. The largest 2026 vendor dataset we found averages 28.5% across 13.2 million requests, and Nora flags an account below ${HEALTHY}%. Expandi itself describes 30% to 45% as good. Judge it over at least a few dozen invitations; on a handful, the number is mostly chance.`,
  },
  {
    q: "Is 30% a good LinkedIn acceptance rate?",
    a: "Yes, for cold outreach to people who do not know you, it is about average to slightly above. It is low for warm audiences, such as event attendees or people who engaged with your posts, where you should expect noticeably more. If you are at 30% and want more, tighten who you invite before rewriting what you say.",
  },
  {
    q: "Does a low acceptance rate get you restricted?",
    a: "It can contribute. LinkedIn says that if many recipients click \"I don't know this person\", you can be restricted from sending invitations, and every outreach vendor treats a low acceptance rate as a risk signal. LinkedIn does not publish a threshold. Unanswered requests also pile up as pending, so withdraw old ones.",
  },
  {
    q: "Why are my LinkedIn connection requests not being accepted?",
    a: "Usually one of four things: the list is wrong (often peers or competitors who match your customer profile on paper), the note is generic, requests go out in bursts, or your own profile gives a stranger no reason to say yes. Check targeting first; it moves the number most.",
  },
  {
    q: "How many people do you need for a LinkedIn A/B test?",
    a: `More than most people use. At typical acceptance rates it takes about 200 invitations per version before a 15-point difference, such as 25% against 40%, separates from noise, and Nora will not compare two angles until each has at least ${MIN_SENDS_TO_COMPARE} sends. Assign people to versions in rotation, not by hand.`,
  },
];

const SOURCES: readonly Source[] = [
  {
    label: "Expandi: LinkedIn outreach benchmarks 2026, 13.2M outreach attempts (28.5% average, May 2025 to April 2026)",
    url: "https://expandi.io/blog/linkedin-outreach-benchmarks-2026/",
  },
  {
    label: "Expandi: LinkedIn outreach benchmarks for staffing and recruiting, 2026 (industry range across 38 industries)",
    url: "https://expandi.io/industry-benchmarks/staffing-and-recruiting/",
  },
  {
    label: "Expandi: LinkedIn outreach benchmarks for information technology and services, 2026",
    url: "https://expandi.io/blog/information-technology-and-services/",
  },
  {
    label: "Expandi: LinkedIn outreach benchmarks for the design industry, 2026",
    url: "https://expandi.io/blog/design/",
  },
  {
    label: "LaGrowthMachine Help: should I add a note to my LinkedIn request?",
    url: "https://help.lagrowthmachine.com/en/articles/4886694-should-i-add-a-note-to-my-linkedin-request",
  },
  {
    label: "Expandi: LinkedIn acceptance rate in 2026 (30% to 45% described as good)",
    url: "https://expandi.io/blog/linkedin-acceptance-rate/",
  },
  {
    label: "Salesforge: LinkedIn connection acceptance rate",
    url: "https://www.salesforge.ai/blog/linkedin-conection-acceptance-rate",
  },
  {
    label: "Gracker: How to increase LinkedIn connection acceptance rate from 15% to 45%",
    url: "https://gracker.ai/blog/increase-linkedin-acceptance-rate",
  },
  {
    label: "SalesRobot: LinkedIn connection request acceptance rates by industry",
    url: "https://www.salesrobot.co/blogs/linkedin-connection-acceptance-rate",
  },
  {
    label: "LinkedIn Help: Using the \"I don't know this person\" option for invitations",
    url: "https://www.linkedin.com/help/linkedin/answer/a540947/using-the-i-don-t-know-this-person-option-for-invitations",
  },
  {
    label: "LinkedIn Help: Prohibited software and extensions",
    url: "https://www.linkedin.com/help/linkedin/answer/a1341387",
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn connection acceptance rate: what is good and how to raise it"
      lede={`A good LinkedIn connection acceptance rate for cold outreach is about 30% or better; the largest 2026 vendor dataset we found averages 28.5% across 13.2 million requests. Below ${HEALTHY}% is worth fixing for your account's safety as well as your results, but on a few dozen invitations your rate is mostly chance, so read it as a range.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">The short answer: benchmarks, and why they are optimistic</h2>
      <CompareTable
        caption="LinkedIn connection acceptance rate benchmarks, as published by October 2026"
        columns={["Figure", "What it is"]}
        rows={[
          {
            label: "Expandi 2026 benchmark",
            values: ["28.5% average", "13,218,869 requests from 13,302 accounts, May 2025 to April 2026"],
          },
          { label: "Expandi's own guidance", values: ["30% to 45% is good", "Below 20% described as a restriction risk"] },
          { label: "Salesforge, citing Expandi", values: ["About 29.6%", "An earlier Expandi figure, quoted secondhand"] },
          { label: "Nora's health threshold", values: [`${HEALTHY}%`, "Below this, an account is flagged for review by the nightly check"] },
        ]}
      />
      <p>
        Industry moves the number more than anything else in that dataset. Across the 38 industries with at least 50 sending
        accounts, Expandi reports acceptance from 21.8% to 36.5%. A few of them, as published:
      </p>
      <RateBars
        caption="LinkedIn acceptance rate by industry, Expandi 2026 benchmark (May 2025 to April 2026)"
        bars={INDUSTRY_BARS}
        threshold={HEALTHY}
        thresholdLabel={`Nora flags an account below ${HEALTHY}%`}
      />
      <p>
        These numbers are useful as a ceiling for expectations, less so as a target. Each comes from one
        automation vendor&rsquo;s customers, who chose that tool, kept using it, and are more likely than
        average to have worked on their targeting. Accounts that were restricted and stopped using the
        tool are less likely to be in the sample. And small definitional choices, such as whether invitations
        still pending count in the denominator, change the number you are comparing against. If your number is a few points
        below a published average, that alone is not a problem.
      </p>

      <h2 id="reading-your-rate">Reading your own LinkedIn connection acceptance rate</h2>

      <h3 id="small-numbers">Eleven invitations is not a result</h3>
      <p>
        Suppose you send eleven invitations and four people accept. That is {SMALL.rate}, which looks
        healthy. But with eleven people, a rate whose true value is anywhere from {SMALL.range} would produce
        a result like yours reasonably often. Change one person&rsquo;s mood that afternoon and you read a
        different number. The same applies to rates that look terrible: none accepted out of eight is
        consistent with a true rate as high as {pct(ZERO.high)}.
      </p>
      <p>
        This is why decisions made on the first day of a campaign are usually wrong. A rep who switches angle
        because one read 40% against 60% on eleven invitations each has learned nothing, and may well have
        thrown away the better one.
      </p>

      <h3 id="ranges">Ranges, not single numbers (Wilson intervals in plain words)</h3>
      <p>
        The honest way to show a rate on small numbers is as a range: the values the true rate plausibly sits
        in, given what you have seen. Nora uses a Wilson interval, a standard formula that stays sensible at
        the extremes. The simpler textbook formula claims perfect certainty at zero out of eight and can
        produce ranges below 0% or above 100%, which is exactly where young campaigns live. The figure
        below is computed the same way. In each pair, version B really is accepted more often than A; the
        question is when you could tell.
      </p>
      <RangeFigure
        caption="Two versions at three sample sizes. The dot is the rate you would read; the bar is its 95% Wilson range, computed by the same function as Nora's campaign screen."
        rows={PAIR_ROWS}
      />
      <p>
        Look at the first two pairs. B is ahead on the raw rate both times, and you still cannot say it is
        better. Only at 200 invitations each does a 15-point gap, 25% against 40%, come apart from the noise. A smaller
        gap needs more.
      </p>

      <h2 id="safety">Why low acceptance is a safety problem too</h2>
      <p>
        Acceptance rate is not only a measure of copy. It is one of the clearest signals of whether you are
        inviting people who want to hear from you, and LinkedIn acts on related signals. Its help center says
        that if many recipients respond with &ldquo;I don&rsquo;t know this person&rdquo;, the sender can be
        restricted from sending invitations. LinkedIn does not publish the threshold, and outreach vendors
        uniformly treat a low acceptance rate as a risk factor.
      </p>
      <p>Nora treats it the same way:</p>
      <ul>
        <li>
          Every night, accounts whose campaigns have sent enough invitations to judge are checked against a{" "}
          {HEALTHY}% acceptance rate, and an account below it is flagged.
        </li>
        <li>
          Invitations still pending after {LINKEDIN_LIMITS.withdrawAfterDays} days are withdrawn, so a backlog
          of unanswered requests does not build up on the account.
        </li>
        <li>
          Daily volume starts at {PUBLIC_LIMITS.invitesPerDayStart} and ramps to at most{" "}
          {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks, never above{" "}
          {PUBLIC_LIMITS.invitesPerWeek} a week. The reasons are on the{" "}
          <Link href="/linkedin-automation-limits">LinkedIn automation limits page</Link>.
        </li>
      </ul>
      <p>
        None of this makes automation safe in an absolute sense. LinkedIn&rsquo;s user agreement prohibits
        automated activity, and no tool can promise zero risk; the{" "}
        <Link href="/guides/is-linkedin-automation-safe">guide to LinkedIn automation safety</Link> covers
        what reduces it.
      </p>

      <h2 id="not-accepted">Why requests are not being accepted</h2>

      <h3 id="peers">Targeting peers or competitors by mistake</h3>
      <p>
        The most expensive cause, and the hardest to see. A competitor matches your ideal customer profile
        almost perfectly: same titles, same industry, same company size, often the same words in their
        headline. On paper they are your best prospects. In practice they ignore or decline you, and every
        decline drags your rate down. Nora checks each segment against the company&rsquo;s named competitors on
        the approval screen. The{" "}
        <Link href="/guides/ideal-customer-profile-for-linkedin">guide to an ideal customer profile for LinkedIn</Link>{" "}
        explains how to define buyers by what they would pay for rather than what they resemble.
      </p>

      <h3 id="generic-notes">Generic notes</h3>
      <p>
        A note that could have gone to anyone signals a script. Vendor tests of a note against a blank request
        disagree with each other, and the differences they report are small either way; LaGrowthMachine, which sells an
        outreach tool, advises testing a blank request against a specific note on the same audience rather than assuming.
        Either say one specific, true thing, or send the request blank. The{" "}
        <Link href="/guides/linkedin-connection-request-templates">connection request templates</Link> show
        notes built around a real detail.
      </p>

      <h3 id="bursts">Bursty sending</h3>
      <p>
        A daily cap is not a pace. Ten invitations sent in one sitting look like a machine emptying a queue, however
        small the cap; the{" "}
        <Link href="/guides/is-linkedin-automation-safe#incident">first account Nora ever ran learned that the hard way</Link>.
        Nora now spreads each day&rsquo;s allowance across your working hours, never closer than {MIN_GAP_MIN} minutes apart.
      </p>

      <h3 id="thin-profile">A thin profile</h3>
      <p>
        People check who you are before they accept. No photo, a headline that is only a job title, or an
        empty about section gives a stranger no reason to say yes. Before any campaign, make your own profile
        say in one line who you help and how. It is the one fix that raises every future rate at once.
      </p>

      <h2 id="testing">How to test what works: angles, not wording</h2>
      <p>
        If every note is written for its person, testing two wordings is impossible: no two people receive the
        same words. What you can test is the <strong>angle</strong>, the reason for reaching out (the pain
        named, who you are being, what comes next). Hold the audience constant, vary the angle, and keep
        everything else equal.
      </p>

      <h3 id="round-robin">Round-robin assignment</h3>
      <p>
        Assign people to angles in strict rotation, not at random and not by hand. Random assignment of fifty
        people across two angles lands unevenly often enough to invent a difference, and hand-picking puts
        your favorite prospects in your favorite angle. Nora rotates over the counts each angle already has,
        so adding a second batch continues the rotation, and never reassigns anyone once the list is built:
        moving people between angles credits one angle with results the other produced.
      </p>

      <h3 id="too-early">When it is too early to call a winner</h3>
      <p>
        Nora will not say one angle is behind until both have at least {MIN_SENDS_TO_COMPARE} invitations
        sent, and even then only when the leader&rsquo;s whole range sits above the other&rsquo;s. Several
        angles &ldquo;leading&rdquo; at once is the correct reading of a young test. The cost of waiting is a
        few days; the cost of calling it early is switching off the angle that was actually better.
      </p>

      <h2 id="metrics">The metrics worth tracking, by campaign goal</h2>
      <p>
        Acceptance is the first gate, not the goal. Which later stages you track depends on what the campaign
        asks for, and a funnel that ends in a stage the campaign can never reach reports a working campaign as
        a failure. These are the stages Nora reports for each goal:
      </p>
      <CompareTable
        caption="Funnel stages Nora reports, by campaign goal"
        columns={["Stages tracked", "Note"]}
        rows={GOALS.map((goal) => ({
          label: goal.label,
          values: [
            stagesFor(goal.kind)
              .map((stage) => stage.label)
              .join(", "),
            goal.kind === "link"
              ? "LinkedIn does not report clicks, so the funnel ends at a positive reply"
              : goal.kind === "reply"
                ? "A positive reply is the goal"
                : "Meetings Nora books are counted; ones booked on your own external scheduling link are not visible to it",
          ],
        }))}
      />
      <p>
        Read every stage the way you read acceptance: as a share of the stage before it, over enough people to
        mean something. Reply rate after acceptance is usually where good targeting and a good first message
        show up most clearly. To see how the rest of the process works, from the strategy you approve to the
        meeting, see <Link href="/how-it-works">how Nora works</Link>: it shows each angle&rsquo;s acceptance as a range
        and holds off calling winners until the numbers can support it.
      </p>

    </ArticleLayout>
  );
}
