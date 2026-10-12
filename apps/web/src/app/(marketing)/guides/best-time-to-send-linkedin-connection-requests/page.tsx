import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";
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
const FULL_DAY_MS = (END_HOUR - START_HOUR) * HOUR;
const LATE_WINDOW_MS = 2 * HOUR;

const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
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

const FAQ = [
  {
    q: "What day is best to send LinkedIn connection requests?",
    a: "Most vendor guides name Tuesday to Thursday, but none publishes a controlled study, and the largest day-by-day figure we found, for reply rates, put the best and worst days about half a percentage point apart. Treat mid-week as a mild preference. Who you invite and what the note says move results far more than the day.",
  },
  {
    q: "What delay should I use between LinkedIn actions?",
    a: `Long enough that a day's invitations are spread across the working day, not just a random pause of seconds. Nora divides the working time left by the day's allowance and jitters the result: about ${FIRST_DAY_PACE.low} to ${FIRST_DAY_PACE.high} minutes apart for ${PUBLIC_LIMITS.invitesPerDayStart} invitations over a ${END_HOUR - START_HOUR}-hour day, with ${FLOOR_LOW} to ${FLOOR_HIGH} minutes as the floor whatever the arithmetic says.`,
  },
  {
    q: "Should LinkedIn automation run on weekends?",
    a: `Generally no. People who work ${FIRST_DAY} to ${LAST_DAY} do not expect business invitations on Saturday, and activity at hours nobody works looks less like a person. Nora sends only inside the account's working hours, ${pad(START_HOUR)} to ${pad(END_HOUR)} ${FIRST_DAY} to ${LAST_DAY} by default, and you can change the hours and days.`,
  },
  {
    q: "Should I send in my time zone or theirs?",
    a: "Theirs, where you can. An invitation that arrives at 3am their time sits under everything that arrives after it. Nora paces each account in the rep's own time zone and working hours, so if most of your prospects are elsewhere, set the account's sending hours to overlap with their working day, or run that region from a colleague who lives there.",
  },
];

const SOURCES = [
  { label: "Bardeen: best time to send a LinkedIn connection request", url: "https://bardeen.ai/answers/best-time-to-send-linkedin-connection-request" },
  { label: "Bardeen: best time to send LinkedIn messages (business hours versus evenings and weekends)", url: "https://bardeen.ai/answers/best-time-to-send-linkedin-messages" },
  { label: "PhantomBuster: best time to send a LinkedIn request", url: "https://phantombuster.com/blog/social-selling/best-time-to-send-linkedin-request/" },
  { label: "Fuzzy: best time to send LinkedIn messages (the crowded-window argument)", url: "https://getfuzzy.ai/blog/best-time-linkedin-messages" },
  { label: "Overloop: LinkedIn outreach benchmarks (summarising Belkins and Botdog data)", url: "https://overloop.com/blog/linkedin-outreach-benchmarks" },
  { label: "Expandi: LinkedIn outreach benchmarks 2026, acceptance by industry", url: "https://expandi.io/blog/linkedin-outreach-benchmarks-2026/" },
  { label: "LinkedIn Help: Types of restrictions for sending invitations", url: "https://www.linkedin.com/help/linkedin/answer/a551012" },
];

const STUDIES = [
  { label: "Bardeen", values: ["Tuesday to Thursday", "10:00 to 11:00 and 17:00 to 18:00, their time", "\"Recent studies\", not named"] },
  { label: "PhantomBuster", values: ["Tuesday to Thursday; avoid Monday and Friday", "08:30 to 10:30 and 14:00 to 16:00, their time", "No figures published"] },
  { label: "Fuzzy", values: ["Not the popular slot", "A less crowded time than Tuesday 10:00", "Argument, not a dataset"] },
];

