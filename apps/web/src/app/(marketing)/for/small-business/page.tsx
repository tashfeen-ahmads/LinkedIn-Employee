import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_WORKING_HOURS, INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS, YOUR_DECISIONS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";
import { ArticleLayout, Callout, articleMeta, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/for/small-business";

export const metadata: Metadata = articleMeta(PATH);

const [STRATEGY, WORDS, LAUNCH] = YOUR_DECISIONS;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const FOLLOW_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / MINUTE_MS);
const FOLLOW_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / MINUTE_MS);

/*
 * The most a new account can send in its first four weeks: the sender's own
 * daily cap on each default working day, clamped by the weekly ceiling. A
 * first send on a Monday (5 January 2026) lines the weeks up; only the
 * distance from the first send matters to the cap.
 */
const FIRST_SEND = new Date("2026-01-05T09:00:00Z");
const WORKING_OFFSETS = DEFAULT_WORKING_HOURS.days.map((weekday) => (weekday + 6) % 7);
const FIRST_MONTH = Array.from({ length: 4 }, (_, week) => {
  const caps = WORKING_OFFSETS.map((offset) =>
    dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + (week * 7 + offset) * DAY_MS)),
  );
  return Math.min(caps.reduce((a, b) => a + b, 0), PUBLIC_LIMITS.invitesPerWeek);
});
const FIRST_MONTH_TOTAL = FIRST_MONTH.reduce((a, b) => a + b, 0);

