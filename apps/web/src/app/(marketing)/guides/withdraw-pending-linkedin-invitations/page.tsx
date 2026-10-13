import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { Gb1Summary } from "@/components/seo/gb1-visuals";
import { LINKEDIN_LIMITS } from "@le/shared";

const PATH = "/guides/withdraw-pending-linkedin-invitations";

export const metadata: Metadata = articleMeta(PATH);

const WITHDRAW_DAYS = LINKEDIN_LIMITS.withdrawAfterDays;
const SENT_URL = "https://www.linkedin.com/mynetwork/invitation-manager/sent/";
const LI_WITHDRAW = "https://www.linkedin.com/help/linkedin/answer/a568295";
const LI_PROHIBITED = "https://www.linkedin.com/help/linkedin/answer/a1341387";

const FAQ = [
  {
    q: "Should I withdraw old LinkedIn invitations?",
    a: `Yes, on a schedule. LinkedIn names invitations left pending as one reason it restricts accounts, and too many outstanding invitations as the reason for its longest invitation restriction, up to a month. Withdrawing anything unanswered after ${WITHDRAW_DAYS} days keeps that pile small. Withdraw oldest first, and do not re-invite the same people.`,
  },
  {
    q: "Does withdrawing a LinkedIn request notify the person?",
    a: "No. LinkedIn’s help center says the recipient is not told when you withdraw an invitation. The invitation simply disappears from their list. If they had already seen it and chosen not to answer, nothing changes for them, which is one reason withdrawing old invitations is low cost.",
  },
  {
    q: "How long until I can re-invite someone on LinkedIn?",
    a: "After you withdraw an invitation, LinkedIn says you cannot invite the same person again for up to three weeks. An invitation that expires on its own, which LinkedIn’s FAQ puts at six months, can reportedly be re-sent straight away. Either way, a second invitation to someone who ignored the first rarely does better.",
  },
  {
    q: "How many pending invitations can you have on LinkedIn?",
    a: "LinkedIn does not publish a number. It says too many outstanding invitations can restrict an account for up to a month. Third-party guides quote different ceilings, and none cites LinkedIn; one vendor’s help center advises staying under 800. A safer target than any ceiling is a pile that never holds more than a few weeks of sending.",
  },
  {
    q: "Does withdrawing restore the weekly limit?",
    a: "There is no sign that it does. LinkedIn says withdrawing does not lift an invitation restriction, and it publishes nothing suggesting a withdrawn invitation stops counting toward a weekly allowance. Third-party guides say withdrawn invitations still count. Plan as if every invitation you send is spent the moment it goes.",
  },
];

