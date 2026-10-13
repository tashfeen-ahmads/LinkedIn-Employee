import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { LINKEDIN_LIMITS } from "@le/shared";
import { EVEN_DAILY, RampChart, WARMUP_WEEKS, WORKING_DAYS, capRange, warmupSchedule } from "@/components/seo/gb2-ramp";

const PATH = "/guides/linkedin-warm-up-schedule";

export const metadata: Metadata = articleMeta(PATH);

const MINUTE_MS = 60_000;

/*
 * The schedule is the sender's own daily cap, read once per working day over
 * the real warm-up length plus the first full week after it (gb2-ramp.tsx).
 * The chart and the table below are the same reading, so they cannot disagree.
 */
const SCHEDULE = warmupSchedule();
const FIRST_WEEK = SCHEDULE[0]!;
const SECOND_WEEK = SCHEDULE[1]!;
const LAST_RAMP_WEEK = SCHEDULE[WARMUP_WEEKS - 1]!;
const FULL_WEEK = SCHEDULE[WARMUP_WEEKS]!;
const FIRST_BINDING_WEEK = SCHEDULE.find((w) => w.weeklyBinds)?.week ?? null;
const FULL_FROM_DAY = LINKEDIN_LIMITS.warmupDays;
const VIEW_TO_INVITE_MIN = Math.round(LINKEDIN_LIMITS.warmUpToInviteMinMs / MINUTE_MS);
const VIEW_TO_INVITE_MAX_H = Math.round(LINKEDIN_LIMITS.warmUpToInviteMaxMs / (60 * MINUTE_MS));
const MIN_GAP_MIN = Math.round(LINKEDIN_LIMITS.minGapMs / MINUTE_MS);
const MAX_GAP_MIN = Math.round(LINKEDIN_LIMITS.maxGapMs / MINUTE_MS);

const FAQ = [
  {
    q: "How long should I warm up a LinkedIn account?",
    a: `LinkedIn publishes no warm-up period, so any answer is a judgment. Nora ramps every account from ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day to ${PUBLIC_LIMITS.invitesPerDayMax} over ${PUBLIC_LIMITS.warmupWeeks} weeks, counted from the first invitation it sends. A brand-new or long-dormant profile benefits from two or three weeks of ordinary manual use before that, which several vendor guides also recommend.`,
  },
  {
    q: "How many connection requests should a new account send?",
    a: `Start low. Nora’s ramp begins at ${PUBLIC_LIMITS.invitesPerDayStart} a day, which allows at most ${FIRST_WEEK.most} in the first working week, and climbs a little each day. Some vendor schedules start lower, at around 5 a day. What matters more than the exact start is that it rises slowly and that the day’s invitations are spread out rather than sent in one sitting.`,
  },
  {
    q: "Does viewing a profile before connecting help?",
    a: `It can. An invitation from a name somebody has just seen in their profile viewers is less of a cold arrival. The view has to come first and not too long before: Nora sends the invitation ${VIEW_TO_INVITE_MIN} minutes to ${VIEW_TO_INVITE_MAX_H} hours after the view, and views have their own allowance of ${LINKEDIN_LIMITS.profileViewsPerDay} a day. Nobody publishes a measured effect, so treat it as courtesy, not a guarantee.`,
  },
  {
    q: "Do I need to warm up an old account that has never automated?",
    a: "Usually, yes. Age helps, but what a warm-up protects against is a sudden change in behavior. If the account has never sent more than a handful of invitations a week, going to dozens a day is that change, however old the profile. Nora treats it as new: an account that has never sent through it starts at the bottom of the ramp whatever its age.",
  },
  {
    q: "What is a safe LinkedIn ramp-up schedule?",
    a: `One that starts low, rises a little each day, and stays under a weekly ceiling. Nora’s goes from ${PUBLIC_LIMITS.invitesPerDayStart} a day in week 1 to a ceiling of ${PUBLIC_LIMITS.invitesPerDayMax} on any one day from day ${LINKEDIN_LIMITS.warmupDays}, never above ${PUBLIC_LIMITS.invitesPerWeek} in any seven days in a row, so plan about ${EVEN_DAILY} a day. If acceptance falls below ${PUBLIC_LIMITS.healthyAcceptance}%, hold the number where it is and fix the list.`,
  },
];