const FAQ: readonly Faq[] = [
  {
    q: "Is LinkedIn good for small business lead generation?",
    a: "If you sell to other businesses, usually yes: the people who buy from you list their job, company and location on LinkedIn, so you can find them by what they do rather than by guessing. It suits considered purchases where one conversation is worth a lot. It suits impulse or consumer purchases far less, and it rewards patience over volume.",
  },
  {
    q: "How can I get B2B leads without a sales team?",
    a: "Narrow the buyer to people who have the problem you solve, write each a short note about something specific on their profile, follow up promptly when they accept, and offer real meeting times once they reply. An AI SDR like Nora can do the searching, writing, pacing and booking while you approve the strategy, the words and the launch.",
  },
  {
    q: "Is there an affordable AI SDR for a small business?",
    a: `Nora is free for every workspace while it grows, with no card. It finds prospects, writes one note per person, follows up, answers replies and books meetings, inside the same limits for everyone: ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day at first, rising to ${PUBLIC_LIMITS.invitesPerDayMax}, and never more than ${PUBLIC_LIMITS.invitesPerWeek} a week.`,
  },
  {
    q: "Is Sales Navigator worth it for a small business?",
    a: "Only if your buyer is defined by seniority or company size, which free LinkedIn search cannot filter, or you search often enough to hit LinkedIn's monthly commercial use limit. It does not raise how many invitations you can safely send. Many small businesses can find enough buyers with free search, titles joined by OR, location and industry.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Prohibited software and extensions", url: "https://www.linkedin.com/help/linkedin/answer/a1341387" },
  { label: "LinkedIn Help: Invitation restrictions (answer 4800)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "LinkedIn Premium FAQ (commercial use limit)", url: "https://premium.linkedin.com/professional/faq" },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn lead generation for small businesses without a sales team"
      lede="LinkedIn lead generation for a small business means finding the few hundred people who could buy from you and writing to each one personally, which is exactly the work an owner never has time for. Nora does that work as a free AI SDR: it finds the buyers, writes each a note, follows up and books the calls, while you approve what goes out under your name."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="different">Why LinkedIn lead generation is different for a small business</h2>
      <p>
        A sales team can afford a bad week. A small business usually prospects from one profile,
        the owner&rsquo;s, which is also its reputation, its referral network and often its only
        sales channel. Three things follow.
      </p>
      <ul>
        <li>
          <strong>The account matters more than the volume.</strong> LinkedIn&rsquo;s User
          Agreement prohibits automated sending, and its help center says invitations get restricted
          when many go out in a short time or many are ignored. No tool can promise zero risk, so a
          small business needs one that sends slowly and to the right people.
        </li>
        <li>
          <strong>Prospecting happens in bursts.</strong> Forty invitations on a quiet Friday, then
          nothing for a month. Bursts are the riskiest pattern and the least effective one.
        </li>
        <li>
          <strong>Every contact is local reputation.</strong> In a small market, the same person
          getting two different pitches from you, or a customer getting a cold note, is noticed.
        </li>
      </ul>

      <h2 id="an-hour">An hour a week instead of a hire</h2>
      <p>
        A salesperson is a salary, a ramp-up and a manager&rsquo;s time; our{" "}
        <Link href="/guides/ai-sdr-vs-human-sdr">AI SDR versus human SDR comparison</Link> sets
        those costs out. What a small business can usually spare is an hour or so a week. That is
        our suggested budget, not a measurement, and this is where it goes:
      </p>
      <ol>
        <li><strong>{STRATEGY.title}.</strong> Once, then occasionally: read the segments Nora proposed and approve the ones worth pursuing.</li>
        <li><strong>{WORDS.title}.</strong> Approve the opening lines and the one-line offer. Editing a line clears its approval.</li>
        <li><strong>{LAUNCH.title}.</strong> Read the list and the notes, cut anyone you know personally, press the button.</li>
        <li><strong>Read what was held.</strong> Replies that ask about price, or that Nora was not confident it understood, wait in the inbox for you.</li>
      </ol>

      <h2 id="free-vs-paid">Free versus paid: what a small business actually needs</h2>
      <p>
        You need three things: a way to find the right people, a way to write to each of them
        personally, and something that handles the replies. You do not necessarily need a paid
        LinkedIn seat. Free search filters by keywords, location, industry and company; it cannot
        filter by seniority or company size, and heavy searching runs into LinkedIn&rsquo;s monthly
        commercial use limit. Our guide to{" "}
        <Link href="/guides/linkedin-prospecting-without-sales-navigator">LinkedIn prospecting without Sales Navigator</Link>{" "}
        shows when the seat is worth it.
      </p>
      <p>
        Nora itself is free for every workspace while it grows, with no card. There are no plans to
        choose between: every workspace gets the whole product and the same limits. See the{" "}
        <Link href="/free-linkedin-automation-tool">free LinkedIn automation tool</Link> page for
        exactly what that covers.
      </p>

      <h2 id="how">How it works for you</h2>

      <h3 id="strategy">A strategy from your website</h3>
      <p>
        Nora reads your website and writes a business profile plus three to five customer
        strategies. Each one is written to say what that customer buys from you and what they do instead
        today, the two questions that separate a buyer from a business that merely looks like
        yours. Nothing is searched until you approve a strategy.
      </p>

      <h3 id="notes">One note per person, in your voice</h3>
      <p>
        For each prospect, Nora writes a connection note from that person&rsquo;s own headline,
        role and company, under {INVITE_NOTE_MAX_CHARS} characters and never containing a link. It
        leans on the openers you approved rather than pasting them, so no two people get the same
        sentence, and the review screen shows which details each note used.
      </p>
      <Callout tone="info">
        <strong>Illustration, not a customer.</strong> For a bookkeeping firm: &ldquo;Hi Tom, saw
        you opened a second site in Leeds this year. Curious whether the books grew with it or stayed
        on one spreadsheet. Would be good to connect.&rdquo;
      </Callout>

      <h3 id="replies">Replies answered, calls booked</h3>
      <p>
        Once Nora sees that someone accepted, the first message goes {FOLLOW_MIN} to {FOLLOW_MAX} minutes later,
        within working hours, and does not pitch. When they reply, Nora answers from the facts in
        your knowledge documents only, makes the offer you approved, and either proposes real times
        from your booking page or sends your own scheduling link. Questions about price are held for you by
        default. An opt-out stops all contact at once, and anyone who asks for a person gets you.
      </p>

      <h2 id="limits">The limits that protect your profile</h2>
      <p>
        Every account starts at {PUBLIC_LIMITS.invitesPerDayStart} connection requests a day,
        counted from its first send, and rises to {PUBLIC_LIMITS.invitesPerDayMax} over about{" "}
        {PUBLIC_LIMITS.warmupWeeks} weeks, never more than {PUBLIC_LIMITS.invitesPerWeek} a week.
        Messages are capped at {PUBLIC_LIMITS.messagesPerDay} a day. Each day&rsquo;s invitations
        are spread across your working hours, and nobody your workspace has already contacted is
        ever invited again. The reasoning is on our{" "}
        <Link href="/linkedin-automation-limits">LinkedIn limits page</Link>.
      </p>

      <h2 id="first-month">What to expect in the first month</h2>
      <p>
        Week one is setup: connect LinkedIn, approve a strategy and the words, read the list,
        launch. From the first send, the most a new account can send in its first four weeks is{" "}
        {FIRST_MONTH_TOTAL} invitations ({FIRST_MONTH.join(", ")} a week), spread across working
        days. That is deliberately slow, and it is the same for every account.
      </p>
      <p>
        We will not quote you an acceptance or meeting rate: those depend on your market and your
        targeting, and published benchmarks rarely say whose numbers they are. What you will see is
        your own. If acceptance falls below {PUBLIC_LIMITS.healthyAcceptance}%, the account is
        flagged, and the fix is usually the strategy rather than the wording.
      </p>
      <p>
        Read <Link href="/how-it-works">how Nora works from strategy to booked call</Link>, or the
        versions of this page for <Link href="/for/agencies">agencies</Link> and{" "}
        <Link href="/for/consultants">consultants and coaches</Link>. Back to the{" "}
        <Link href="/">Nora home page</Link>, or <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