const PACE_ROWS = [
  {
    label: `First day of sending, a full ${END_HOUR - START_HOUR}-hour day`,
    values: [PUBLIC_LIMITS.invitesPerDayStart, `${FIRST_DAY_PACE.low} to ${FIRST_DAY_PACE.high} minutes`],
  },
  {
    label: `Fully warmed account, a full ${END_HOUR - START_HOUR}-hour day`,
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
      lede={`The best time to send LinkedIn connection requests is spread across your prospects' working day, Monday to Friday, not one slot that every request lands in. The day-of-week studies agree on little beyond "mid-week, working hours", and the differences they report are small; how evenly you pace a day's invitations matters more to the account than which hour you pick.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">The short answer on the best time to send LinkedIn connection requests</h2>
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
          minutes, not ten in a row at 9:00.
        </li>
        <li>
          <strong>Skip weekends and nights.</strong> Nobody is reading, and activity at hours nobody works is
          the easiest pattern to tell apart from a person.
        </li>
      </ul>

      <h2 id="studies">What the day-of-week studies say, and why they disagree</h2>
      <p>
        As of October 2026, the pages that rank for this question are mostly short answers from tools
        that send LinkedIn invitations. Their recommendations overlap on mid-week and disagree on the hours.
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
          at 6.40%. By contrast, Expandi&apos;s 2026 benchmarks report acceptance ranging from 19.9% in one
          industry to 36.5% in another. Who you write to moves the number far more than when.
        </li>
        <li>
          <strong>The advice changes the result.</strong> Fuzzy makes the fair point that when every sales
          team sends at 10:00 on Tuesday, that becomes the most crowded hour in a prospect&apos;s inbox.
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
        The trouble with a single best slot is what it does to the sending pattern. If 10:00 on Tuesday is
        the best time, the obvious move is to send everything at 10:00 on Tuesday. A whole day&apos;s
        invitations in a few minutes is exactly what LinkedIn says it watches for: its help center lists
        sending many invitations in a short time among the reasons an account is restricted from sending
        more.
      </p>
      <p>
        We learned this from the first live account that sent through Nora. Before Nora spread a day&apos;s allowance, it placed the day&apos;s
        invitations one after another, {FLOOR_LOW} to {FLOOR_HIGH} minutes apart. On the first day a live
        account sent through it, seven connection requests went out in under half an hour, from an account
        whose first ever automated action was the first of them. LinkedIn throttled invitations from that
        account and was still refusing them days later. The daily number was modest; the shape was a burst.
      </p>
      <Callout tone="warning">
        <p>
          <strong>A daily cap is not pacing.</strong> At {FLOOR_LOW} to {FLOOR_HIGH} minutes apart,{" "}
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
        caption={`Gap between invitations under Nora's pacing, working hours ${pad(START_HOUR)} to ${pad(END_HOUR)}`}
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
        closer than {FLOOR_LOW} minutes, with a random {FLOOR_LOW} to {FLOOR_HIGH} minutes as the ordinary
        gap. If that means part of today&apos;s allowance is not spent, it is not spent. It does not roll over
        into tomorrow.
      </p>

      <h3 id="their-time-zone">Their time zone, not yours</h3>
      <p>
        &quot;9:00&quot; only means something in a time zone. If you are in London and your buyers are in New York,
        your morning is their middle of the night, and an invitation that arrives then sits under
        everything that arrives after it.
      </p>
      <p>
        An honest note on how Nora does this: it paces each account in the rep&apos;s own time zone and working
        hours, which default to {pad(START_HOUR)} to {pad(END_HOUR)}, {FIRST_DAY} to {LAST_DAY}. The day&apos;s
        counters also roll over at the rep&apos;s midnight, so a Pacific rep&apos;s allowance does not reset at five
        in the afternoon. If most of your prospects live elsewhere, change the account&apos;s sending hours to
        overlap their working day, or split the region onto a colleague&apos;s account in that time zone.
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

      <h2 id="weekends">Weekends, holidays and evenings</h2>
      <p>
        Leave them out. Bardeen reports that for messages, response rates outside business hours are about
        the same as inside them, so you lose little by waiting, and you gain an account whose activity
        stops when working people stop. Invitations queued over a weekend should go out across Monday at
        the normal pace, not all at 9:00; Nora places held invitations with a fresh random gap each so the
        backlog does not drain in a row.
      </p>
      <p>
        Public holidays are the gap: Nora does not know your prospects&apos; holiday calendar. Before a holiday
        that matters to your market, such as the week between Christmas and New Year, pause the campaign
        from its page and resume it after.
      </p>
      <p>
        For the wider picture of what keeps an account safe, read{" "}
        <Link href="/guides/is-linkedin-automation-safe">whether LinkedIn automation is safe, and what reduces the risk</Link>.
        LinkedIn&apos;s user agreement prohibits automated activity, so no pacing can promise zero risk; it can
        only stop you sending the pattern LinkedIn names. To see how Nora runs the whole campaign around
        these rules, read <Link href="/how-it-works">how Nora works</Link>, or browse more{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>. Nora is free while we grow:{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
