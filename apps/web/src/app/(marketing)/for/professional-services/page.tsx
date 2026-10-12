import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, Callout, articleMeta, type Faq, type Source } from "@/components/article";
import { FIRST_MONTH_TOTAL, FIRST_MONTH_WEEKS, FOLLOW_UP_MINUTES } from "@/components/seo/aud-first-month";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/for/professional-services";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "How do accounting firms get clients on LinkedIn?",
    a: "By reaching owners and finance leads at the moments that create accounting work: growth, a new site, a first big contract, a funding round, a finance hire. A short personal note about that moment, no pitch, and a partner answering when they reply. Firms that write to everybody in an industry at once tend to look like a mailing list.",
  },
  {
    q: "Is LinkedIn automation compliant for financial advisers?",
    a: "That depends on your regulator and your firm's policies, so ask your compliance team; this is not compliance advice. In the US, FINRA's guidance on digital communications reminds firms of their duty to keep records of business communications. What Nora offers is approval before anything is sent and a stored record of every message, which your compliance team can assess.",
  },
  {
    q: "Who should an MSP target on LinkedIn?",
    a: "The person who owns the IT problem in a company too small for a full IT team: often the owner, an operations manager or a finance director at firms of perhaps 20 to 200 staff. The best reasons to write are visible changes such as a new office, rapid hiring or a move to remote work, not job titles alone.",
  },
  {
    q: "Is Sales Navigator worth it for a professional firm?",
    a: "Only if your buyer is defined by seniority or company size, which classic LinkedIn search cannot filter. Many firms find enough owners and finance leads with titles, location and industry. Nora searches on whichever tier the account has and, without Sales Navigator, lists the filters it could not apply before you launch. It does not change Nora's sending limits.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "FINRA Regulatory Notice 17-18: Social Media and Digital Communications", url: "https://www.finra.org/rules-guidance/notices/17-18" },
  { label: "LinkedIn Help: Prohibited software and extensions (User Agreement section 8.2)", url: "https://www.linkedin.com/help/linkedin/answer/a1341387" },
  { label: "LinkedIn Help: Connecting with other members, best practices", url: "https://www.linkedin.com/help/linkedin/answer/62928" },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn lead generation for professional services firms"
      lede="LinkedIn lead generation for professional services works when it feels like a personal introduction from a partner, and backfires when it feels like a mailing list. For accountants, financial advisers and IT providers, Nora reaches decision makers with one personal note each, waits for your approval before anything is sent, and never contacts the same person twice."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="different">Why LinkedIn lead generation for professional services is different</h2>
      <p>
        Professional services are bought on trust. The buyer is choosing someone to handle their
        money, their tax position or their systems, and they judge the firm by how it behaves before
        any work starts. That raises the cost of every outreach mistake:
      </p>
      <ul>
        <li>
          <strong>A clumsy message reflects on the partner</strong> whose name it goes out under.
        </li>
        <li>
          <strong>Repetition looks careless.</strong> An owner who hears from two partners at one
          firm in a month concludes that nobody is paying attention.
        </li>
        <li>
          <strong>Replies can be sensitive.</strong> &ldquo;What would this cost us?&rdquo; or
          &ldquo;Can you look at our contract?&rdquo; should be answered by a person.
        </li>
      </ul>
      <p>
        So three safeguards matter most in LinkedIn lead generation for professional services. Once
        anyone in the workspace has contacted a person, nobody
        contacts them again. The exclusion list of existing clients is checked immediately before
        every send. And an opt-out is checked by fixed rules as well as by the model, so
        &ldquo;please remove me&rdquo; stops everything.
      </p>

      <h2 id="accountants">Accountants and CPA firms</h2>
      <p>
        Accounting work follows events: a business outgrowing its bookkeeper, a second site, a first
        large contract, a funding round, a first finance hire. Those events are often visible on
        LinkedIn, which makes them honest reasons to write. A strategy for a firm serving
        construction businesses might target owners and finance managers at firms with 20 to 150
        staff, who would buy &ldquo;monthly management accounts they can act on&rdquo; instead of
        &ldquo;a year-end set of accounts and a bookkeeper&rdquo;. An invented note:
      </p>
      <blockquote>
        <p>
          &ldquo;Hi Mark, saw that Fenwick Build took on its first public sector contract this year.
          Those tend to change how cash flow needs watching. Would be glad to connect.&rdquo;
        </p>
      </blockquote>

      <h2 id="advisers">Financial advisers: approval before send and a record of what went out (not compliance advice)</h2>
      <p>
        Advisers work under rules on what they say and what they keep, and those rules vary by
        country and firm. As of October 2026, FINRA&rsquo;s Regulatory Notice 17-18 reminds US
        member firms of their obligation to keep records of business communications made on social
        media. We are not your compliance team, and Nora is not a compliance archive. What it
        gives your compliance team to assess:
      </p>
      <ul>
        <li>
          <strong>Approval before send.</strong> Strategies, opening lines, the one-line pitch and
          the launch each need a person&rsquo;s yes. Editing an approved line clears its approval,
          so sign-off applies to particular words.
        </li>
        <li>
          <strong>Replies as drafts.</strong> By default every reply on a campaign is a draft a
          person approves. Pricing, legal and negative replies are held, and the agent answers only
          from documents you supplied.
        </li>
        <li>
          <strong>A record.</strong> Every message sent is stored in your workspace, and an owner or
          admin can export the whole workspace as a file at any time.
        </li>
      </ul>

      <h2 id="msps">IT and managed service providers</h2>
      <p>
        An MSP sells to the person who owns the IT problem in a company too small for an IT
        department, often the owner, an operations manager or a finance director. Job titles alone
        find them poorly. Visible change finds them well: a new office, rapid hiring, a move to
        hybrid work. A strategy that says what the client does today, such as &ldquo;a staff member
        who is good with computers&rdquo;, keeps Nora away from other MSPs, which share your
        vocabulary and would otherwise top the list.
      </p>

      <h2 id="how">How it works for you</h2>

      <h3 id="strategy">A strategy from your website</h3>
      <p>
        Nora reads your website and proposes customer strategies built around the situations that
        bring clients to you. A partner approves the ones to pursue, and nothing is searched before
        that.
      </p>

      <h3 id="notes">One note per person, in your voice</h3>
      <p>
        Each note is written from the person&rsquo;s own headline, role and company, under{" "}
        {INVITE_NOTE_MAX_CHARS} characters, without a link, and with the details it used shown on
        the review screen. The partner reads the list and every note before launch.
      </p>

      <h3 id="replies">Replies answered, calls booked</h3>
      <p>
        The first message follows {FOLLOW_UP_MINUTES.min} to {FOLLOW_UP_MINUTES.max} minutes after an
        acceptance is seen, inside working hours, and does not pitch. If a prospect asks for a call,
        they are offered real times from the partner&rsquo;s booking page, which avoids anything
        blocked out, or the partner&rsquo;s own scheduling link. Anyone who asks for a person is
        always handed to one.
      </p>

      <h2 id="limits">The limits that protect your profile</h2>
      <p>
        {PUBLIC_LIMITS.invitesPerDayStart} invitations a day from the account&rsquo;s first send,
        rising to {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks,
        never more than {PUBLIC_LIMITS.invitesPerWeek} a week, spread across working hours. Each
        partner&rsquo;s account is capped separately. LinkedIn&rsquo;s User Agreement prohibits
        automated access, so no tool can promise zero risk; read{" "}
        <Link href="/guides/is-linkedin-automation-safe">what actually gets accounts restricted</Link>{" "}
        and <Link href="/guides/is-linkedin-automation-legal">whether LinkedIn automation is legal</Link>{" "}
        before deciding.
      </p>

      <h2 id="first-month">What to expect in the first month</h2>
      <p>
        From the first send, a new account can send at most {FIRST_MONTH_TOTAL} invitations in four
        weeks ({FIRST_MONTH_WEEKS.join(", ")} a week). For a firm that wins on a few good clients,
        reaching the right few hundred owners is the point, not reaching more. We do not quote
        meeting rates; you will see your own. If acceptance drops below{" "}
        {PUBLIC_LIMITS.healthyAcceptance}%, the account is flagged, and the fix is usually the
        strategy.
      </p>
      <Callout tone="info">
        Where client and prospect data sits, and who can reach it, is on the{" "}
        <Link href="/security">security and data</Link> page.
      </Callout>
      <p>
        See <Link href="/how-it-works">how Nora works end to end</Link>, or the versions of this
        page for <Link href="/for/agencies">agencies</Link> and{" "}
        <Link href="/for/consultants">consultants</Link>. Back to the{" "}
        <Link href="/">Nora home page</Link>. Nora is free while it grows:{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
