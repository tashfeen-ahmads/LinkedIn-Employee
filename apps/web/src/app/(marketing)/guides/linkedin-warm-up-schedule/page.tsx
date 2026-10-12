import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";
import { DEFAULT_WORKING_HOURS, LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";

const PATH = "/guides/linkedin-warm-up-schedule";

export const metadata: Metadata = articleMeta(PATH);

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/*
 * The schedule is `dailyInviteCap` called once per working day, the same
 * function the sender checks before every invitation, over the real warm-up
 * length plus the first full week after it. The first send is placed on a
 * Monday (5 January 2026) so the working days line up with the default
 * Monday-to-Friday hours; nothing else about the date matters.
 */
const FIRST_SEND = new Date("2026-01-05T09:00:00Z");
const WARMUP_WEEKS = Math.ceil(LINKEDIN_LIMITS.warmupDays / 7);
/** Offsets from Monday of each working day: Monday 0 to Sunday 6. */
const WORKING_OFFSETS = DEFAULT_WORKING_HOURS.days.map((weekday) => (weekday + 6) % 7);

const SCHEDULE = Array.from({ length: WARMUP_WEEKS + 1 }, (_, week) => {
  const days = WORKING_OFFSETS.map((offset) => week * 7 + offset);
  const caps = days.map((day) => dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + day * DAY_MS)));
  const sum = caps.reduce((a, b) => a + b, 0);
  const low = Math.min(...caps);
  const high = Math.max(...caps);
  return {
    week: week + 1,
    firstDay: week * 7,
    lastDay: week * 7 + 6,
    low,
    high,
    sum,
    most: Math.min(sum, PUBLIC_LIMITS.invitesPerWeek),
    weeklyBinds: sum > PUBLIC_LIMITS.invitesPerWeek,
  };
});

const FIRST_WEEK = SCHEDULE[0]!;
const FIRST_BINDING_WEEK = SCHEDULE.find((w) => w.weeklyBinds)?.week ?? null;
const FULL_FROM_DAY = LINKEDIN_LIMITS.warmupDays;
const VIEW_TO_INVITE_MIN = Math.round(LINKEDIN_LIMITS.warmUpToInviteMinMs / MINUTE_MS);
const VIEW_TO_INVITE_MAX_H = Math.round(LINKEDIN_LIMITS.warmUpToInviteMaxMs / (60 * MINUTE_MS));
const MIN_GAP_MIN = Math.round(LINKEDIN_LIMITS.minGapMs / MINUTE_MS);
const MAX_GAP_MIN = Math.round(LINKEDIN_LIMITS.maxGapMs / MINUTE_MS);

function range(low: number, high: number): string {
  return low === high ? String(low) : `${low} to ${high}`;
}

const LAST_RAMP_WEEK = SCHEDULE[WARMUP_WEEKS - 1]!;
const FULL_WEEK = SCHEDULE[WARMUP_WEEKS]!;

const FAQ = [
  {
    q: "How long should I warm up a LinkedIn account?",
    a: `LinkedIn publishes no warm-up period, so any answer is a judgement. Nora ramps every account from ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day to ${PUBLIC_LIMITS.invitesPerDayMax} over ${PUBLIC_LIMITS.warmupWeeks} weeks, counted from the first invitation it sends. A brand-new or long-dormant profile benefits from a few weeks of ordinary manual use before that, which vendor guides also recommend.`,
  },
  {
    q: "How many connection requests should a new account send?",
    a: `Start low. Nora's ramp begins at ${PUBLIC_LIMITS.invitesPerDayStart} a day, which allows at most ${FIRST_WEEK.most} in the first working week, and climbs by a little each day. Some vendor schedules start lower, at around 5 a day. What matters more than the exact start is that it rises slowly and that the day's invitations are spread out rather than sent in one sitting.`,
  },
  {
    q: "Does viewing a profile before connecting help?",
    a: `It can. An invitation from a name somebody has just seen in their profile viewers is less of a cold arrival. The view has to come first and not too long before: Nora sends the invitation ${VIEW_TO_INVITE_MIN} minutes to ${VIEW_TO_INVITE_MAX_H} hours after the view, and views have their own allowance of ${LINKEDIN_LIMITS.profileViewsPerDay} a day. Nobody publishes a measured effect, so treat it as courtesy, not a guarantee.`,
  },
  {
    q: "Do I need to warm up an old account that has never automated?",
    a: "Usually, yes. Age helps, but what a warm-up protects against is a sudden change in behaviour. If the account has never sent more than a handful of invitations a week, going to dozens a day is that change, however old the profile. Nora treats it as new: an account that has never sent through it starts at the bottom of the ramp whatever its age.",
  },
  {
    q: "What is a safe LinkedIn ramp-up schedule?",
    a: `One that starts low, rises a little each day, and stays under a weekly ceiling. Nora's goes from ${PUBLIC_LIMITS.invitesPerDayStart} a day in week 1 to ${PUBLIC_LIMITS.invitesPerDayMax} a day from day ${LINKEDIN_LIMITS.warmupDays}, never above ${PUBLIC_LIMITS.invitesPerWeek} a week. If acceptance falls below ${PUBLIC_LIMITS.healthyAcceptance}% at any point, hold the number where it is and fix the list before climbing further.`,
  },
];

