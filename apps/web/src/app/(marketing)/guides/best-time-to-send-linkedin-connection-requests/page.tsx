import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable } from "@/components/article";
import { PacingDayFigure, ZoneOverlap, hourLabel } from "@/components/seo/ga1-diagrams";
import { PUBLIC_LIMITS } from "@/lib/site";
import { DEFAULT_WORKING_HOURS, LINKEDIN_LIMITS } from "@le/shared";
import { invitePaceMs, nextGapMs, spreadGapMs } from "@le/linkedin";

const PATH = "/guides/best-time-to-send-linkedin-connection-requests";

export const metadata: Metadata = articleMeta(PATH);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const START_HOUR = DEFAULT_WORKING_HOURS.start;
const END_HOUR = DEFAULT_WORKING_HOURS.end;
const WORKING_DAYS = DEFAULT_WORKING_HOURS.days.map((d) => DAY_NAMES[d] ?? String(d));
const FIRST_DAY = WORKING_DAYS[0] ?? "";
const LAST_DAY = WORKING_DAYS[WORKING_DAYS.length - 1] ?? "";
const DAY_HOURS = END_HOUR - START_HOUR;
const FULL_DAY_MS = DAY_HOURS * HOUR;
const LATE_WINDOW_MS = 2 * HOUR;
const HOURS_TEXT = `${hourLabel(START_HOUR)} to ${hourLabel(END_HOUR)}`;
/** "an 8 a.m." but "a 9 a.m.": the article follows how the hour is said. */
const A_HOURS = /^(8|11|18)\b/.test(HOURS_TEXT) ? "an" : "a";

const mins = (ms: number) => Math.round(ms / MINUTE);

/*
 * The spacing a day's allowance works out to, read from the same functions the
 * pacing loop calls. `random` at its two extremes gives the narrowest and widest
 * gap the jitter can produce, so the ranges on this page are the code's own.
 */
function paceRow(remaining: number, windowMs: number) {
  const target = invitePaceMs({ remaining, windowMs }) ?? 0;
  const low = spreadGapMs({ remaining, windowMs, random: () => 0 });
  const high = spreadGapMs({ remaining, windowMs, random: () => 0.999999 });
  return { target: mins(target), low: mins(low), high: mins(high) };
}

const FIRST_DAY_PACE = paceRow(PUBLIC_LIMITS.invitesPerDayStart, FULL_DAY_MS);
const WARMED_PACE = paceRow(PUBLIC_LIMITS.invitesPerDayMax, FULL_DAY_MS);
const LATE_PACE = paceRow(PUBLIC_LIMITS.invitesPerDayStart, LATE_WINDOW_MS);
const FLOOR_LOW = mins(nextGapMs(() => 0));
const FLOOR_HIGH = mins(nextGapMs(() => 0.999999));
const BURST_MINUTES_LOW = FLOOR_LOW * (PUBLIC_LIMITS.invitesPerDayStart - 1);
const BURST_MINUTES_HIGH = FLOOR_HIGH * (PUBLIC_LIMITS.invitesPerDayStart - 1);
const VIEW_TO_INVITE_MIN = mins(LINKEDIN_LIMITS.warmUpToInviteMinMs);
const VIEW_TO_INVITE_MAX_HOURS = Math.round(LINKEDIN_LIMITS.warmUpToInviteMaxMs / HOUR);
const ACCEPT_MIN = mins(LINKEDIN_LIMITS.acceptFollowUpMinMs);
const ACCEPT_MAX = mins(LINKEDIN_LIMITS.acceptFollowUpMaxMs);

/*
 * US time zones as hours behind Eastern. Standard and daylight time shift
 * together, so the offsets hold all year everywhere except Arizona.
 */
const ZONES = [
  { name: "ET", city: "New York", behind: 0 },
  { name: "CT", city: "Chicago", behind: 1 },
  { name: "MT", city: "Denver", behind: 2 },
  { name: "PT", city: "Los Angeles", behind: 3 },
] as const;
const PT_BEHIND = 3;
const OVERLAP_START = START_HOUR + PT_BEHIND;