const SOURCES = [
  { label: "LinkedIn Help: Invitation restrictions (reasons and durations)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "LinkedIn Help: Invitation limit reached", url: "https://www.linkedin.com/help/billing/answer/a550555" },
  { label: "LinkedIn Help: InMail messages FAQ (monthly credits by plan)", url: "https://www.linkedin.com/help/linkedin/answer/a554514" },
  { label: "PhantomBuster: LinkedIn account warm-up guide (vendor guidance)", url: "https://phantombuster.com/blog/social-selling/linkedin-account-warm-up-guide/" },
  { label: "Snov.io: how to enable automatic LinkedIn account warm-up (vendor guidance)", url: "https://snov.io/knowledgebase/how-to-enable-automatic-linkedin-account-warm-up/" },
  { label: "SalesMind: how to warm up your LinkedIn account (vendor guidance)", url: "https://docs.sales-mind.ai/en/articles/11513833-how-to-warm-up-your-linkedin-account" },
  { label: "Waalaxy: how to heat up a LinkedIn account", url: "https://www.waalaxy.com/blog/linkedin-platform-knowledge/heat-up-linkedin-account" },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="How to warm up a LinkedIn account before outreach"
      lede={`To warm up a LinkedIn account, start with a small number of connection requests and raise it over several weeks, counting from the day the account first sends through a tool, not the day you connected one. Nora starts every account at ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day and ramps to ${PUBLIC_LIMITS.invitesPerDayMax} over ${PUBLIC_LIMITS.warmupWeeks} weeks under a ceiling of ${PUBLIC_LIMITS.invitesPerWeek} in any rolling seven days, and its sender uses exactly the numbers below.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <RampChart />
      <p>
        A warm-up exists so that an account&rsquo;s behavior never changes suddenly. A profile that has sent five invitations a
        month for two years and then sends forty on a Tuesday looks like something new is driving it, because something is.
        LinkedIn publishes no warm-up schedule, daily number or weekly number as of October 2026. It does publish the reasons it
        restricts invitations, and the first is many invitations in a short time; the others are invitations ignored, left
        pending or marked as spam, and suspected automation. A warm-up answers the first and tests the second: low volume early
        is when you learn whether people accept, before there are enough invitations for it to matter.
      </p>

      <h2 id="clock">When the warm-up clock starts (first send, not the day you connect a tool)</h2>
      <p>
        Most warm-up guides give a schedule and never say when day one is. It matters more than the numbers. Counting from the
        day an account is connected to a tool sounds equivalent to counting from its first send and is not. Somebody who
        connects and launches the same afternoon gets the same result either way. Somebody who connects in March, spends a few
        weeks writing customer profiles and approving copy, and launches in April would be treated as fully warmed on the day
        their account sends its first invitation ever.
      </p>
      <p>
        From LinkedIn&rsquo;s side nothing happened during those weeks. Connecting a tool is not activity it can see; sending is. So
        measuring from the connection would hand a never-used account the full {PUBLIC_LIMITS.invitesPerDayMax}-a-day allowance
        on its first day, which is precisely the jump a warm-up exists to prevent.
      </p>
      <Callout tone="safety">
        <p>
          <strong>Nora&rsquo;s rule:</strong> the ramp starts at the account&rsquo;s first action through Nora. An account that has sent
          nothing sits at {PUBLIC_LIMITS.invitesPerDayStart} a day however long ago it was connected. The ramp counts calendar
          days, so weekends move it forward even though nothing is sent on them.
        </p>
      </Callout>

      <h2 id="schedule">How to warm up a LinkedIn account: the schedule, week by week</h2>
      <p>
        These are the allowances Nora&rsquo;s sender checks before every invitation, for each working day of the warm-up. The
        table assumes the first invitation goes out on a Monday and the account sends Monday to Friday, which is the default.
      </p>
      <CompareTable
        caption={`Nora’s warm-up ramp: daily and weekly invitation allowance from the first send (weekly ceiling ${PUBLIC_LIMITS.invitesPerWeek})`}
        columns={["Days since first send", "Daily allowance", "Most in that week", "What limits the week"]}
        rows={SCHEDULE.map((w) => ({
          label: w.week > WARMUP_WEEKS ? `Week ${w.week} and after` : `Week ${w.week}`,
          values: [
            w.week > WARMUP_WEEKS ? `${w.firstDay} and later` : `${w.firstDay} to ${w.lastDay}`,
            capRange(w.low, w.high),
            w.most,
            w.weeklyBinds ? "The weekly ceiling" : "The daily ramp",
          ],
        }))}
      />

      <h3 id="week-1">Week 1: {PUBLIC_LIMITS.invitesPerDayStart} a day, rising slowly</h3>
      <p>
        The first week allows {capRange(FIRST_WEEK.low, FIRST_WEEK.high)} a day and at most {FIRST_WEEK.most} in total. That is
        deliberately modest, and higher than some vendor schedules, which start nearer 5 a day. It is enough to learn whether
        people accept your invitations. Send only to your best-fit people this week, and read every acceptance and every silence.
      </p>

      <h3 id={`weeks-2-${WARMUP_WEEKS}`}>
        Weeks 2 to {WARMUP_WEEKS}: from {SECOND_WEEK.low} to {LAST_RAMP_WEEK.high} a day
      </h3>
      <p>
        The daily allowance rises by a fraction of an invitation each day, so the increase is never a step anyone could see:
        week 2 allows {capRange(SECOND_WEEK.low, SECOND_WEEK.high)} a day and week {WARMUP_WEEKS}{" "}
        {capRange(LAST_RAMP_WEEK.low, LAST_RAMP_WEEK.high)}.
        {FIRST_BINDING_WEEK !== null ? (
          <>
            {" "}From week {FIRST_BINDING_WEEK} the five working days add up to more than {PUBLIC_LIMITS.invitesPerWeek}, so the
            weekly ceiling binds before the daily ramp does. After that point the ramp changes how a week can be spread across
            days rather than how much it holds.
          </>
        ) : null}{" "}
        If acceptance in these weeks is below {PUBLIC_LIMITS.healthyAcceptance}%, hold the daily number where it is and fix the
        list before letting it climb.
      </p>

      <h3 id="full-allowance">
        Week {FULL_WEEK.week} and after: up to {PUBLIC_LIMITS.invitesPerDayMax} on any day, about {EVEN_DAILY} a day planned
      </h3>
      <p>
        The daily allowance reaches {PUBLIC_LIMITS.invitesPerDayMax} on day {FULL_FROM_DAY} and stays there, but{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} is the most any one day may hold, not a pace. At that rate the{" "}
        {PUBLIC_LIMITS.invitesPerWeek}-a-week ceiling would be spent in three days. Spread over {WORKING_DAYS} working days, the
        week comes to {EVEN_DAILY} a day, and that is the number to set on your campaigns. Our guide to the{" "}
        <Link href="/guides/linkedin-weekly-invitation-limit">LinkedIn weekly invitation limit</Link> explains why the week is
        the number that matters and how to spread it.
      </p>
      <Callout tone="info">
        <p>
          <strong>These are ceilings, not targets.</strong> A campaign can set a lower daily limit at any point, and the ramp still
          applies on top. Nothing can go above it.
        </p>
      </Callout>

      <h2 id="profile-views">Profile views as warm-up</h2>
      <p>
        A second meaning of &ldquo;warm-up&rdquo; is per person rather than per account: look at someone&rsquo;s profile before inviting
        them, so the request arrives from a name they may have just seen among their profile viewers. Nobody publishes a measured
        effect on acceptance, so treat it as a courtesy that costs little, not a trick.
      </p>

      <h3 id="view-then-invite">View first, invite within a few hours</h3>
      <p>
        The order and the gap both matter. A view and an invitation in the same minute look like one automated action. A view
        three days earlier has been forgotten. With profile-view warm-up on (a per-campaign option, on by default when you
        create a campaign), Nora sends the invitation between {VIEW_TO_INVITE_MIN} minutes and {VIEW_TO_INVITE_MAX_H} hours after
        the view, still inside working hours. It does not spend a view when the invitation could not follow within that window,
        for example late on a Friday or while LinkedIn is holding invitations. A view older than that window no longer counts, and
        if a view is refused the invitation goes out without one rather than being held indefinitely.
      </p>

      <h3 id="views-allowance">Views have their own allowance</h3>
      <p>
        A view is the cheapest action on LinkedIn and therefore the easiest to overdo. Nora gives views their own ceiling of{" "}
        {LINKEDIN_LIMITS.profileViewsPerDay} a day, below the figures practitioners commonly report, and never takes them out of
        the invitation ramp: warming somebody up should not cost you the ability to invite them.
      </p>

      <h2 id="week-one">What else to do in week one</h2>

      <h3 id="profile">Profile completeness</h3>
      <p>
        A stranger decides whether to accept in a few seconds, from your photo, name and headline.
      </p>
      <ul>
        <li>
          <strong>A real photo and a headline written for buyers.</strong> Say who you help and with what, not just your job
          title.
        </li>
        <li>
          <strong>A complete profile.</strong> Experience, a short about section, a location. A sparse profile reads as a new or
          throwaway account.
        </li>
        <li>
          <strong>Some ordinary activity.</strong> If the account has been dormant, use it by hand for a couple of weeks first:
          accept pending invitations, connect with people you actually know, comment on a few posts. Vendor warm-up guides
          recommend the same.
        </li>
      </ul>

      <h3 id="targeting">Targeting people likely to accept</h3>
      <p>
        Early acceptance is the evidence the rest of the warm-up stands on. Start with the people who have the most obvious
        reason to accept: same industry, a shared group or connection, someone whose post you engaged with. Write each note from
        that person&rsquo;s own details; a template with the first name swapped in is what gets ignored. Keep links out of
        connection notes entirely.
      </p>

      <h2 id="new-account">Warming up a brand-new account</h2>
      <p>
        A profile created this month has no history at all, and nothing about it says a person is behind it yet. Nora&rsquo;s ramp
        cannot tell a new profile from an old one, because it counts only what Nora has sent, so give a brand-new account a head
        start by hand before you connect it:
      </p>
      <ol>
        <li>
          <strong>Finish the profile first.</strong> Photo, headline, current role, a few past roles, a location and a short
          about section, before the first invitation of any kind.
        </li>
        <li>
          <strong>Spend two or three weeks as a person.</strong> Connect with colleagues, clients and friends who will recognize
          your name, accept invitations, follow a few companies and leave some real comments. Several vendor warm-up guides
          recommend manual-only use for this long before any automation.
        </li>
        <li>
          <strong>Then start below the ramp.</strong> Set each campaign&rsquo;s daily limit at about half of Nora&rsquo;s starting{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} for the first week, and raise it once acceptances are coming in.
        </li>
      </ol>

      <h2 id="messages-inmail">Messages and InMail during a warm-up</h2>
      <p>
        Messages need less of a ramp than invitations, because a message only goes to somebody who already accepted. Nora writes
        to people only after they connect, so its message volume follows the invitation ramp on its own, under a separate ceiling
        of {PUBLIC_LIMITS.messagesPerDay} a day that never draws on the invitation allowance. The first message goes out{" "}
        {Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / MINUTE_MS)} to{" "}
        {Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / MINUTE_MS)} minutes after an acceptance is noticed, inside working
        hours, so a quiet first week of invitations means a quiet first week of messages.
      </p>
      <p>
        InMail is metered differently. It goes to people you are not connected to and is limited by credits rather than by a
        daily number: LinkedIn&rsquo;s InMail FAQ lists 15 credits a month on Premium Business as of October 2026. Nora does not
        send InMail. If you use it by hand during a warm-up, keep it for a few people you have a real reason to write to, since
        a stranger reporting an unwanted message hurts the account however it arrived.
      </p>

      <h2 id="restart">Restarting after a pause or a restriction</h2>
      <p>
        Nora&rsquo;s ramp runs from the first send and does not reset, so an account that warmed up in the spring, then sent nothing
        for two months, comes back at its full allowance. LinkedIn does not say what a pause changes, so nobody can tell you
        exactly how much caution it calls for. If you want a gentler return, set each campaign&rsquo;s daily invitation limit
        lower when you resume and raise it over a few weeks.
      </p>
      <p>
        After a restriction, do the same and start near {PUBLIC_LIMITS.invitesPerDayStart} a day, after a few days with no
        invitations at all. Our <Link href="/guides/linkedin-account-restricted">plan for a restricted LinkedIn account</Link> has
        a two-week return plan.
      </p>

      <h2 id="too-fast">Signs the ramp is too fast</h2>
      <ul>
        <li>
          <strong>Acceptance below {PUBLIC_LIMITS.healthyAcceptance}%.</strong> The single most useful number. Nora flags the
          account in a nightly check; it does not slow the ramp for you, so treat the flag as the moment to lower the campaign&rsquo;s
          daily limit and tighten the list.
        </li>
        <li>
          <strong>Invitations refused with &ldquo;try again later&rdquo;.</strong> Stop. Nora pauses invitations from the account
          automatically and waits longer each time it happens.
        </li>
        <li>
          <strong>The weekly invitation banner</strong> in the first month. The account met LinkedIn&rsquo;s line before the ramp did.
        </li>
        <li>
          <strong>More CAPTCHAs or forced re-logins</strong> than usual, with no new device or travel to explain them.
        </li>
        <li>
          <strong>A pending pile that only grows.</strong> A targeting signal before it is a safety one. Nora withdraws invitations
          still pending after {LINKEDIN_LIMITS.withdrawAfterDays} days.
        </li>
      </ul>
      <p>
        Inside each day, the allowance is spread across your working hours, and no two actions are ever closer than{" "}
        {MIN_GAP_MIN} minutes (a random gap of {MIN_GAP_MIN} to {MAX_GAP_MIN} minutes is the floor). Our guide to the{" "}
        <Link href="/guides/best-time-to-send-linkedin-connection-requests">best time to send LinkedIn connection requests</Link>{" "}
        explains why, and <Link href="/guides/is-linkedin-automation-safe">is LinkedIn automation safe?</Link> covers the risk a
        warm-up lowers but cannot remove.
      </p>
      <p>
        The <Link href="/tools/linkedin-limit-calculator">LinkedIn limit calculator</Link> works out what your account can send
        today from the day it started sending, using the same numbers as the table above. The full set of limits is on{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits in 2026</Link>, and more guides are in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>. If you would rather the ramp ran itself,{" "}
        <Link href="/how-it-works">see how Nora runs the warm-up for you</Link>.
      </p>
    </ArticleLayout>
  );
}