const SOURCES = [
  { label: "LinkedIn Help: Withdraw an invitation (desktop and app steps, no bulk option)", url: LI_WITHDRAW },
  { label: "LinkedIn Help: Withdraw an invitation (older article)", url: "https://www.linkedin.com/help/linkedin/answer/62008" },
  { label: "LinkedIn Help: Prohibited software and extensions", url: LI_PROHIBITED },
  { label: "LinkedIn Help: Types of restrictions for sending invitations", url: "https://www.linkedin.com/help/linkedin/answer/a551012" },
  { label: "LinkedIn Help: Invitation limit reached", url: "https://www.linkedin.com/help/linkedin/answer/a550555" },
  { label: "LinkedIn Help: Invitation restrictions (answer 4800)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "Linked API: LinkedIn pending invitations (quotes LinkedIn’s FAQ on six-month expiry)", url: "https://linkedapi.io/guides/linkedin-pending-invitations" },
  { label: "Overloop: LinkedIn outreach benchmarks (Botdog acceptance timing)", url: "https://overloop.com/blog/linkedin-outreach-benchmarks" },
  { label: "Dripify Help: out of connection requests (pending invitation guidance)", url: "https://help.dripify.com/en/articles/6074973-i-am-out-of-connection-requests-on-linkedin-what-should-i-do-now" },
  { label: "Ligo: what happens if I withdraw a LinkedIn invitation", url: "https://ligosocial.com/blog/what-happens-if-i-withdraw-a-linkedin-invitation" },
];

const KNOWN = [
  { label: "Can pending invitations get an account restricted?", values: ["Published", "Yes. LinkedIn lists invitations ignored or left pending among its reasons."] },
  { label: "How long is the longest invitation restriction?", values: ["Published", "Up to a month, for too many outstanding invitations."] },
  { label: "Does the recipient get notified of a withdrawal?", values: ["Published", "No."] },
  { label: "Can you re-invite someone you withdrew?", values: ["Published", "Not for up to three weeks."] },
  { label: "Do unanswered invitations expire?", values: ["Quoted from LinkedIn’s FAQ", "Yes, after six months."] },
  { label: "How many pending invitations are too many?", values: ["Not published", "Vendor figures differ; one advises under 800."] },
  { label: "Can you withdraw in bulk on LinkedIn?", values: ["Published", "No. LinkedIn’s help center says there is no bulk option."] },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="Withdrawing pending LinkedIn invitations: when, why and what it changes"
      lede={`Withdraw pending LinkedIn invitations once they have gone unanswered for ${WITHDRAW_DAYS} days, oldest first, because LinkedIn names invitations left pending as a reason it restricts accounts. Withdrawing keeps that pile small, but it does not give back invitations you already spent or lift a restriction you already have. After a withdrawal, LinkedIn blocks you from re-inviting that person for up to three weeks.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <Gb1Summary>
        <ul>
        <li>
          <strong>Where:</strong> My Network, then Manage, then the Sent tab, then Withdraw. One at a
          time; LinkedIn has no bulk option.
        </li>
        <li>
          <strong>When:</strong> anything still pending after {WITHDRAW_DAYS} days, oldest first, in small
          regular batches.
        </li>
        <li>
          <strong>What it changes:</strong> a smaller pending pile. It does not refund this week&rsquo;s
          invitations or lift a restriction you already have.
        </li>
        <li>
          <strong>What it costs:</strong> you cannot invite that person again for up to three weeks, and
          you should not want to.
        </li>
        </ul>
      </Gb1Summary>

      <h2 id="how-to">How to withdraw pending LinkedIn invitations, on desktop and mobile</h2>
      <h3 id="desktop">On desktop</h3>
      <p>
        As <a href={LI_WITHDRAW} rel="noopener nofollow" target="_blank">LinkedIn&rsquo;s help center</a> describes it as of
        October 2026:
      </p>
      <ol>
        <li>
          Click <strong>My Network</strong> in the top bar, or go straight to the Sent invitations page at{" "}
          <a href={SENT_URL} rel="noopener nofollow" target="_blank">
            linkedin.com/mynetwork/invitation-manager/sent
          </a>{" "}
          and skip to step 4.
        </li>
        <li>
          Next to Invitations, click <strong>Manage</strong> (it may read <strong>Show all</strong> when invitations are
          waiting for you).
        </li>
        <li>
          Open the <strong>Sent</strong> tab. It lists invitations to people, pages and events that are still waiting for an
          answer.
        </li>
        <li>
          Click <strong>Withdraw</strong> next to the person, then <strong>Withdraw</strong> again to confirm. LinkedIn
          cannot undo it.
        </li>
      </ol>
      <h3 id="mobile">In the LinkedIn app</h3>
      <ol>
        <li>
          Tap <strong>My Network</strong> in the bottom bar.
        </li>
        <li>
          Tap <strong>Invitations</strong> at the top of the screen (on some versions, <strong>Manage</strong>).
        </li>
        <li>
          Tap the <strong>Sent</strong> tab.
        </li>
        <li>
          Tap <strong>Withdraw</strong> next to the invitation and confirm. On some app versions it sits behind the three-dot
          menu beside the name.
        </li>
      </ol>
      <p>
        LinkedIn has no bulk withdraw of its own, so a long list is cleared one at a time. Clear the oldest first: they are the
        least likely ever to be accepted.
      </p>

      <h3 id="bulk-tools">Bulk-withdraw extensions and scripts</h3>
      <p>
        Because the Sent tab works one invitation at a time, browser extensions and copy-and-paste scripts that click
        Withdraw down the list for you are easy to find. They are automation in the plainest sense: software acting on
        LinkedIn&rsquo;s pages in your name, which LinkedIn&rsquo;s{" "}
        <a href={LI_PROHIBITED} rel="noopener nofollow" target="_blank">
          help page on prohibited software and extensions
        </a>{" "}
        says can get an account restricted. They also tend to run hundreds of withdrawals in one sitting, which is exactly the
        burst of activity you are trying to avoid. If the pile is large, clear it by hand over a few days, a batch at a time,
        or use a tool that withdraws in small paced batches as part of its normal running.
      </p>

      <h2 id="how-many">How many pending invitations is too many? What is known and what is not</h2>
      <p>
        This is where most guides state a number with confidence. LinkedIn does not publish one. Here is
        what can actually be sourced as of October 2026.
      </p>
      <CompareTable
        caption="What is known about pending LinkedIn invitations, as of October 2026"
        columns={["Status", "What is known"]}
        rows={KNOWN}
      />
      <p>
        The useful conclusion is that there is no safe number to fill up to. LinkedIn&rsquo;s description of the
        trigger is behavioral: many invitations that nobody answers. An account sending a steady{" "}
        {PUBLIC_LIMITS.invitesPerWeek} invitations a week to people who mostly ignore them builds the pile
        fast, whatever the exact ceiling is. The two levers are the same as always: invite people with a
        real reason to accept, and clear what they did not.
      </p>
      <Callout tone="info">
        <p>
          <strong>The pile includes invitations from before you started using a tool.</strong> LinkedIn
          counts every outstanding invitation on the account, whether you sent it by hand two years ago or
          another tool sent it last month. If an account is restricted sooner than its recent sending
          explains, an old backlog nobody remembered is a likely suspect. Check your Sent tab before you
          blame the software.
        </p>
      </Callout>

      <h2 id="what-it-does-not-do">What withdrawing does not do</h2>

      <h3 id="weekly-quota">It does not restore your weekly quota</h3>
      <p>
        Withdrawing is sometimes sold as a way to send more. LinkedIn publishes nothing that supports it:
        an invitation is counted when it is sent, and third-party guides report that withdrawn invitations
        still count toward the week. Withdrawing a hundred invitations on Monday morning does not turn into
        a hundred more to send on Monday afternoon. How the week is counted, and why it binds before the
        daily number, is in our guide to the{" "}
        <Link href="/guides/linkedin-weekly-invitation-limit">LinkedIn weekly invitation limit</Link>.
      </p>
      <p>
        Whether withdrawing changes how LinkedIn itself sees your acceptance rate is not published either. LinkedIn names
        invitations that are ignored or left pending as a cause of restrictions, and says nothing about how a withdrawn one is
        scored, so assume it still counts as an invitation nobody accepted.
      </p>
      <p>
        Nor should it flatter your own numbers. Nora counts a withdrawn invitation as sent and not accepted when
        it works out an account&rsquo;s acceptance rate, and flags an account below{" "}
        {PUBLIC_LIMITS.healthyAcceptance}%. Treating withdrawn invitations as never sent would make the rate
        look healthiest on exactly the accounts that send the most invitations nobody wants. Our guide to{" "}
        <Link href="/guides/linkedin-acceptance-rate">LinkedIn acceptance rates</Link> covers what a good rate
        looks like and how to raise it.
      </p>

      <h3 id="restriction">It does not lift a restriction</h3>
      <p>
        If LinkedIn has already stopped you sending invitations, withdrawing pending ones will not lift it;
        LinkedIn&rsquo;s help center says so plainly, and says its support team will not lift one on request.
        Withdrawing still helps the next week, because the outstanding pile is one of the named causes. What
        to do while you wait is in{" "}
        <Link href="/guides/linkedin-account-restricted">what to do when your LinkedIn account is restricted</Link>.
      </p>

      <h2 id="resend-lockout">The three-week resend lockout, and why you should not resend anyway</h2>
      <p>
        After you withdraw an invitation, LinkedIn will not let you invite the same person again for up to
        three weeks. An invitation that is left alone instead expires after six months, according to
        LinkedIn&rsquo;s FAQ as quoted by Linked API, and can be re-sent once it has gone.
      </p>
      <p>
        Both rules answer a question that rarely needs asking. Somebody who saw your invitation for{" "}
        {WITHDRAW_DAYS} days and did not accept has given you an answer. A second invitation is a second contact from the
        same person with the same ask, and it is the kind of thing people report. If the first note was
        weak, the fix is a better first note to the next person, not a second note to this one.
      </p>
      <p>
        Nora takes the stricter line: once somebody has been sent an invitation from a workspace, no campaign
        in that workspace sends them another, ever. A person whose invitation Nora withdraws is closed and marked
        as not accepted, and they are not picked up again by a later search. The three-week lockout
        never comes into play.
      </p>

      <h2 id="rule">A conservative housekeeping rule</h2>
      <p>If you want one rule to follow, by hand or with any tool, this is ours:</p>
      <ul>
        <li>
          <strong>Withdraw anything still pending after {WITHDRAW_DAYS} days.</strong> In a Botdog study of
          16,492 requests, as summarized by Overloop, 88% of acceptances arrived within a week. An
          invitation still waiting after {WITHDRAW_DAYS} days is unlikely to turn.
        </li>
        <li>
          <strong>Do it regularly and in small batches,</strong> oldest first, rather than hundreds in one
          sitting every few months.
        </li>
        <li>
          <strong>Never re-invite the people you withdrew.</strong> Note them so a later list does not
          bring them back.
        </li>
        <li>
          <strong>Clear the backlog you inherited.</strong> Invitations sent before you used a tool are
          still yours. Nora only withdraws invitations it sent itself, so an old pile from before is a job
          to do by hand, once.
        </li>
        <li>
          <strong>Fix the cause.</strong> A pile that keeps growing means invitations are going to people
          with no reason to accept. Tighten who you invite and what the note says.
        </li>
      </ul>
      <p>
        Nora does the first and third automatically on every connected account, withdrawing in small
        nightly batches, alongside the daily and weekly caps on the{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits page</Link>. LinkedIn&rsquo;s user
        agreement prohibits automated activity, so no tool can promise an account will never be restricted;
        keeping the pending pile small removes one of the reasons LinkedIn names. See{" "}
        <Link href="/how-it-works">how Nora handles withdrawals for you</Link>, or browse more{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>
    </ArticleLayout>
  );
}