const FAQ = [
  {
    q: "What day is best to send LinkedIn connection requests?",
    a: "Most vendor guides name Tuesday to Thursday, but none publishes a controlled study, and the largest day-by-day figure we found, for reply rates, put the best and worst days about half a percentage point apart. Treat mid-week as a mild preference. Who you invite and what the note says move results far more than the day.",
  },
  {
    q: "What delay should I use between LinkedIn actions?",
    a: `Long enough that a day's invitations are spread across the working day, not a random pause of seconds. Nora divides the working time left by the day's allowance and jitters the result: about ${FIRST_DAY_PACE.low} to ${FIRST_DAY_PACE.high} minutes apart for ${PUBLIC_LIMITS.invitesPerDayStart} invitations over a ${DAY_HOURS}-hour day, and never closer than ${FLOOR_LOW} minutes, with a random floor of ${FLOOR_LOW} to ${FLOOR_HIGH} minutes whatever the arithmetic says.`,
  },
  {
    q: "Should LinkedIn automation run on weekends?",
    a: `Generally no. People who work ${FIRST_DAY} to ${LAST_DAY} do not expect business invitations on Saturday, and activity at hours nobody works looks less like a person. Nora sends only inside the account's working hours, ${HOURS_TEXT} ${FIRST_DAY} to ${LAST_DAY} by default, and you can change the hours and days.`,
  },
  {
    q: "Should I send in my time zone or theirs?",
    a: `Theirs, where you can. A rep in New York who starts at ${hourLabel(START_HOUR)} ET is inviting Californians at ${hourLabel(START_HOUR - PT_BEHIND)} PT. Nora paces each account in the rep's own time zone and working hours, so for a West Coast list, start the sending hours at ${hourLabel(OVERLAP_START)} ET, or run that region from a colleague who lives there.`,
  },
];

const SOURCES = [
  { label: "Bardeen: best time to send a LinkedIn connection request", url: "https://bardeen.ai/answers/best-time-to-send-linkedin-connection-request" },
  { label: "Bardeen: best time to send LinkedIn messages (business hours versus evenings and weekends)", url: "https://bardeen.ai/answers/best-time-to-send-linkedin-messages" },
  { label: "PhantomBuster: best time to send a LinkedIn request", url: "https://phantombuster.com/blog/social-selling/best-time-to-send-linkedin-request/" },
  { label: "Fuzzy: best time to send LinkedIn messages (the crowded-window argument)", url: "https://getfuzzy.ai/blog/best-time-linkedin-messages" },
  { label: "Overloop: LinkedIn outreach benchmarks (summarizing Belkins and Botdog data)", url: "https://overloop.com/blog/linkedin-outreach-benchmarks" },
  { label: "Expandi: LinkedIn outreach benchmarks 2026, acceptance by industry", url: "https://expandi.io/blog/linkedin-outreach-benchmarks-2026/" },
  { label: "LinkedIn Help: Types of restrictions for sending invitations", url: "https://www.linkedin.com/help/linkedin/answer/a551012" },
];

const STUDIES = [
  { label: "Bardeen", values: ["Tuesday to Thursday", "10 to 11 a.m. and 5 to 6 p.m., their time", "\"Recent studies\", not named"] },
  { label: "PhantomBuster", values: ["Tuesday to Thursday; avoid Monday and Friday", "8:30 to 10:30 a.m. and 2 to 4 p.m., their time", "No figures published"] },
  { label: "Fuzzy", values: ["Not the popular slot", "A less crowded time than Tuesday at 10 a.m.", "Argument, not a dataset"] },
];

