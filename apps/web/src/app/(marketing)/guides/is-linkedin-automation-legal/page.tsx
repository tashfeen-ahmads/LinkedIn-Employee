import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import { OPT_OUT_PHRASES } from "@le/shared";

const PATH = "/guides/is-linkedin-automation-legal";

export const metadata: Metadata = articleMeta(PATH);

const OPT_OUT_COUNT = OPT_OUT_PHRASES.length;

const FAQ = [
  {
    q: "Is LinkedIn automation illegal?",
    a: "Generally no. In the US and most other places, no law makes it a crime to automate your own LinkedIn account. It does break LinkedIn's User Agreement, which is a contract, so the usual consequence is a restricted or closed account. Legal exposure comes from other things: scraping at scale, fake accounts, and how you handle personal data under state privacy laws or, for EU and UK prospects, GDPR. This is not legal advice.",
  },
  {
    q: "Does LinkedIn ban automation tools?",
    a: "Yes. As of October 2026 its help center says it does not allow third-party software, including crawlers, bots, browser plug-ins and extensions, that scrapes the site or automates activity on it, and that such tools violate the User Agreement. Accounts using them can be restricted or shut down. LinkedIn has also sued companies that scraped it at scale.",
  },
  {
    q: "Is scraping LinkedIn legal?",
    a: "It is against LinkedIn's terms, and the courts have not made it safe. In hiQ v LinkedIn the Ninth Circuit said scraping public profiles was likely not unauthorized access under the US anti-hacking statute, but the trial court later found hiQ breached the User Agreement, and hiQ agreed to a $500,000 judgment and a permanent injunction. Privacy law applies separately.",
  },
  {
    q: "Do I need consent to message someone on LinkedIn under GDPR?",
    a: "GDPR applies only if they are in the EU or UK, and even then consent is not the only route. Legitimate interests is another lawful basis, and GDPR's Recital 47 says direct marketing may be regarded as one. You still have to pass a balancing test, tell the person who you are and where their details came from, and stop immediately if they object. Take advice for your own situation.",
  },
  {
    q: "What is legitimate interest for B2B outreach?",
    a: "It is the GDPR lawful basis, relevant when your prospects are in the EU or UK, that lets you process someone's data without consent when you have a genuine interest, the processing is necessary for it, and the person's interests do not override it. The UK regulator calls these the purpose, necessity and balancing tests. Relevant, low-volume messages to people in a matching role fit it far better than mass messaging.",
  },
];

const SOURCES = [
  { label: "LinkedIn User Agreement, effective November 3, 2025, section 8.2 (Don'ts)", url: "https://www.linkedin.com/legal/user-agreement" },
  { label: "LinkedIn Help: Updates to User Agreement and Privacy Policy", url: "https://www.linkedin.com/help/linkedin/answer/a1341216/updates-to-user-agreement-and-privacy-policy" },
  { label: "LinkedIn Help: Prohibited software and extensions", url: "https://www.linkedin.com/help/linkedin/answer/a1341387" },
  {
    label: "Jenner & Block: in hiQ v LinkedIn, the Ninth Circuit reaffirms a narrow reading of the CFAA (April 2022)",
    url: "https://www.jenner.com/en/news-insights/publications/client-alert-data-scraping-in-hiq-v-linkedin-the-ninth-circuit-reaffirms-narrow-interpretation-of-cfaa",
  },
  {
    label: "Proskauer: court finds hiQ breached LinkedIn's terms prohibiting scraping (November 2022)",
    url: "https://newmedialaw.proskauer.com/2022/11/11/court-finds-hiq-breached-linkedins-terms-prohibiting-scraping-but-in-mixed-ruling-declines-to-grant-summary-judgment-to-either-party-as-to-certain-key-issues/",
  },
  {
    label: "Proskauer: hiQ and LinkedIn reach proposed settlement (December 2022)",
    url: "https://newmedialaw.proskauer.com/2022/12/08/hiq-and-linkedin-reach-proposed-settlement-in-landmark-scraping-case/",
  },
  {
    label: "Social Media Today: LinkedIn wins legal case against data scrapers (Proxycurl, 2025)",
    url: "https://www.socialmediatoday.com/news/linkedin-wins-legal-case-data-scrapers-proxycurl/756101/",
  },
  {
    label: "Mintz: Facebook v. Vachani (Power Ventures), Ninth Circuit, user authorization can be revoked (July 2016)",
    url: "https://www.mintz.com/insights-center/viewpoints/2826/2016-07-facebook-v-vachani-user-authorization-can-be-revoked",
  },
  {
    label: "California Privacy Protection Agency: updated monetary thresholds in the CCPA (January 2025)",
    url: "https://www.cppa.ca.gov/regulations/cpi_adjustment.html",
  },
  {
    label: "Foley & Lardner: CCPA business-to-business and employment information exceptions ending (2022)",
    url: "https://www.foley.com/en/insights/publications/2022/09/ccpa-b2b-employment-information-exceptions-ending",
  },
  {
    label: "Association of Corporate Counsel: state data privacy laws compared, including the commercial-context exclusion (April 2023)",
    url: "https://www.acc.com/sites/default/files/2023-04/4.11.23%20Data%20Privacy%20Slides.pdf",
  },
  {
    label: "Eric Goldman, Technology & Marketing Law Blog: Facebook v. MaxBounty, Facebook posts are electronic mail messages under CAN-SPAM (April 2011)",
    url: "https://blog.ericgoldman.org/archives/2011/04/facebook_v_maxbounty.htm",
  },
  { label: "GDPR Article 6: lawfulness of processing", url: "https://gdpr-info.eu/art-6-gdpr/" },
  { label: "GDPR Recital 47: overriding legitimate interest", url: "https://gdpr-info.eu/recitals/no-47/" },
  { label: "GDPR Article 14: information where data was not obtained from the person", url: "https://gdpr-info.eu/art-14-gdpr/" },
  { label: "GDPR Article 21: right to object", url: "https://gdpr-info.eu/art-21-gdpr/" },
  {
    label: "ICO: legitimate interests (the three-part test)",
    url: "https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/legitimate-interests/",
  },
];

