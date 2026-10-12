import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";
import { LINKEDIN_LIMITS } from "@le/shared";
import { backOff, classifyProviderError, dailyInviteCap } from "@le/linkedin";

const PATH = "/guides/linkedin-account-restricted";

export const metadata: Metadata = articleMeta(PATH);

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/* The waits the sender really uses after LinkedIn's temporary-limit refusal. */
const THROTTLE = classifyProviderError("errors/cannot_resend_yet");
const FIRST_COOLDOWN_MS = THROTTLE.kind === "retry_later" ? THROTTLE.cooldownMs : 0;
const FIRST_COOLDOWN_H = Math.round(FIRST_COOLDOWN_MS / HOUR_MS);
const LONGEST_COOLDOWN_H = Math.round(backOff(FIRST_COOLDOWN_MS, Number.MAX_SAFE_INTEGER) / HOUR_MS);

/* The ramp the sender enforces, read at a few points rather than retyped. */
const REF = new Date("2026-01-01T12:00:00Z");
const capAfter = (days: number) => dailyInviteCap(new Date(REF.getTime() - days * DAY_MS), REF);
const CAP_DAY_7 = capAfter(7);
const CAP_DAY_14 = capAfter(14);

const FAQ = [
  {
    q: "How long does a LinkedIn restriction last?",
    a: "It depends on the kind. As of October 2026 LinkedIn's help center says most invitation restrictions lift automatically within a week: a first one after a few hours, several in one day after a few days, and one for too many outstanding invitations after up to a month. An automated-activity restriction ends at the time printed in the notice once the software is off. An identity check lasts until you complete it.",
  },
  {
    q: "Can a restricted LinkedIn account be recovered?",
    a: "Usually, yes. Invitation restrictions lift by themselves, automated-activity restrictions end on the date in the notice once the tool is disabled, and identity restrictions end when you verify. Accounts that stay restricted are mostly ones that kept sending into a restriction or were restricted repeatedly. If you think a restriction is a mistake, use the review route in the notice itself.",
  },
  {
    q: "Should I create a new LinkedIn account if mine is restricted?",
    a: "No. A second account does not lift the restriction on the first. It starts with no connections and no history, so it is the least trusted account you could send from, and running two profiles for one person adds a new problem on top of the one you have. Fix the cause, wait out the restriction and come back slowly on the account you already own.",
  },
  {
    q: "Will withdrawing pending invitations lift the restriction?",
    a: "No. LinkedIn's help center says withdrawing pending invitations does not remove an active restriction, and every withdrawal stops you inviting that person again for up to three weeks. Clearing very old invitations is still worth doing once you are sending again, a few at a time, because a large pile of ignored invitations is one of the reasons LinkedIn gives for restricting accounts.",
  },
  {
    q: "How do I get out of LinkedIn jail?",
    a: "\"LinkedIn jail\" is slang, usually for an invitation restriction. You get out by waiting: LinkedIn says most lift within a week and support will not remove one on request. Stop every tool, do not test the restriction by sending, and use the time to fix the list or the note. When it lifts, restart at the bottom of a warm-up ramp, not where you stopped.",
  },
  {
    q: "Can LinkedIn tell I used automation?",
    a: "LinkedIn names suspected automation as one of the reasons it restricts invitations, and its help center says it does not allow software that automates activity on the site. It does not publish how it detects it. What it can always see is the pattern: how many invitations, how fast, how many are ignored or reported. Those are the things you control.",
  },
];