const PACE_ROWS = [
  {
    label: `First day of sending, a full ${DAY_HOURS}-hour day`,
    values: [PUBLIC_LIMITS.invitesPerDayStart, `${FIRST_DAY_PACE.low} to ${FIRST_DAY_PACE.high} minutes`],
  },
  {
    label: `Fully warmed account, a full ${DAY_HOURS}-hour day`,
    values: [PUBLIC_LIMITS.invitesPerDayMax, `${WARMED_PACE.low} to ${WARMED_PACE.high} minutes`],
  },
  {
    label: "Campaign launched with two working hours left",
    values: [PUBLIC_LIMITS.invitesPerDayStart, `${LATE_PACE.low} to ${LATE_PACE.high} minutes`],
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="The best time to send LinkedIn connection requests is all day, slowly"
      lede={`The best time to send LinkedIn connection requests is spread across your prospects' working day, Monday to Friday, not one slot that every request lands in. The day-of-week studies agree on little beyond "mid-week, working hours", and the gaps they report are small; how evenly you pace a day's invitations matters more to the account than which hour you pick.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">The short answer</h2>
      <ul>
        <li>
          <strong>Send on working days, inside working hours,</strong> in the time zone where most of your
          prospects are.
        </li>
        <li>
          <strong>Prefer mid-week if you have a choice,</strong> but do not hold invitations back for Tuesday.
          The measured gap between days is small.
        </li>
        <li>
          <strong>Spread the day&apos;s allowance across the whole day.</strong> For a new account sending{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} a day that means roughly one every {FIRST_DAY_PACE.target}{" "}
          minutes, not ten in a row at 9 a.m.
        </li>
        <li>
          <strong>Skip weekends and nights.</strong> Nobody is reading, and activity at hours nobody works is
          the easiest pattern to tell apart from a person.
        </li>
      </ul>
      <PacingDayFigure />

      <h2 id="studies">What the day-of-week studies say, and why they disagree</h2>
      <p>
        As of October 2026, most published advice on this question comes from tools that send LinkedIn
        invitations. Their recommendations overlap on mid-week and disagree on the hours.
      </p>
      <CompareTable
        caption="Best-time recommendations for LinkedIn connection requests and messages, as published by October 2026"
        columns={["Days", "Hours", "Evidence shown"]}
        rows={STUDIES}
      />
      <p>Three things explain the disagreement.</p>
      <ul>
        <li>
          <strong>Different measures.</strong> Some figures are acceptance rates for invitations, others
          are reply rates for messages. They are not the same event and need not peak at the same time.
        </li>
        <li>
          <strong>Small differences.</strong> Overloop&apos;s summary of a Belkins analysis of more than 20
          million outreach attempts puts the best day, Tuesday, at 6.90% replies and the worst, Saturday,
          at 6.40%. By contrast, across the 38 industries with at least 50 sending accounts,
          Expandi&apos;s 2026 benchmarks report acceptance from 21.8% to 36.5%. Who you write to moves the
          number far more than when.
        </li>
        <li>
          <strong>The advice changes the result.</strong> Fuzzy makes the fair point that when every sales
          team sends at 10 a.m. on Tuesday, that becomes the most crowded hour in a prospect&apos;s inbox.
        </li>
      </ul>
      <p>
        There is also a timing fact that makes the hour matter less than it seems. Overloop cites a Botdog
        study of 16,492 requests in which 63% of acceptances arrived within 24 hours and 88% within a week.
        An invitation is not a live chat: most people deal with it when they next open LinkedIn, whenever
        it arrived.
      </p>

      <h2 id="burst">Why one &quot;best time&quot; becomes a burst</h2>
      <p>
        The trouble with a single best slot is what it does to the sending pattern. If 10 a.m. on Tuesday is
        the best time, the obvious move is to send everything at 10 a.m. on Tuesday. A whole day&apos;s
        invitations in a few minutes is exactly what LinkedIn says it watches for: its help center lists
        sending many invitations in a short time among the reasons an account is restricted from sending
        more.
      </p>
      <p>
        Our own first live account sent seven invitations in 27 minutes this way, inside its daily cap, and
        LinkedIn refused its invitations for days; the full account is in{" "}
        <Link href="/guides/is-linkedin-automation-safe#seven-in-27">whether LinkedIn automation is safe</Link>.
      </p>
      <Callout tone="warning">
        <p>
          <strong>A daily cap is not pacing.</strong> At the floor gap of {FLOOR_LOW} to {FLOOR_HIGH} minutes,{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} invitations take between {BURST_MINUTES_LOW} and{" "}
          {BURST_MINUTES_HIGH} minutes. A ceiling with no spacing underneath it is a burst with a maximum
          size.
        </p>
      </Callout>

      <h2 id="spreading">Spreading a day&apos;s allowance across working hours</h2>
      <p>
        The fix is arithmetic, and you can do it by hand as easily as software can. Three rules cover it.
      </p>

      <h3 id="divide">Divide the remaining day by the allowance</h3>
      <p>
        Take the working time left today and divide it by the invitations still to send. Then add jitter,
        so the gaps are not identical, and leave room for the jitter at the end of the day, or the last
        few invitations spill past closing time. Nora divides by the allowance times the widest the jitter
        can stretch, so even a day that draws long gaps every time still fits.
      </p>
      <CompareTable
        caption={`Gap between invitations under Nora's pacing, working hours ${HOURS_TEXT}`}
        columns={["Invitations to place", "Gap between them"]}
        rows={PACE_ROWS}
      />
      <p>
        The divisor is the day&apos;s allowance, never the handful of people who happen to be ready at that
        moment. Divide by those and a single invitation gets placed hours away while the next batch piles
        on top of it, at a rate nobody chose. The allowance itself grows as the account warms up; the{" "}
        <Link href="/guides/linkedin-warm-up-schedule">week-by-week LinkedIn warm-up schedule</Link> shows
        how it climbs from {PUBLIC_LIMITS.invitesPerDayStart} a day to {PUBLIC_LIMITS.invitesPerDayMax}.
      </p>

      <h3 id="minimum-gap">Keep a minimum gap</h3>
      <p>
        When the day is short, the arithmetic can ask for invitations seconds apart. A campaign launched
        late in the afternoon is the usual case. Keep a floor: Nora never places two actions on one account
        closer than {FLOOR_LOW} minutes apart, and each gap has a random floor somewhere between {FLOOR_LOW}{" "}
        and {FLOOR_HIGH} minutes. On a full day the spread gap is far wider than that floor; the floor only
        decides the spacing when little of the day is left. If that means part of today&apos;s allowance is
        not spent, it is not spent. It does not roll over into tomorrow.
      </p>

      <h3 id="their-time-zone">Their time zone, not yours</h3>
      <p>
        &quot;9 a.m.&quot; only means something in a time zone. A rep in New York whose day starts at{" "}
        {hourLabel(START_HOUR)} ET is reaching Los Angeles at {hourLabel(START_HOUR - PT_BEHIND)} PT, hours
        before anyone there opens LinkedIn. Here is {A_HOURS} {HOURS_TEXT} ET sending day as it lands across the
        country.
      </p>
      <ZoneOverlap zones={ZONES} start={START_HOUR} end={END_HOUR} />
      <p>
        For a list spread across the country, the hours every zone shares are {hourLabel(OVERLAP_START)} to{" "}
        {hourLabel(END_HOUR)} ET, which is {hourLabel(OVERLAP_START - PT_BEHIND)} to{" "}
        {hourLabel(END_HOUR - PT_BEHIND)} PT. Arizona does not change its clocks, so from March to November
        it matches Pacific time rather than Mountain.
      </p>
      <p>
        How Nora handles it: it paces each account in the rep&apos;s own time zone and working hours, which
        default to {HOURS_TEXT}, {FIRST_DAY} to {LAST_DAY}. The day&apos;s counters also roll over at the
        rep&apos;s midnight, so a Pacific rep&apos;s allowance does not reset at 5 p.m. If most of your
        prospects live elsewhere, change the account&apos;s sending hours to overlap their working day, or
        split the region onto a colleague&apos;s account in that time zone.
      </p>

      <h2 id="random-delays">Random delays are not enough on their own</h2>
      <p>
        Random delays between actions are often presented as the safety feature on their own. Randomness
        hides a metronome; it does not hide a burst. Ten invitations with random gaps of 30 to 90 seconds
        still all go out inside a quarter of an hour.
      </p>
      <p>What actually makes a day&apos;s activity look like a person&apos;s is a mix of things:</p>
      <ul>
        <li>
          <strong>Spread first, jitter second.</strong> Spacing set by the length of the day, with
          randomness around it.
        </li>
        <li>
          <strong>Retries that do not stampede.</strong> When the limiter holds several invitations, they
          should not all wake at the same instant and leave in a row. Nora adds a fresh random gap to every
          retry.
        </li>
        <li>
          <strong>A profile view before the invitation, at a distance.</strong> Nora can look at a
          prospect&apos;s profile first, from its own allowance of {LINKEDIN_LIMITS.profileViewsPerDay} views a
          day, and sends the invitation {VIEW_TO_INVITE_MIN} minutes to {VIEW_TO_INVITE_MAX_HOURS} hours
          later. A view and an invitation in the same minute is a robot announcing itself.
        </li>
        <li>
          <strong>Sensible totals.</strong> Pacing does not make a high number safe. The{" "}
          <Link href="/linkedin-automation-limits">LinkedIn connection request limits</Link> page lists the
          daily and weekly caps Nora holds every account to, including {PUBLIC_LIMITS.invitesPerWeek} a week.
        </li>
      </ul>

      <h2 id="follow-ups">When to send follow-up messages</h2>
      <p>
        An invitation is accepted when the person gets to it, so the clock for a follow-up starts at the
        acceptance, not at the invitation. Two timings matter.
      </p>
      <ul>
        <li>
          <strong>The first message, soon after they accept.</strong> Someone who accepted ten minutes ago
          remembers your name; someone who accepted three days ago does not. Nora checks for new
          acceptances every hour and sends the first message {ACCEPT_MIN} to {ACCEPT_MAX} minutes after it
          notices one, inside the rep&apos;s working hours, so it usually arrives within a couple of hours of
          the acceptance. Somebody who accepts at 11 p.m. hears from you the next morning, not at midnight.
        </li>
        <li>
          <strong>Later steps, days apart.</strong> A second and third message should wait a few working
          days each, counted from the message before, and land inside the prospect&apos;s working hours like
          the invitation did. Any reply stops the sequence; nobody wants a scheduled nudge after they have
          already answered. Nora uses the delays you set for these steps and holds every account to{" "}
          {PUBLIC_LIMITS.messagesPerDay} messages a day across all campaigns.
        </li>
      </ul>

      <h2 id="weekends">Weekends, holidays and evenings</h2>
      <p>
        Leave them out. Bardeen reports that for messages, response rates outside business hours are about
        the same as inside them, so there is no reply benefit to sending at night, and an account whose
        activity stops when working people stop looks more like one of them. Invitations queued over a
        weekend should go out across Monday at the normal pace, not all at 9 a.m.; Nora places held
        invitations with a fresh random gap each so the backlog does not drain in a row.
      </p>
      <p>
        Public holidays are the gap: Nora does not know your prospects&apos; holiday calendar. Before a holiday
        that matters to your market, such as Thanksgiving week or the days between Christmas and New
        Year&apos;s, pause the campaign from its page and resume it after.
      </p>
      <p>
        No pacing makes automation risk-free, since LinkedIn&apos;s user agreement prohibits it; pacing stops you sending
        the pattern LinkedIn names. <Link href="/how-it-works">How Nora works</Link> shows a whole campaign run on
        these rules.
      </p>
    </ArticleLayout>
  );
}