const SOURCES = [
  { label: "LinkedIn Help: Invitation restrictions (reasons and durations)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "LinkedIn Help: Invitation limit reached", url: "https://www.linkedin.com/help/billing/answer/a550555" },
  { label: "PhantomBuster: LinkedIn account warm-up guide (studied for this page)", url: "https://phantombuster.com/blog/social-selling/linkedin-account-warm-up-guide/" },
  { label: "Snov.io: how to enable automatic LinkedIn account warm-up (studied for this page)", url: "https://snov.io/knowledgebase/how-to-enable-automatic-linkedin-account-warm-up/" },
  { label: "SalesMind: how to warm up your LinkedIn account (studied for this page)", url: "https://docs.sales-mind.ai/en/articles/11513833-how-to-warm-up-your-linkedin-account" },
  { label: "Waalaxy: how to heat up a LinkedIn account", url: "https://www.waalaxy.com/blog/linkedin-platform-knowledge/heat-up-linkedin-account" },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="How to warm up a LinkedIn account before outreach"
      lede={`To warm up a LinkedIn account, start with a small number of connection requests and raise it over several weeks, counting from the day the account first sends through a tool, not the day you connected one. Nora starts every account at ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day and ramps to ${PUBLIC_LIMITS.invitesPerDayMax} over ${PUBLIC_LIMITS.warmupWeeks} weeks under a weekly ceiling of ${PUBLIC_LIMITS.invitesPerWeek}; the schedule below is generated from the code that enforces it.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <p>In short:</p>
      <CompareTable
        caption="Nora's LinkedIn warm-up at a glance, read from the sending code"
        columns={["Invitations a day", "Most in the week"]}
        rows={[
          { label: "Week 1", values: [range(FIRST_WEEK.low, FIRST_WEEK.high), FIRST_WEEK.most] },
          { label: `Week ${WARMUP_WEEKS}`, values: [range(LAST_RAMP_WEEK.low, LAST_RAMP_WEEK.high), LAST_RAMP_WEEK.most] },
          { label: `Week ${FULL_WEEK.week} onwards`, values: [range(FULL_WEEK.low, FULL_WEEK.high), FULL_WEEK.most] },
        ]}
      />
      <p>
        A warm-up exists so that an account&apos;s behaviour never changes suddenly. A profile that has sent five invitations a
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
        From LinkedIn&apos;s side nothing happened during those weeks. Connecting a tool is not activity it can see; sending is. So
        measuring from the connection would hand a never-used account the full {PUBLIC_LIMITS.invitesPerDayMax}-a-day allowance
        on its first day, which is precisely the jump a warm-up exists to prevent.
      </p>
      <Callout tone="safety">
        <p>
          <strong>Nora&apos;s rule:</strong> the ramp starts at the account&apos;s first action through Nora. An account that has sent
          nothing sits at {PUBLIC_LIMITS.invitesPerDayStart} a day however long ago it was connected. The ramp counts calendar
          days, so weekends move it forward even though nothing is sent on them.
        </p>
      </Callout>

      <h2 id="schedule">How to warm up a LinkedIn account: the schedule, week by week</h2>
      <p>
        This table is produced by calling <code>dailyInviteCap</code>, the function Nora&apos;s sender checks before every
        invitation, for each working day of the warm-up. It assumes the first invitation goes out on a Monday and the account
        sends Monday to Friday, which is the default.
      </p>
      <CompareTable
        caption={`Nora's warm-up ramp: daily and weekly invitation allowance from the first send (weekly ceiling ${PUBLIC_LIMITS.invitesPerWeek})`}
        columns={["Days since first send", "Daily allowance", "Most in that week", "What limits the week"]}
        rows={SCHEDULE.map((w) => ({
          label: w.week > WARMUP_WEEKS ? `Week ${w.week} onward` : `Week ${w.week}`,
          values: [
            w.week > WARMUP_WEEKS ? `${w.firstDay} and later` : `${w.firstDay} to ${w.lastDay}`,
            range(w.low, w.high),
            w.most,
            w.weeklyBinds ? "The weekly ceiling" : "The daily ramp",
          ],
        }))}
      />

      <h3 id="week-1">Week 1: {PUBLIC_LIMITS.invitesPerDayStart} a day, rising slowly</h3>
      <p>
        The first week allows {range(FIRST_WEEK.low, FIRST_WEEK.high)} a day and at most {FIRST_WEEK.most} in total. That is
        deliberately modest, and higher than some vendor schedules, which start nearer 5 a day. It is enough to learn whether
        people accept your invitations. Send only to your best-fit people this week, and read every acceptance and every silence.
      </p>

      <h3 id="weeks-2-4">Weeks 2 to 4</h3>
      <p>
        The daily allowance rises by a fraction of an invitation each day, so the increase is never a step anyone could see.
        {FIRST_BINDING_WEEK !== null ? (
          <>
            {" "}From week {FIRST_BINDING_WEEK} the five working days add up to more than {PUBLIC_LIMITS.invitesPerWeek}, so the
            weekly ceiling binds before the daily ramp does. After that point the ramp changes how a week is spread across days
            rather than how much it holds.
          </>
        ) : null}{" "}
        If acceptance in these weeks is below {PUBLIC_LIMITS.healthyAcceptance}%, hold the daily number where it is and fix the
        list before letting it climb.
      </p>

      <h3 id="full-allowance">
        Week {FULL_WEEK.week} onwards: {PUBLIC_LIMITS.invitesPerDayMax} a day inside {PUBLIC_LIMITS.invitesPerWeek} a week
      </h3>
      <p>
        The daily allowance reaches {PUBLIC_LIMITS.invitesPerDayMax} on day {FULL_FROM_DAY} and stays there. The week, not the
        day, is now the real limit: {PUBLIC_LIMITS.invitesPerDayMax} a day would spend {PUBLIC_LIMITS.invitesPerWeek} in three
        days. Our guide to the <Link href="/guides/linkedin-weekly-invitation-limit">LinkedIn weekly invitation limit</Link>{" "}
        explains why the week is the number that matters and how to spread it.
      </p>
      <Callout tone="info">
        <p>
          <strong>These are ceilings, not targets.</strong> A campaign can set a lower daily limit at any point, and the ramp still
          applies on top. Nothing can go above it.
        </p>
      </Callout>

      <h2 id="profile-views">Profile views as warm-up</h2>
      <p>
        A second meaning of &quot;warm-up&quot; is per person rather than per account: look at someone&apos;s profile before inviting
        them, so the request arrives from a name they may have just seen among their profile viewers. Nobody publishes a measured
        effect on acceptance, so treat it as a courtesy that costs little, not a trick.
      </p>

      <h3 id="view-then-invite">View first, invite within a few hours</h3>
      <p>
        The order and the gap both matter. A view and an invitation in the same minute look like one automated action. A view
        three days earlier has been forgotten. With profile-view warm-up on (a per-campaign option, ticked by default when you
        create a campaign), Nora sends the invitation between {VIEW_TO_INVITE_MIN} minutes and {VIEW_TO_INVITE_MAX_H} hours after
        the view, still inside working hours. It does not spend a view when the invitation could not follow within that window,
        for example late on a Friday or while LinkedIn is holding invitations. A view older than that window no longer counts, and
        if a view is refused the invitation goes out without one rather than being held for ever.
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
        that person&apos;s own details; a template with the first name swapped in is what gets ignored. Keep links out of
        connection notes entirely. Messages to people who accept are a separate allowance of {PUBLIC_LIMITS.messagesPerDay} a day
        and never come out of the invitation ramp.
      </p>

      <h2 id="restart">Restarting after a pause or a restriction</h2>
      <p>
        Nora&apos;s ramp runs from the first send and does not reset, so an account that warmed up in the spring, then sent nothing
        for two months, comes back at its full allowance. LinkedIn does not say what a pause changes, so nobody can tell you
        exactly how much caution it calls for. If you want a gentler return, set each campaign&apos;s daily invitation limit
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
          account in a nightly check; it does not slow the ramp for you, so treat the flag as the moment to lower the campaign&apos;s
          daily limit and tighten the list.
        </li>
        <li>
          <strong>Invitations refused with &quot;try again later&quot;.</strong> Stop. Nora pauses invitations from the account
          automatically and waits longer each time it happens.
        </li>
        <li>
          <strong>The weekly invitation banner</strong> in the first month. The account met LinkedIn&apos;s line before the ramp did.
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
        Inside each day, the allowance is spread across your working hours, with at least {MIN_GAP_MIN} to {MAX_GAP_MIN} minutes
        between any two actions. Our guide to the{" "}
        <Link href="/guides/best-time-to-send-linkedin-connection-requests">best time to send LinkedIn connection requests</Link>{" "}
        explains why, and <Link href="/guides/is-linkedin-automation-safe">is LinkedIn automation safe?</Link> covers the risk a
        warm-up lowers but cannot remove: LinkedIn&apos;s terms prohibit automated sending altogether.
      </p>
      <p>
        The <Link href="/tools/linkedin-limit-calculator">LinkedIn limit calculator</Link> works out what your account can send
        today from the day it started sending, using the same function as the table above. The full set of limits is on{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits in 2026</Link>, and more guides are in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>. If you would rather the ramp ran itself,{" "}
        <Link href="/how-it-works">see how Nora works</Link>; it is free while we grow:{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
