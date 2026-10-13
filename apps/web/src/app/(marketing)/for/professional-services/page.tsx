import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, type Faq, type Source } from "@/components/article";
import { AudMore, AudNote, AudStats, AudSteps } from "@/components/seo/aud-blocks";
import { FIRST_MONTH_TOTAL, FIRST_MONTH_WEEKS, FOLLOW_UP_MINUTES } from "@/components/seo/aud-first-month";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/for/professional-services";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "How do accounting firms get clients on LinkedIn?",
    a: "By reaching owners and finance leads at the moments that create accounting work: growth, a new location, a first big contract, a funding round, a finance hire. A short personal note about that moment, no pitch, and a partner answering when they reply. Firms that write to everybody in an industry at once tend to look like a mailing list.",
  },
  {
    q: "Is LinkedIn automation compliant for financial advisors?",
    a: "That depends on your regulator and your firm's policies, so ask your compliance team; this is not compliance advice. In the US, FINRA's guidance on digital communications reminds firms of their duty to keep records of business communications. What Nora offers is approval before anything is sent and a stored record of every message, which your compliance team can assess.",
  },
  {
    q: "Who should an MSP target on LinkedIn?",
    a: "The person who owns the IT problem in a company too small for a full IT team: often the owner, an operations manager or the controller at companies of perhaps 20 to 200 employees. The best reasons to write are visible changes such as a new office, rapid hiring or a move to remote work, not job titles alone.",
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
      lede="LinkedIn lead generation for professional services works when it feels like a personal introduction from a partner, and backfires when it feels like a mailing list. For accountants, financial advisors and IT providers, Nora reaches decision makers with one personal note each, waits for a partner's approval before anything is sent, and never contacts the same person twice."
      faq={FAQ}
      sources={SOURCES}
    >
      <AudSteps
        id="decisions"
        title="Where a partner signs off"
        notes={[
          "The situations that bring clients to the firm, written as strategies. A partner approves the ones worth pursuing.",
          "The opening lines and the one-line pitch. Sign-off applies to particular words: an edit clears it.",
          "The list of names and every note, checked against existing clients before launch.",
        ]}
      />

      <h2 id="trust">Selling on trust raises the cost of a mistake</h2>
      <p>
        The buyer is choosing someone to handle their money, their taxes or their systems, and judges
        the firm by how it behaves before any work starts. A clumsy message reflects on the partner
        whose name it carries, and an owner who hears from two partners at one firm in a month
        concludes that nobody is paying attention. Three safeguards answer that:
      </p>
      <ul>
        <li>
          <strong>Never twice.</strong> Once anyone in the workspace has contacted a person, nobody
          contacts them again.
        </li>
        <li>
          <strong>Clients stay clients.</strong> The exclusion list of existing clients is checked
          immediately before every send, not only when a campaign is built.
        </li>
        <li>
          <strong>Stop means stop.</strong> An opt-out is checked by fixed rules as well as by the
          model, so &ldquo;please remove me&rdquo; ends all contact.
        </li>
      </ul>

      <h2 id="accountants">Accountants and CPA firms</h2>
      <p>
        Accounting work follows events: a business outgrowing its bookkeeper, a second location, a
        first large contract, a funding round, a first finance hire. Those events are often visible
        on LinkedIn, which makes them honest reasons to write. A strategy for a firm serving
        construction companies might target owners and controllers at companies with 20 to 150
        employees, who would buy &ldquo;monthly financials they can act on&rdquo; instead of
        &ldquo;year-end financial statements and a part-time bookkeeper&rdquo;.
      </p>
      <AudNote
        to="Mark"
        role="Owner of Fizzlebrook Builders (a made-up company)"
        text="Hi Mark, saw that Fizzlebrook Builders won its first government contract this year. Those tend to change how cash flow needs watching. Would be glad to connect."
        used={["Company", "Company news"]}
      />

      <h2 id="advisors">Financial advisors: approval before send and a record of what went out</h2>
      <p>
        This section is not compliance advice. Advisors work under rules on what they say and what
        they keep, and those rules vary by regulator and firm. As of October 2026, FINRA&rsquo;s
        Regulatory Notice 17-18 reminds US member firms of their obligation to keep records of
        business communications made on social media. Nora is not a compliance archive. What it
        gives your compliance team to assess:
      </p>
      <ul>
        <li>
          <strong>Approval before send.</strong> Strategies, opening lines, the one-line pitch and
          the launch each need a person&rsquo;s yes.
        </li>
        <li>
          <strong>Replies as drafts.</strong> By default every reply on a campaign is a draft a
          person approves, written only from documents you supplied. Autopilot, which sends clean
          replies on their own, is off until somebody turns it on.
        </li>
        <li>
          <strong>A record.</strong> Every message sent is stored in your workspace, and an owner or
          admin can export the whole workspace as a file at any time.
        </li>
      </ul>

      <h2 id="msps">IT and managed service providers</h2>
      <p>
        An MSP sells to the person who owns the IT problem in a company too small for an IT
        department, often the owner, an operations manager or the controller. Job titles alone find
        them poorly. Visible change finds them well: a new office, rapid hiring, a move to hybrid
        work. A strategy that says what the client does today, such as &ldquo;an employee who is good
        with computers&rdquo;, keeps Nora away from other MSPs, which share your vocabulary and would
        otherwise top the list.
      </p>

      <h2 id="pace">Pacing for each partner&rsquo;s account</h2>
      <AudStats
        label="Nora's sending limits for every account"
        items={[
          { value: PUBLIC_LIMITS.invitesPerDayStart, label: "Invitations a day at the first send" },
          { value: PUBLIC_LIMITS.invitesPerDayMax, label: "A day after the warm-up" },
          { value: PUBLIC_LIMITS.invitesPerWeek, label: "Most in any week" },
        ]}
      />
      <p>
        Each partner&rsquo;s account is capped and warmed up separately, and each day&rsquo;s
        invitations are spread across working hours. Acceptances are checked every hour, and the
        first message follows {FOLLOW_UP_MINUTES.min} to {FOLLOW_UP_MINUTES.max} minutes after one is
        noticed, without a pitch. A new account can send at most {FIRST_MONTH_TOTAL} invitations in
        its first four weeks ({FIRST_MONTH_WEEKS.join(", ")} a week). For a firm that wins on a few
        good clients, reaching the right few hundred owners is the point.
      </p>
      <p>
        LinkedIn&rsquo;s User Agreement prohibits automated access, so no tool can promise zero risk;
        read <Link href="/guides/is-linkedin-automation-safe">what actually gets accounts restricted</Link>{" "}
        and <Link href="/guides/is-linkedin-automation-legal">whether LinkedIn automation is legal</Link>{" "}
        before deciding. Where client and prospect data sits, and who can reach it, is on the{" "}
        <Link href="/security">security and data</Link> page, and{" "}
        <Link href="/how-it-works">how Nora works</Link> covers the rest. Independent advisors may find{" "}
        <Link href="/for/consultants">LinkedIn lead generation for consultants</Link> closer to how
        they work.
      </p>
      <AudMore current="/for/professional-services" />
    </ArticleLayout>
  );
}