const HIQ = [
  { label: "2019", values: ["Ninth Circuit upholds an order letting hiQ keep scraping public profiles while the case runs."] },
  { label: "2021", values: ["The Supreme Court sends the case back to be reconsidered in light of Van Buren, its CFAA decision."] },
  {
    label: "April 2022",
    values: ["Ninth Circuit again: scraping publicly available pages is likely not access \"without authorization\" under the CFAA."],
  },
  {
    label: "November 2022",
    values: ["The trial court finds hiQ breached LinkedIn's User Agreement, by scraping and by using workers with fake accounts."],
  },
  {
    label: "December 2022",
    values: ["Settlement: a $500,000 judgment against hiQ, a permanent injunction, and destruction of the scraped data and code."],
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="Is LinkedIn automation illegal, or only against the terms?"
      lede="No, LinkedIn automation is generally not illegal, but it breaks LinkedIn's User Agreement (section 8.2), so the usual consequence is a restricted account, not a court case. The legal risks sit elsewhere: large-scale scraping and fake accounts, which LinkedIn has sued over and won, and privacy law, from US state laws such as California's to GDPR for prospects in the EU or UK."
      faq={FAQ}
      sources={SOURCES}
    >
      <Callout tone="warning">
        <p>
          <strong>Not legal advice.</strong> This is a plain-language summary of public sources as of October
          2026, written by a team that builds LinkedIn outreach software and therefore has an interest in the
          answer. For decisions about your business, ask a lawyer who knows your jurisdiction.
        </p>
      </Callout>

      <h2 id="short-answer">The short answer: contract versus law</h2>
      <p>
        Most of the confusion comes from treating two questions as one. &quot;Is it illegal?&quot; asks whether a law
        forbids it. &quot;Is it allowed?&quot; asks whether LinkedIn permits it. Generally, no law forbids automating your own
        account; LinkedIn&apos;s contract does. A breach of contract is enforced by restricting or closing the account, and in
        bigger cases by a lawsuit, not by a prosecution.
      </p>
      <p>
        Articles on this question tend to blur the two, usually in the direction of the product they sell. A vendor of
        automation software stresses that nothing is illegal; a vendor of manual tools stresses the terms. Both statements
        can be true at once, and the risk that matters most to a sales team, losing the account they sell from, comes from
        the contract. The questions people ask most are answered one by one at the end of this page.
      </p>

      <h2 id="user-agreement">What LinkedIn&apos;s user agreement says</h2>
      <p>
        When you create a LinkedIn account you accept its User Agreement. The version in force as of October 2026 is
        effective November 3, 2025. Section 8 lists what members agree to do and not do, and section 8.2, the
        &quot;Don&apos;ts&quot;, is the part that matters here.
      </p>

      <h3 id="section-8-2">Section 8.2, quoted</h3>
      <p>Two of its prohibitions cover almost every outreach tool. You agree that you will not:</p>
      <p>On scraping:</p>
      <blockquote>
        <p>
          &quot;Develop, support or use software, devices, scripts, robots or any other means or processes ... to
          scrape or copy the Services, including profiles and other data from the Services&quot;
        </p>
      </blockquote>
      <p>On automation:</p>
      <blockquote>
        <p>
          &quot;Use bots or other unauthorized automated methods to access the Services, add or download contacts,
          send or redirect messages ... or otherwise drive inauthentic engagement&quot;
        </p>
      </blockquote>
      <p>
        The ellipses mark the parts we left out. LinkedIn updates the agreement from time to time, so the link in the
        sources goes to the current text. The meaning is not in doubt: sending connection requests or messages by software,
        rather than by a person clicking, is an automated method of adding contacts and sending messages.
      </p>

      <h3 id="prohibited-software">The prohibited software and extensions page</h3>
      <p>
        LinkedIn&apos;s help center has a page on prohibited software. It says LinkedIn does not allow
        third-party software, including crawlers, bots, browser plug-ins and browser extensions, that scrapes
        the site, changes its appearance or automates activity, and that all such tools violate the User
        Agreement. It does not name tools, and it does not distinguish between a browser extension and a
        cloud service: what it describes is the behavior.
      </p>
      <p>
        What the page does not say is what this means for a sales team. In practice: LinkedIn enforces its
        terms by restricting accounts, which is why every serious guide to automation is really a guide to
        not getting restricted. Ours is{" "}
        <Link href="/guides/is-linkedin-automation-safe">is LinkedIn automation safe</Link>, and the caps
        behind it are on the{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits page</Link>.
      </p>

      <h2 id="hiq">What hiQ v LinkedIn decided, and what it did not</h2>
      <p>
        hiQ Labs scraped public LinkedIn profiles to sell analytics to employers. LinkedIn sent a
        cease-and-desist letter, hiQ sued to be allowed to continue, and the case ran for five years. It is
        the case every article on this topic mentions, and it is often summarized as &quot;scraping is legal&quot;.
        That is not what happened.
      </p>
      <figure className="ga1-figure">
        <ol className="ga2-steps">
          {HIQ.map((step, i) => (
            <li key={step.label} className={i === HIQ.length - 1 ? "ga2-step is-outcome" : "ga2-step"}>
              <span className="ga2-step-date">{step.label}</span>
              <span className="ga2-step-text">{step.values[0]}</span>
            </li>
          ))}
        </ol>
        <figcaption>hiQ Labs v LinkedIn, 2019 to 2022, from the law firm summaries in the sources.</figcaption>
      </figure>
      <p>What it decided:</p>
      <ul>
        <li>
          <strong>On the US anti-hacking law, a narrow point.</strong> The Ninth Circuit said that scraping
          pages anyone can see without logging in is likely not access &quot;without authorization&quot; under the
          Computer Fraud and Abuse Act. Law firm commentary read that as making anti-hacking claims unlikely
          unless somebody gets around a technical barrier.
        </li>
        <li>
          <strong>On the contract, against hiQ.</strong> The trial court found hiQ breached the User Agreement,
          both through its scraping and through workers who created fake profiles.
        </li>
      </ul>
      <p>What it did not decide:</p>
      <ul>
        <li>
          <strong>That scraping is lawful.</strong> The 2022 appeal ruling was about a preliminary
          injunction, and the settlement&apos;s terms are not precedent.
        </li>
        <li>
          <strong>Anything about data protection.</strong> The case was about US computer and contract law.
          Privacy laws apply to the data whatever a court says about how it was collected.
        </li>
        <li>
          <strong>Anything about logged-in automation.</strong> Using bots inside an account, behind a login,
          is a different question from reading public pages, and the contract covers it squarely.
        </li>
      </ul>
      <p>
        LinkedIn has kept suing. In January 2025 it sued Proxycurl, a company that sold LinkedIn profile data
        through an API and was alleged to have used fake accounts to collect it; Proxycurl shut down in July
        2025, and reports describe a permanent injunction requiring it to delete the data. The pattern across
        these cases is consistent: the companies sued ran scraping or fake accounts at scale.
      </p>

      <h2 id="us-law">US law: the CFAA, state privacy laws and CAN-SPAM</h2>
      <p>
        For a US sales team writing to US prospects, three bodies of law come up. None of them makes automating your own
        account a crime, and each has an edge worth knowing.
      </p>

      <h3 id="cfaa">The Computer Fraud and Abuse Act after hiQ</h3>
      <p>
        After the Supreme Court&apos;s Van Buren decision in 2021 and the Ninth Circuit&apos;s second hiQ ruling in 2022, breaking a
        website&apos;s terms is not, by itself, access &quot;without authorization&quot; under the CFAA, and reading pages anyone can
        see is likely not either. The edge is revocation. In Facebook v. Power Ventures (2016), the Ninth Circuit held that a
        company which kept accessing Facebook after a cease-and-desist letter, and switched IP addresses when it was blocked,
        did violate the CFAA. So: never get around a block, and stop when a platform tells you in writing that your access
        is revoked.
      </p>

      <h3 id="state-privacy">State privacy laws, starting with California</h3>
      <p>
        California&apos;s privacy law (the CCPA, as amended by the CPRA) has covered business contact details since January 1,
        2023, when its temporary exemption for business-to-business data ran out. It applies to for-profit businesses that
        meet one of its thresholds; the revenue test, as adjusted by California&apos;s privacy agency from January 2025, is
        annual gross revenue above $26,625,000. If your company is covered, a California prospect you found on
        LinkedIn has the same rights as any other consumer, including asking what you hold and having it deleted.
      </p>
      <p>
        Most other state privacy laws, including Virginia&apos;s, Colorado&apos;s, Connecticut&apos;s, Utah&apos;s and Iowa&apos;s, define a
        consumer so as to leave out people acting in a commercial or employment context, which generally puts a prospect
        contacted in their work role outside them. States keep passing new laws, so check the ones you sell into.
      </p>

      <h3 id="can-spam">CAN-SPAM</h3>
      <p>
        CAN-SPAM was written for commercial email, and most people assume it stops there. It may not. In Facebook v.
        MaxBounty (2011), a federal court in California held that messages sent through Facebook counted as &quot;electronic
        mail messages&quot; under the Act, following earlier rulings about MySpace. We found no court that has ruled on
        LinkedIn messages either way, and in Power Ventures the Ninth Circuit found no CAN-SPAM violation on its facts. The
        safe reading is to follow its core rules anyway, which good outreach does regardless: say who you are, say nothing
        misleading, and stop when someone asks.
      </p>

      <h2 id="gdpr">GDPR and B2B outreach on LinkedIn, for EU and UK prospects</h2>
      <p>
        A name, job title and employer are personal data, even when they describe somebody at work. If the
        people you contact are in the EU or the UK, GDPR or the UK GDPR applies to what you do with their
        details, whether you message them by hand, with software or not at all. Under that law, the business
        running the outreach is normally the controller, and a tool that stores and processes the data for it
        is a processor.
      </p>

      <h3 id="legitimate-interest">Legitimate interest</h3>
      <p>
        You need a lawful basis for using someone&apos;s data. Consent is one; for business outreach the one most
        teams rely on is legitimate interests, Article 6(1)(f). Recital 47 says that processing for direct
        marketing purposes may be regarded as carried out for a legitimate interest, and also says that
        whether the person could reasonably expect it matters to the balance.
      </p>
      <p>The UK regulator, the ICO, breaks it into three tests:</p>
      <ul>
        <li>
          <strong>Purpose:</strong> are you pursuing a legitimate interest? Offering a relevant product to a
          business is one.
        </li>
        <li>
          <strong>Necessity:</strong> is using this person&apos;s details necessary for it? Contacting the person
          whose role the product serves is; collecting everything about everyone is not.
        </li>
        <li>
          <strong>Balancing:</strong> do their interests override yours? A short, relevant message to somebody
          in a matching role, who can say no and be left alone, balances very differently from volume
          messaging to people the offer has nothing to do with.
        </li>
      </ul>
      <p>
        Write the assessment down. It is the record that shows you thought about it, and it forces the
        targeting discipline that also gets more invitations accepted.
      </p>
      <p>
        Article 14 adds a transparency duty when, as on LinkedIn, the data did not come from the person
        directly: if you use it to contact them, they must be told who you are, what you are doing and what
        their rights are, at the latest at the first communication. How to do that well inside a short
        LinkedIn message is worth agreeing with your advisor before a campaign starts. Firms that answer
        to a regulator of their own, such as financial advisors, have record-keeping duties on top; our page
        on <Link href="/for/professional-services">LinkedIn lead generation for professional services firms</Link>{" "}
        covers what to take to your compliance team.
      </p>

      <h3 id="opt-outs">Opt-outs and keeping records</h3>
      <p>
        Article 21 gives people the right to object to direct marketing at any time, and once they object
        their data may no longer be used for it. There is no balancing test on this one: the objection wins.
        That has two practical consequences. Every reply has to be checked for an objection before anything
        else happens, and the objection has to outlive the campaign it arrived in, or next month&apos;s list will
        contact the person again.
      </p>
      <p>
        Erasure and objection pull in slightly different directions. If somebody asks to be forgotten and to
        be left alone, deleting every trace of them means the next import cannot recognize them. Nora&apos;s answer
        is to erase the person and everything derived from them, and keep a minimal do-not-contact marker so
        no campaign can contact them again.
      </p>

      <h3 id="never-twice">Never contacting someone twice</h3>
      <p>
        Repeated contact is where outreach stops looking like a reasonable business message and starts
        looking like pressure. Nora treats it as a rule rather than a judgment: once anyone in a workspace has
        sent a person an invitation, no campaign in that workspace sends them another, checked immediately
        before every send. Messages after an accepted invitation continue that one conversation; they never
        open a second one. Read how the{" "}
        <Link href="/guides/linkedin-follow-up-sequence">LinkedIn follow-up sequence</Link> is paced inside
        that rule.
      </p>

      <h2 id="what-it-means">What this means for any tool, including ours</h2>
      <p>
        Every tool that sends LinkedIn invitations or messages on your behalf is an automated method under
        section 8.2. That includes Nora. It works through your own LinkedIn account, and a person on your team
        approves the strategy, the copy and the launch, but the sending is done by software, and LinkedIn&apos;s
        terms do not allow that. Any vendor that tells you its approach is &quot;compliant with LinkedIn&quot; or
        carries no risk is telling you something LinkedIn has not said.
      </p>
      <p>What a tool can honestly control is narrower and still matters a great deal:</p>
      <ul>
        <li>
          <strong>Whose account it uses.</strong> Nora acts only through the account you connect. It does not
          run fake profiles, which is what the LinkedIn lawsuits above were about.
        </li>
        <li>
          <strong>How it finds people.</strong> Prospects come from LinkedIn&apos;s own search, run through your
          account on the tier it has, a page at a time when a campaign needs more people, not from bought
          lists or a scraped database. Reading search results by software is still automated access under
          section 8.2; what it avoids is the bulk collection the lawsuits were about.
        </li>
        <li>
          <strong>How fast it goes.</strong> Nora holds every account to {PUBLIC_LIMITS.invitesPerDayMax}{" "}
          invitations a day at most, {PUBLIC_LIMITS.invitesPerWeek} a week, and {PUBLIC_LIMITS.messagesPerDay}{" "}
          messages a day, with a new account starting at {PUBLIC_LIMITS.invitesPerDayStart}.
        </li>
        <li>
          <strong>What it does with the data.</strong> Where it is stored, who can reach it, and how it is
          deleted are on our <Link href="/security">security and data page</Link>.
        </li>
      </ul>

      <h2 id="lower-risk">How to keep the risk as low as it can go</h2>
      <p>It cannot go to zero. This is what gets it close, with or without a tool:</p>
      <ul>
        <li>
          <strong>Use one real account, your own.</strong> No fake profiles, no shared logins, no renting
          accounts.
        </li>
        <li>
          <strong>Do not scrape or buy scraped lists.</strong> Search on LinkedIn, on the plan you pay for.
        </li>
        <li>
          <strong>Send at a human pace,</strong> spread across working hours, under conservative daily and
          weekly caps.
        </li>
        <li>
          <strong>Write to people with a reason.</strong> Relevance is what passes the balancing test, and it is
          what keeps acceptance high enough that LinkedIn has no reason to look.
        </li>
        <li>
          <strong>Honor objections instantly and permanently.</strong> Nora checks every reply against{" "}
          {OPT_OUT_COUNT} fixed opt-out phrases, such as &quot;remove me&quot; and &quot;not interested&quot;, before any model
          reads it, and an opt-out applies to every campaign in the workspace.
        </li>
        <li>
          <strong>Keep a shared do-not-contact list</strong> that is checked immediately before each send, not
          only when a list is built, so a colleague&apos;s promise to a customer holds.
        </li>
        <li>
          <strong>Keep data only as long as you need it.</strong> Nora erases a prospect once the
          workspace&apos;s retention window has passed since they were added or last contacted, a year by
          default, in a nightly sweep, whether or not anyone remembers to ask. Only someone in a live
          conversation or with a meeting coming up is kept.
        </li>
        <li>
          <strong>Keep a person in the loop</strong> for anything that commits you: pricing, legal questions,
          and anyone who asks to speak to a human.
        </li>
      </ul>
      <p>
        That is the approach Nora is built around; <Link href="/how-it-works">how Nora works</Link> walks
        through it end to end.
      </p>
    </ArticleLayout>
  );
}