const SOURCES = [
  { label: "LinkedIn Help: Invitation restrictions (types, durations, withdrawing)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "LinkedIn Help: Invitation limit reached", url: "https://www.linkedin.com/help/billing/answer/a550555" },
  { label: "LinkedIn Help: Automated activity on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/90586" },
  { label: "LinkedIn Help: Verify your identity to recover account access", url: "https://www.linkedin.com/help/learning/answer/a1342692" },
  { label: "Waalaxy: LinkedIn account restricted, why and solutions (studied for this page)", url: "https://blog.waalaxy.com/en/restricted-linkedin-method/" },
  { label: "Neal Schaffer: LinkedIn account restricted (studied for this page)", url: "https://nealschaffer.com/linkedin-account-restricted/" },
  { label: "Snov.io: LinkedIn account restricted (studied for this page)", url: "https://snov.io/blog/linkedin-account-restricted/" },
];

const DURATIONS = [
  {
    label: "First invitation restriction",
    values: ["A few hours", "LinkedIn help center", "Wait, then send far fewer invitations than before."],
  },
  {
    label: "Several invitation restrictions in one day",
    values: ["A few days", "LinkedIn help center", "Treat it as a warning about the pattern, not bad luck."],
  },
  {
    label: "Too many outstanding invitations",
    values: ["Up to a month", "LinkedIn help center", "The longest one. The pending pile is the cause."],
  },
  {
    label: "Invitation restriction, in general",
    values: ["Most lift within a week", "LinkedIn help center", "Support will not lift it on request."],
  },
  {
    label: "Automated activity",
    values: ["Until the time in the notice", "LinkedIn help center", "Re-enabled automatically once the software is disabled."],
  },
  {
    label: "Identity verification",
    values: ["Until you verify", "LinkedIn help center", "No published review time. Third-party estimates vary and are not reliable."],
  },
  {
    label: "Indefinite or permanent",
    values: ["Not published", "No official duration", "Nobody outside LinkedIn knows the criteria."],
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn account restricted: what to do in the first 48 hours"
      lede="If your LinkedIn account is restricted, stop every tool that touches it, read the exact notice to see which restriction you have, and take only the step that notice asks for: wait out an invitation restriction, disable the software if automation is named, verify your identity if asked. Most restrictions are temporary; the ones that drag on are usually the ones somebody kept sending into."
      faq={FAQ}
      sources={SOURCES}
    >
      <p>In short:</p>
      <ul>
        <li>
          <strong>Invitation restriction</strong> (the common one): the rest of the account works. Wait. LinkedIn says most lift
          within a week and support cannot remove them.
        </li>
        <li>
          <strong>Automated activity</strong>: disable the tool. The account comes back at the time printed in the notice.
        </li>
        <li>
          <strong>Identity check</strong>: complete it from the notice inside LinkedIn, nowhere else.
        </li>
        <li>
          <strong>Afterwards</strong>: restart at around {PUBLIC_LIMITS.invitesPerDayStart} invitations a day, not where you
          stopped.
        </li>
      </ul>

      <Callout tone="safety">
        <p>
          <strong>The one rule for the first hour:</strong> nothing sends. Pause every campaign in every tool connected to the
          account, including the ones you think are idle. An invitation sent into a restriction is one more request logged against
          an account LinkedIn has already decided to slow down.
        </p>
      </Callout>

      <h2 id="which-restriction">Which restriction do you have? Match the exact notice</h2>
      <p>
        &quot;Restricted&quot; covers several different things with different fixes, and most guides blend them together. The
        wording LinkedIn shows you, or the error you get when you try to invite someone, tells you which one you are dealing
        with. Screenshot it before you do anything else.
      </p>

      <h3 id="weekly-limit-notice">&quot;You&apos;ve reached the weekly invitation limit&quot;</h3>
      <p>
        This is not a restriction on the account. It is a ceiling on invitations for the week, and everything else (messages,
        posts, replies, accepting invitations) keeps working. LinkedIn does not publish the number. Our{" "}
        <Link href="/guides/linkedin-weekly-invitation-limit">guide to the weekly invitation limit</Link> covers when it resets and
        how to plan a week so you do not meet it. The fix is simply to stop inviting until it clears.
      </p>

      <h3 id="temporarily-restricted">&quot;Your account has been temporarily restricted&quot; (unusual activity)</h3>
      <p>
        This one has two common shapes. If you can still use LinkedIn but invitations fail, it is an <strong>invitation
        restriction</strong>. LinkedIn&apos;s help center gives three reasons for those, as of October 2026: many invitations sent in
        a short time, many invitations ignored, left pending or marked as spam, and suspected use of automation tools. LinkedIn
        says it cannot share more about the specific reason.
      </p>
      <p>
        If the notice names automation, third-party software or a browser extension, it is an <strong>automated-activity
        restriction</strong>. LinkedIn&apos;s instruction is to review the software, disable it, and wait: the account is
        re-enabled automatically at the time given in the notice.
      </p>

      <h3 id="id-verification">ID verification requested</h3>
      <p>
        You are asked to prove who you are before you can sign in. LinkedIn&apos;s help center says this runs through an identity
        verification partner and usually means a photo of a government-issued ID, sometimes with a selfie to match it. The same
        page lists other ways to recover the account if you would rather not submit ID. Start it from the notice in the LinkedIn
        app or site, never from a link that arrives by email or message: a fake &quot;verify your account&quot; page is a common
        way to steal a login.
      </p>

      <h3 id="permanently-restricted">Permanently restricted</h3>
      <p>
        A notice that gives no end date and offers no verification step. It is rare compared with the others, and LinkedIn does
        not publish what leads to it. It has its own section{" "}
        <a href="#permanent">further down</a>.
      </p>

      <h2 id="first-48-hours">The first 48 hours</h2>
      <p>
        The instinct is to do something fast: write to support, log in from another device, try one more invitation. Most of
        that makes things worse. Here is what helps, in order.
      </p>

      <h3 id="stop-everything">Stop every tool and every scheduled action</h3>
      <ol>
        <li>
          <strong>Pause everything.</strong> Every campaign, every scheduler, every browser extension that can act on LinkedIn.
          Jobs placed earlier in the day may still be waiting to fire, so pause the campaign, not just the next step. If you are
          not sure a tool still has access, disconnect it.
        </li>
        <li>
          <strong>Write down what was running.</strong> Invitations sent today and this week, how many are still pending, your
          acceptance rate over the last few weeks, and the date the account first started sending through a tool. Those numbers
          are how you find the cause.
        </li>
        <li>
          <strong>Do not test the restriction.</strong> Sending one invitation every hour to see whether it has lifted adds a
          refused attempt each time.
        </li>
      </ol>

      <h3 id="do-not-withdraw">Do not withdraw invitations in bulk</h3>
      <p>
        Mass-withdrawing pending invitations is the most common panic move, and it does not work. LinkedIn&apos;s help center says
        withdrawing does not remove an active restriction, and each withdrawal stops you inviting that person again for up to
        three weeks. The pile still matters, because LinkedIn names ignored and pending invitations as a reason for restrictions,
        so clear the oldest ones later, a few at a time, once you are sending again. Our guide to{" "}
        <Link href="/guides/withdraw-pending-linkedin-invitations">withdrawing pending LinkedIn invitations</Link> has a simple
        housekeeping rule.
      </p>

      <h3 id="what-to-send">What to send LinkedIn</h3>
      <ul>
        <li>
          <strong>Invitation restriction:</strong> nothing. LinkedIn says it will not remove invitation restrictions on request.
          A ticket does not shorten the wait.
        </li>
        <li>
          <strong>Automated activity:</strong> nothing beyond disabling the software. The notice already carries the date.
        </li>
        <li>
          <strong>Identity verification:</strong> the verification itself, from the notice.
        </li>
        <li>
          <strong>A restriction you believe is wrong:</strong> use the review or appeal link in the notice. Keep it short and
          accurate. If a tool was connected, say you have disconnected it. An appeal that is later contradicted by what LinkedIn
          already logged does not help you.
        </li>
      </ul>

      <h2 id="how-long">How long each restriction lasts (and what nobody knows)</h2>
      <p>
        Most articles quote durations with no source. These are the only ones LinkedIn publishes, as of October 2026. Anything
        more precise, such as &quot;24 to 48 hours&quot; for ID checks, is somebody&apos;s experience rather than a rule.
      </p>
      <CompareTable
        caption="How long LinkedIn restrictions last, from LinkedIn's help center, as of October 2026"
        columns={["How long", "Where it comes from", "What it means for you"]}
        rows={DURATIONS}
      />
      <p>
        What nobody outside LinkedIn knows: the thresholds. LinkedIn does not say how many invitations is &quot;many&quot;, how many
        ignored invitations is too many, or how a restriction feeds into the next one. Treat any tool or article that claims to
        know the exact line with suspicion, including this one.
      </p>

      <h2 id="linkedin-jail">&quot;LinkedIn jail&quot;: what people mean by it</h2>
      <p>
        &quot;LinkedIn jail&quot; is slang, not a LinkedIn term. People mostly use it for the invitation restriction: you can read and
        post, but you cannot grow your network for a while. Some use it for any restriction at all, which is why advice written
        under that phrase is often confused. If someone tells you how to &quot;get out of LinkedIn jail&quot;, check first which of the
        notices above they mean. For the invitation restriction there is no way out except time.
      </p>

      <h2 id="why">Why a LinkedIn account gets restricted: automation patterns that lead here</h2>
      <p>
        Hold the notes from your first hour against LinkedIn&apos;s three reasons. In our experience running a sender, the cause is
        usually one of these:
      </p>
      <ul>
        <li>
          <strong>A burst inside a daily cap.</strong> A cap says how many, not when. The first account Nora ever ran sent seven
          invitations in 27 minutes on its first day of sending, well inside its daily limit, and LinkedIn was still refusing its
          invitations five days later. Nora now spreads a day&apos;s allowance across the working day. The story is in{" "}
          <Link href="/guides/is-linkedin-automation-safe">is LinkedIn automation safe?</Link>
        </li>
        <li>
          <strong>Full volume from day one.</strong> An account that sent nothing for months and then 30 invitations a day looks
          nothing like the person who owns it. A ramp exists for this.
        </li>
        <li>
          <strong>Low acceptance.</strong> If fewer than {PUBLIC_LIMITS.healthyAcceptance}% of invitations are accepted, the list is
          reaching people who see no reason to connect. That is ignored, pending and reported invitations, which is exactly what
          LinkedIn names.
        </li>
        <li>
          <strong>A big pending pile.</strong> Months of unanswered invitations. LinkedIn&apos;s longest invitation restriction, up to
          a month, is for exactly this.
        </li>
        <li>
          <strong>Template notes and links.</strong> The same sentence to everyone, or a URL in a connection note, is what gets
          ignored or reported.
        </li>
      </ul>
      <p>
        Compare your numbers with the{" "}
        <Link href="/linkedin-automation-limits">daily and weekly limits we enforce, and why</Link>.
      </p>

      <h2 id="restart">Restarting safely</h2>
      <p>
        When the restriction lifts, do not resume where you stopped. Nothing about the account has changed except that it has now
        been restricted once, and the behaviour that caused it will cause it again.
      </p>

      <h3 id="starting-cap">Back to the starting cap</h3>
      <p>
        Go back to the bottom of a warm-up ramp: around {PUBLIC_LIMITS.invitesPerDayStart} invitations a day, spread across your
        working hours, and climb from there. That is the same number Nora gives an account on the first day it ever sends. Our{" "}
        <Link href="/guides/linkedin-warm-up-schedule">week-by-week LinkedIn warm-up schedule</Link> has the full ramp, and the{" "}
        <Link href="/tools/linkedin-limit-calculator">LinkedIn limit calculator</Link> works out a safe number for any day.
      </p>

      <h3 id="two-week-plan">A two-week return plan</h3>
      <ol>
        <li>
          <strong>Days 1 to 3 after it lifts: no invitations.</strong> Answer messages, accept invitations people sent you, post
          if you normally post. Fix the cause: tighten the list, rewrite the note, delete any link from it.
        </li>
        <li>
          <strong>Days 4 to 7: {PUBLIC_LIMITS.invitesPerDayStart} a day.</strong> Spread across the working day, a few minutes to
          an hour apart, never in one sitting. Only send to people with an obvious reason to accept.
        </li>
        <li>
          <strong>Week 2: hold, then climb slowly.</strong> If acceptance stays at or above {PUBLIC_LIMITS.healthyAcceptance}%,
          move towards {CAP_DAY_7} a day, which is where Nora&apos;s ramp sits after one week of sending. If acceptance drops, stay at{" "}
          {PUBLIC_LIMITS.invitesPerDayStart}.
        </li>
        <li>
          <strong>From week 3: follow the ramp.</strong> About {CAP_DAY_14} a day by the end of the second week of sending, and never
          more than {PUBLIC_LIMITS.invitesPerWeek} a week in total.
        </li>
        <li>
          <strong>Every week: clear the oldest pending invitations</strong>, a handful at a time, and check acceptance.
        </li>
      </ol>
      <Callout tone="info">
        <p>
          <strong>How Nora handles a restart.</strong> Nora&apos;s ramp is measured from the account&apos;s first send, and a
          restriction does not reset it, because LinkedIn does not tell anyone what the restriction changed. To come back slower
          than the account&apos;s current allowance, lower each campaign&apos;s daily invitation limit before it resumes. A
          campaign&apos;s limit can always go below the ramp; nothing can go above it.
        </p>
      </Callout>

      <h2 id="permanent">Permanent restriction: appeal, and why a second account makes it worse</h2>
      <p>
        If the notice offers no end date and no verification, the only route is the review or appeal link inside it. Be factual
        and brief, and expect to wait: LinkedIn does not publish a review time. Third-party guides quote anything from days to
        weeks, which mostly tells you nobody knows.
      </p>
      <p>
        Do not open a second account while you wait. It does not lift the restriction on the first one, it starts with no network
        and no history, so it is the least trusted account you could send from, and a second profile for the same person is a
        new problem on top of the old one. If the restriction is ever lifted, you would then have two accounts to explain. The
        account you have, restarted slowly, is worth more than a new one restarted fast.
      </p>

      <h2 id="what-nora-does">What Nora does if a connected account is restricted</h2>
      <p>
        Nora assumes a restriction can happen to any account, so it is built to stop first and explain second.
      </p>
      <ul>
        <li>
          <strong>It notices on the send itself.</strong> Account health comes back with every action and is checked again every
          night. A warning or restriction pauses the account immediately, and a restriction or lost connection emails you rather
          than waiting for you to notice nothing is happening.
        </li>
        <li>
          <strong>It backs off, then further.</strong> If LinkedIn refuses invitations with a temporary limit, Nora stops inviting
          from that account for {FIRST_COOLDOWN_H} hours, and doubles the wait on each repeat, up to {LONGEST_COOLDOWN_H} hours.
          It never knocks every few minutes.
        </li>
        <li>
          <strong>Nobody is lost.</strong> People waiting for an invitation stay on the campaign, and are invited once the
          account is sending again.
        </li>
        <li>
          <strong>It clears old invitations.</strong> Invitations still pending after {LINKEDIN_LIMITS.withdrawAfterDays} days are
          withdrawn automatically, in small batches.
        </li>
      </ul>
      <p>
        No tool can promise an account is never restricted: LinkedIn&apos;s terms prohibit automation in the first place, and
        Nora is no exception. What a tool can do is keep the pattern far from the one that leads here.{" "}
        <Link href="/how-it-works">How Nora paces and approves outreach</Link> explains the rest, and it is free while we grow:{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>. More on limits and safety in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>
    </ArticleLayout>
  );
}
