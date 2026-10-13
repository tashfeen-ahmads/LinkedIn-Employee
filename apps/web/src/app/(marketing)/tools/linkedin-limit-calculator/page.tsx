import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_WORKING_HOURS, LINKEDIN_LIMITS } from "@le/shared";
import { ArticleLayout, Callout, articleMeta, type Faq, type Source } from "@/components/article";
import { LimitCalculator } from "@/components/seo/tool-limit-calculator";
import { capForDay } from "@/lib/limit-plan";
import { buildCapTable } from "@/lib/limit-table";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/tools/linkedin-limit-calculator";

export const metadata: Metadata = articleMeta(PATH);

/** The ramp, from the sender's own dailyInviteCap. */
const { caps, neverSentCap } = buildCapTable();

/** A row a week through the warm-up, plus the first day at the full allowance. */
const RAMP_ROWS = [0, 7, 14, 21, 28, LINKEDIN_LIMITS.warmupDays].map((d) => ({
  label: d === 0 ? "Day 1 (first send)" : `Day ${d + 1}`,
  cap: capForDay(caps, neverSentCap, d),
}));

/** A default working week at the full daily cap, against the week. */
const WORKING_DAYS = DEFAULT_WORKING_HOURS.days.length;
const FULL_WEEK_AT_MAX = PUBLIC_LIMITS.invitesPerDayMax * WORKING_DAYS;

