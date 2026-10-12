import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";
import { DEFAULT_WORKING_HOURS, INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";

const PATH = "/guides/linkedin-weekly-invitation-limit";

export const metadata: Metadata = articleMeta(PATH);

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WORKING_DAYS = DEFAULT_WORKING_HOURS.days.length;

/*
 * A fully warmed account spending every allowance the moment it is available:
 * the daily cap each working day, clamped by what is left of the week. This is
 * the limiter's arithmetic, not a recommendation, and the page says so.
 */
const FULL_WEEK = (() => {
  let sent = 0;
  return DEFAULT_WORKING_HOURS.days.map((weekday) => {
    const today = Math.min(PUBLIC_LIMITS.invitesPerDayMax, PUBLIC_LIMITS.invitesPerWeek - sent);
    sent += today;
    return { day: DAY_NAMES[weekday] ?? String(weekday), today, sent };
  });
})();
const LAST_SENDING_DAY = [...FULL_WEEK].reverse().find((d) => d.today > 0)?.day ?? "";
const EVEN_DAILY = Math.floor(PUBLIC_LIMITS.invitesPerWeek / WORKING_DAYS);
const EVEN_REMAINDER = PUBLIC_LIMITS.invitesPerWeek - EVEN_DAILY * WORKING_DAYS;
const WEEKLY_ACCEPTED = Math.round((PUBLIC_LIMITS.invitesPerWeek * PUBLIC_LIMITS.healthyAcceptance) / 100);

/*
 * The worked example: a week front-loaded at the daily maximum, read two ways.
 * Monday and Tuesday at the daily cap, the rest of the week on Wednesday.
 */
const EX_MON = PUBLIC_LIMITS.invitesPerDayMax;
const EX_TUE = PUBLIC_LIMITS.invitesPerDayMax;
const EX_WED = Math.max(0, Math.min(PUBLIC_LIMITS.invitesPerDayMax, PUBLIC_LIMITS.invitesPerWeek - EX_MON - EX_TUE));

const FAQ = [
  {
    q: "How many connection requests can I send per week on LinkedIn?",
    a: `LinkedIn does not publish a number. As of October 2026 third-party guides mostly report a ceiling of about 100 a week, with some reporting more for long-established or Sales Navigator accounts and older posts quoting 200. Nora holds every account to ${PUBLIC_LIMITS.invitesPerWeek} a week across all its campaigns, and suggests spreading them over the working week rather than front-loading Monday.`,
  },
  {
    q: "When does the LinkedIn weekly limit reset?",
    a: "LinkedIn does not say. Most third-party guides describe a rolling seven-day window, where each invitation stops counting seven days after it was sent, so room comes back gradually rather than on a fixed day. Others describe a reset seven days after the first invitation of a cycle. Neither is confirmed by LinkedIn. Plan as if it rolls, because that is the cautious reading.",
  },
  {
    q: "Is the weekly invitation limit a ban?",
    a: "No. Reaching it stops new connection requests for a while; messages, posts, replies and accepting other people's invitations keep working. LinkedIn's help center says an invitation restriction typically lasts about a week and most lift automatically. It is a signal about your pattern, though, and hitting it week after week is how longer restrictions start.",
  },
  {
    q: "Does withdrawing invitations restore my weekly quota?",
    a: "No. LinkedIn's help center says withdrawing pending invitations will not remove an invitation restriction, and after withdrawing you cannot invite the same person again for up to three weeks. Withdrawing very old invitations is still worth doing for the account's health, because invitations left pending are one of the reasons LinkedIn gives for restrictions.",
  },
  {
    q: "Does a higher SSI let you send more invitations?",
    a: "Not as far as anyone can show. LinkedIn's Social Selling Index measures how you use the platform, and LinkedIn has never said it changes the invitation limit. Vendor guides that tie a score of 70 or more to a higher allowance cite no source. A strong acceptance rate plausibly matters more, because ignored invitations are a trigger LinkedIn does name.",
  },
];

const SOURCES = [
  { label: "LinkedIn Help: Invitation restrictions (reasons, durations, withdrawing)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "LinkedIn Help: Invitation limit reached", url: "https://www.linkedin.com/help/billing/answer/a550555" },
  { label: "ContentIn glossary: What is the LinkedIn weekly invitation limit? (rolling window)", url: "https://contentin.io/glossary/weekly-invitation-limit/" },
  { label: "Aomni: LinkedIn weekly invitation limit (studied for this page)", url: "https://www.aomni.com/blog/linkedin-weekly-invitation-limit" },
  { label: "Bardeen: LinkedIn weekly invitation limit (studied for this page)", url: "https://www.bardeen.ai/answers/linkedin-weekly-invitation-limit" },
  { label: "Snov.io: how to bypass the LinkedIn weekly invitation limit, 2026 (observed ceilings, contact sync)", url: "https://snov.io/blog/linkedin-invitation-limit/" },
  { label: "Waalaxy: weekly limit on invitations sent on LinkedIn (bypass no longer works)", url: "https://blog.waalaxy.com/en/bypass-linkedin-limit/" },
  { label: "Evaboot: email invitations by CSV upload no longer available (German)", url: "https://evaboot.com/de/blog/umgehung-des-woechentlichen-einladungslimits" },
  { label: "LinkedAPI: LinkedIn connection limit 2026 (paid plans and SSI claims)", url: "https://linkedapi.io/guides/linkedin-connection-limit-2026" },
];

const PUBLISHED = [
  {
    label: "Why invitations get restricted",
    values: ["Published", "Many invitations in a short time; many ignored, left pending or marked as spam; suspected automation."],
  },
  {
    label: "How long a restriction lasts",
    values: [
      "Published, roughly",
      "Typically about a week. A first one often a few hours, several in one day a few days, too many outstanding invitations up to a month.",
    ],
  },
  { label: "Whether support can lift one", values: ["Published", "No. LinkedIn will not remove an invitation restriction on request."] },
  { label: "Re-inviting after a withdrawal", values: ["Published", "Not possible for up to three weeks."] },
  { label: "A weekly number", values: ["Not published", "Third-party reports cluster around 100 a week and range higher."] },
  { label: "When the week resets", values: ["Not published", "Most reports describe a rolling seven-day window. Unconfirmed."] },
  { label: "Whether paid plans or SSI get more", values: ["Not published", "Reports conflict, and none cite LinkedIn."] },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn weekly invitation limit in 2026, explained"
      lede={`The LinkedIn weekly invitation limit is not published: LinkedIn confirms it restricts invitations sent too fast or too often ignored, and third-party reports put the practical ceiling at about 100 a week, freeing up on a rolling seven days rather than on Monday. Nora holds every account to ${PUBLIC_LIMITS.invitesPerWeek} a week across all its campaigns, because the safe move is to stay under the line rather than find it.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <p>In short:</p>
      <ul>
        <li>
          <strong>The number:</strong> unpublished. About 100 a week is the common report as of October 2026.
        </li>
        <li>
          <strong>The reset:</strong> unpublished. Probably rolling: each invitation stops counting seven days after it was sent.
        </li>
        <li>
          <strong>When you hit it:</strong> stop inviting, keep messaging. Withdrawing does not give the week back.
        </li>
        <li>
          <strong>Bypass tricks:</strong> mostly gone, and the ones left move the problem rather than solve it.
        </li>
        <li>
          <strong>Paid plans and SSI:</strong> no evidence from LinkedIn that either raises it.
        </li>
      </ul>

      <h2 id="what-linkedin-says">What the LinkedIn weekly invitation limit is, and what LinkedIn actually says</h2>
      <p>
        The weekly invitation limit is the point at which LinkedIn stops accepting new connection requests from your account for
        a while. You find out from a banner that says you have reached the weekly invitation limit, or from invitations that
        quietly fail in a tool. As of October 2026, LinkedIn&apos;s help center is clear about causes and durations and silent about
        numbers.
      </p>
      <CompareTable
        caption="What LinkedIn's help center says about invitation limits, as of October 2026"
        columns={["Status", "What is known"]}
        rows={PUBLISHED}
      />
      <p>
        So &quot;100 a week&quot; is not a LinkedIn rule. It is what people running outreach have observed, and LinkedIn&apos;s own triggers
        suggest why it varies: an account whose invitations are mostly accepted gives a different picture from one whose
        invitations are mostly ignored, at the same volume. Treat any number, including ours, as a ceiling to stay under rather
        than a quota to fill.
      </p>

      <h2 id="reset">When it resets: rolling seven days or a fixed day?</h2>
      <p>
        LinkedIn does not say. Most third-party guides describe a <strong>rolling seven-day window</strong>: an invitation sent
        on Tuesday at 10:00 stops counting the following Tuesday at about 10:00, so room comes back a few invitations at a time.
        A minority describe a reset seven days after the first invitation of a cycle. Almost nobody still argues for a fixed
        Monday reset. If you plan as if the window rolls, you are safe under every reading.
      </p>

      <h3 id="worked-example">A worked example</h3>
      <p>
        Say a fully warmed account sends {EX_MON} invitations on Monday, {EX_TUE} on Tuesday and {EX_WED} on Wednesday:{" "}
        {PUBLIC_LIMITS.invitesPerWeek} in three days.
      </p>
      <ul>
        <li>
          <strong>If LinkedIn&apos;s window rolls,</strong> nothing frees up until the next Monday, and then only Monday&apos;s{" "}
          {EX_MON}, hour by hour as each one turns seven days old. Tuesday frees another {EX_TUE}. Send the same way again and
          you are back at the edge by Wednesday, every week, with no slack.
        </li>
        <li>
          <strong>If it reset on Monday,</strong> the whole {PUBLIC_LIMITS.invitesPerWeek} would come back at once, which is the
          reading that tempts people to send it all again on Monday morning. That is the burst LinkedIn names first.
        </li>
        <li>
          <strong>Spread evenly instead,</strong> at {EVEN_DAILY} a day across {WORKING_DAYS} working days, any seven days in a row
          hold at most {PUBLIC_LIMITS.invitesPerWeek}, whichever way LinkedIn counts.
        </li>
      </ul>
      <Callout tone="info">
        <p>
          <strong>How Nora counts.</strong> Nora&apos;s own ceiling is a calendar week starting Monday in your time zone, compared
          by week number so an idle weekend cannot skip a reset. Because LinkedIn&apos;s window probably rolls, a front-loaded week
          followed by another can put more than {PUBLIC_LIMITS.invitesPerWeek} into the seven days that straddle them. Keeping an
          account&apos;s campaigns to {EVEN_DAILY} a day between them closes that gap.
        </p>
      </Callout>

      <h2 id="reached-it">&quot;You&apos;ve reached the weekly invitation limit&quot;: what to do now</h2>
      <ol>
        <li>
          <strong>Stop inviting from every tool.</strong> Each further attempt is a refused request on an account LinkedIn is
          already slowing down.
        </li>
        <li>
          <strong>Keep everything else going.</strong> Messages to people who accepted, replies, posts and accepting invitations
          all still work. Follow-ups are messages, not invitations; Nora caps them separately at {PUBLIC_LIMITS.messagesPerDay} a
          day.
        </li>
        <li>
          <strong>Do not mass-withdraw.</strong> LinkedIn says withdrawing does not lift the restriction, and it locks you out of
          re-inviting those people for up to three weeks. Our guide to{" "}
          <Link href="/guides/withdraw-pending-linkedin-invitations">withdrawing pending LinkedIn invitations</Link> covers when it
          does make sense.
        </li>
        <li>
          <strong>Check acceptance.</strong> If fewer than {PUBLIC_LIMITS.healthyAcceptance}% of recent invitations were accepted,
          the list is the problem, not the week.
        </li>
        <li>
          <strong>Come back below the old pace.</strong> When it lifts, send less than the week that caused it, spread evenly.
        </li>
      </ol>
      <p>
        If what you see is a restriction notice rather than the weekly banner, our{" "}
        <Link href="/guides/linkedin-account-restricted">plan for a restricted LinkedIn account</Link> has the first 48 hours.
      </p>

      <h2 id="bypass">Why bypass tricks are a bad trade</h2>
      <p>
        Search results for this topic lead with ways around the limit. As of October 2026 most of the tricks have been closed,
        and some vendors that used to sell them now say so. The deeper problem is that the triggers LinkedIn names are about
        behaviour (how many invitations, how fast, how they are received), so a workaround that pushes more invitations through
        changes none of that. It moves the restriction later, onto an account that now has more ignored invitations behind it.
      </p>

      <h3 id="email-invitations">Email-address invitations</h3>
      <p>
        The classic trick was inviting people through their email address, by upload or contact sync, on the theory that those
        did not count. Vendor guides now report that inviting by CSV upload is no longer available, and the remaining
        contact-sync route depends on you already having the person&apos;s address. If you have their email, you have a better
        channel than a connection request anyway.
      </p>

      <h3 id="events-groups">Event and group invitations</h3>
      <p>
        Messaging fellow group members or event attendees is often cited as not counting toward the limit. Even where that
        holds, it is a stranger receiving an unexpected message, which is the reaction LinkedIn&apos;s triggers are built around.
        Used for people you genuinely share the group or event with, it is ordinary networking. Used as a volume channel, it is
        the same pattern through a side door.
      </p>

      <h3 id="inmail">Swapping invitations for InMail</h3>
      <p>
        InMail does not use the invitation allowance, and on a paid plan it is a legitimate channel. It is also metered by
        credits, lands in a separate tab many people rarely open, and builds no connection you can follow up with later. Use it
        for a handful of high-value people, not as a way to keep the week&apos;s volume up.
      </p>

      <h2 id="paid-plans-ssi">Does Sales Navigator, Premium or a high SSI raise it?</h2>
      <p>
        LinkedIn does not publish a different number for any plan, and the vendor reports disagree. Some say Premium and Sales
        Navigator change nothing about invitations and only improve targeting. Others report 150 to 250 a week for Sales
        Navigator accounts with a strong Social Selling Index. None cite LinkedIn.
      </p>
      <p>
        The SSI version is the most repeated and the least supported. SSI is LinkedIn&apos;s score for how you use the platform; we
        found no LinkedIn statement linking it to the invitation limit. The likelier explanation for the anecdotes is that people
        with high scores also tend to have high acceptance rates, and acceptance is a factor LinkedIn does name. Nora applies the
        same weekly ceiling to every account, paid or not. Where a paid plan does matter is search: Sales Navigator filters find
        better-fit people, and better-fit people accept.
      </p>

      <h2 id="planning">Planning a week around {PUBLIC_LIMITS.invitesPerWeek} invitations</h2>
      <p>
        {PUBLIC_LIMITS.invitesPerWeek} a week sounds small until you do the sums. At an acceptance rate of {PUBLIC_LIMITS.healthyAcceptance}%, the
        level below which Nora flags an account, that is about {WEEKLY_ACCEPTED} new connections a week, every one of them
        someone who chose to connect. The constraint is not volume; it is whether each invitation goes to the right person.
      </p>

      <h3 id="five-days">Spread over five working days</h3>
      <ul>
        <li>
          <strong>{EVEN_DAILY} a day, Monday to Friday</strong>
          {EVEN_REMAINDER > 0 ? `, with the remaining ${EVEN_REMAINDER} wherever they fit` : ""}. Spread through the working day,
          minutes to an hour apart, never in one sitting.
        </li>
        <li>
          <strong>Best-fit people first.</strong> A ranked list plus a hard ceiling means you reach the top of it, not the bottom.
        </li>
        <li>
          <strong>Write to the person.</strong> A note that mentions something real about them is the difference between accepted
          and ignored. Our{" "}
          <Link href="/guides/linkedin-connection-request-templates">connection request templates under {INVITE_NOTE_MAX_CHARS} characters</Link> show
          what that looks like.
        </li>
        <li>
          <strong>Count everything.</strong> Invitations sent by hand, from your phone or from a second tool draw on the same
          week. A tool only knows what it sent itself, so after a conference, lower your campaigns&apos; daily limits by roughly the
          number you sent by hand, and never run two automation tools on one account.
        </li>
        <li>
          <strong>Need more reach? Add people, not volume.</strong> A colleague with their own account has their own week.
        </li>
      </ul>

      <h3 id="week-binds">Why the week binds before the day</h3>
      <p>
        Most advice is phrased per day, and that is where people get caught. A fully warmed account in Nora may send up to{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} invitations on one day. Multiply by {WORKING_DAYS} working days and you get far more than{" "}
        {PUBLIC_LIMITS.invitesPerWeek}. The week runs out first.
      </p>
      <CompareTable
        caption={`A fully warmed account spending each day's allowance as soon as it can (daily cap ${PUBLIC_LIMITS.invitesPerDayMax}, weekly cap ${PUBLIC_LIMITS.invitesPerWeek})`}
        columns={["Invitations that day", "Total this week"]}
        rows={FULL_WEEK.map((d) => ({ label: d.day, values: [d.today, d.sent] }))}
      />
      <p>
        On those numbers the week is spent by {LAST_SENDING_DAY}. That is the limiter&apos;s arithmetic, not a plan to aim for. Every
        Nora campaign has its own daily limit you can set to {EVEN_DAILY} or lower, and the weekly ceiling is shared by every
        campaign on the account, so two campaigns at {EVEN_DAILY} a day do not get twice the week. A new account starts lower
        still, at {PUBLIC_LIMITS.invitesPerDayStart} a day, and reaches the full daily allowance after{" "}
        {PUBLIC_LIMITS.warmupWeeks} weeks of sending; the{" "}
        <Link href="/guides/linkedin-warm-up-schedule">week-by-week warm-up schedule</Link> shows where the weekly ceiling starts
        to bind. Invitations still pending after {LINKEDIN_LIMITS.withdrawAfterDays} days are withdrawn automatically, in small
        batches.
      </p>
      <p>
        To see what your own account can send today and this week, use the{" "}
        <Link href="/tools/linkedin-limit-calculator">LinkedIn connection limit calculator</Link>, and the{" "}
        <Link href="/linkedin-automation-limits">full table of LinkedIn limits Nora enforces</Link> shows how the daily, weekly and
        message caps fit together. <Link href="/how-it-works">How Nora works</Link> covers the rest; it is free while we grow:{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>. More in the <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>
    </ArticleLayout>
  );
}