const FAQ: readonly Faq[] = [
  {
    q: "How many connection requests can I send today?",
    a: `LinkedIn publishes no daily number, so the calculator uses the ramp Nora enforces: ${PUBLIC_LIMITS.invitesPerDayStart} a day from an account's first send, rising to ${PUBLIC_LIMITS.invitesPerDayMax} over ${LINKEDIN_LIMITS.warmupDays} days, and never more than ${PUBLIC_LIMITS.invitesPerWeek} in any seven days in a row. Today's answer is the smaller of what the day's ramp has left and what the last seven days have room for. Spread whatever it gives you across your working hours.`,
  },
  {
    q: "Why does a three-week-old account still sit at the starting cap?",
    a: `Because the ramp is measured from the account's first send, not from the day it was created or connected to a tool. An account that has existed for three weeks but has never sent through automation has had no warm-up at all, so it starts at ${PUBLIC_LIMITS.invitesPerDayStart} a day. Measuring from the connection date would hand it the full allowance on its first day of sending.`,
  },
  {
    q: "Does the calculator store anything?",
    a: "No. The arithmetic runs in your browser from a table of daily caps built into the page. Nothing you type is sent to a server, saved, or tied to you, and there is no sign-up. Close the tab and it is gone. Invitations you send by hand are worth entering too, because LinkedIn counts everything the account sends, whatever sent it.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Invitation restrictions (reasons and durations)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "ContentIn: What is the LinkedIn weekly invitation limit? (rolling window)", url: "https://contentin.io/glossary/weekly-invitation-limit/" },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn connection request limit calculator"
      lede={`This LinkedIn connection limit calculator shows how many connection requests your account can safely send today, and when room comes back. It uses the limits Nora enforces: ${PUBLIC_LIMITS.invitesPerDayStart} a day at the first send, rising to ${PUBLIC_LIMITS.invitesPerDayMax} over about ${PUBLIC_LIMITS.warmupWeeks} weeks, never more than ${PUBLIC_LIMITS.invitesPerWeek} in any rolling seven days. Nothing you type is stored.`}
      faq={FAQ}
      sources={SOURCES}
      aside={
        <LimitCalculator
          caps={caps}
          neverSentCap={neverSentCap}
          weeklyCeiling={PUBLIC_LIMITS.invitesPerWeek}
          workingDays={DEFAULT_WORKING_HOURS.days}
        />
      }
    >
      <h2 id="inputs">What to enter</h2>
      <p>
        Enter whole days since the account first sent an invitation through a tool (or check the box
        if it has never sent one), then how many invitations it sent on each of the last seven days,
        today so far in the last box, including any by hand. Many calculators ask for your account age
        or your Social Selling Index and return a range. LinkedIn publishes no invitation limit tied to
        either, so this one asks only for the two things Nora itself checks before each send: where the
        account is on its warm-up, and what the last seven days already hold. The days are asked for
        one at a time because the week rolls: tomorrow the oldest day stops counting, and what comes
        back is exactly what that day held.
      </p>

      <h2 id="how">How the numbers are worked out</h2>

      <h3 id="ramp">Ramp from the first send</h3>
      <p>
        The daily cap ramps in a straight line from {PUBLIC_LIMITS.invitesPerDayStart} to {PUBLIC_LIMITS.invitesPerDayMax} over{" "}
        {LINKEDIN_LIMITS.warmupDays} days, counted in whole days from the account&apos;s first automated send. The figures below are
        not a copy of that rule: they are computed for every day of the ramp by the same code Nora checks before every
        invitation.
      </p>
      <figure className="tool-ramp">
        <figcaption>Daily invitation cap through the warm-up, from Nora&apos;s sending code</figcaption>
        <ol>
          {RAMP_ROWS.map((row) => (
            <li key={row.label}>
              <span className="tool-ramp-day">{row.label}</span>
              <span className="tool-ramp-track" aria-hidden="true">
                <span
                  className="tool-ramp-bar"
                  style={{ width: `${(row.cap / PUBLIC_LIMITS.invitesPerDayMax) * 100}%` }}
                />
              </span>
              <span className="tool-ramp-value">{row.cap} a day</span>
            </li>
          ))}
        </ol>
      </figure>
      <p>
        The clock starts at the first send because connecting a tool is not activity LinkedIn can see. An account wired up a month
        before its first campaign would otherwise go from nothing to the full allowance in one day, which is the sudden change a
        ramp exists to prevent. The <Link href="/guides/linkedin-warm-up-schedule">week-by-week LinkedIn warm-up schedule</Link>{" "}
        explains the reasoning in full.
      </p>

      <h3 id="weekly">Weekly ceiling</h3>
      <p>
        On top of the daily cap sits a ceiling of {PUBLIC_LIMITS.invitesPerWeek} invitations in any seven days in a row, all
        campaigns combined. What you can send today is the smaller of the two. At the full daily cap, {WORKING_DAYS} working days would be {FULL_WEEK_AT_MAX}{" "}
        invitations, far over the ceiling, so once the warm-up is done the week is almost always the limit you meet first.
      </p>
      <p>
        LinkedIn does not publish a weekly number. As of October 2026 third-party reports most often describe about 100 a week,
        and most describe a rolling seven-day window rather than a calendar week. Nora counts the same way: before every
        invitation it adds up today and the six days before it, in the account&apos;s time zone, and nothing resets on a Monday.
        Each day&apos;s invitations stop counting once that day is seven days old, so room comes back a day at a time, and
        the calculator tells you when the next of it does. Our{" "}
        <Link href="/guides/linkedin-weekly-invitation-limit">guide to the LinkedIn weekly invitation limit</Link> has a worked
        example.
      </p>
      <div className="tool-callout">
      <Callout tone="info">
        <p>
          <strong>Why these numbers and not higher ones?</strong> They sit at the conservative end of what is reported, and they
          are product rules in Nora, not settings: a campaign can go lower, nothing can go higher. The{" "}
          <Link href="/linkedin-automation-limits">LinkedIn automation limits page</Link> sets out every cap and where it comes from.
        </p>
      </Callout>
      </div>

      <h2 id="what-to-do">What to do with the result</h2>
      <ul>
        <li>
          <strong>Spread it across the day.</strong> A daily cap says how many, not when; ten invitations in ten minutes is a burst
          whatever the total. Nora divides the working time left in the day by the day&apos;s allowance, and never places two
          invitations closer than {LINKEDIN_LIMITS.minGapMs / 60_000} minutes apart.
        </li>
        <li>
          <strong>Spend it on your best-fit people first.</strong> If fewer than {PUBLIC_LIMITS.healthyAcceptance}% of invitations
          are accepted, fix the list or the note before sending more. Ignored invitations are one of the reasons LinkedIn gives for
          restricting accounts. The <Link href="/tools/connection-note-checker">connection note checker</Link> helps with the note.
        </li>
        <li>
          <strong>Leave room.</strong> The result is a ceiling, not a target. Follow-up messages have their own allowance of{" "}
          {PUBLIC_LIMITS.messagesPerDay} a day and do not come out of it.
        </li>
        <li>
          <strong>Stop at the first refusal.</strong> If LinkedIn says to try again later, no calculator outranks that.
        </li>
      </ul>
      <p>
        The calculator cannot see your account, and LinkedIn&apos;s User Agreement prohibits automated access, so any automation
        carries a risk no limit removes. More free tools are on the <Link href="/tools">LinkedIn outreach tools</Link> page. If you
        would rather have the pacing done for you, Nora runs this ramp and ceiling from your first send:{" "}
        <Link href="/how-it-works">see how Nora works</Link>.
      </p>
    </ArticleLayout>
  );
}
