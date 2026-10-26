import type { Metadata } from "next";
import Link from "next/link";
import { BreadcrumbSchema } from "@/components/schema";
import { Glance, PageHero } from "@/components/marketing";
import { LEGAL, LegalDocument, LegalEmail, type LegalSection } from "@/components/legal";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Privacy Policy: Nora",
  description:
    "What Nora collects, what it processes about the people your campaigns contact, who helps us run it, how long data is kept and how to export or erase it.",
  path: "/privacy",
});

/*
 * Every statement here is meant to match what the code does, and each one was
 * checked against it when written: retention and erasure against
 * apps/worker/src/jobs/retention.ts, export against app/app/export, encryption
 * against apps/worker/src/crypto.ts, operator access against migration 0010,
 * the opt-out against rule 55, cookies against middleware.ts and the root
 * layout. Change the code, change this page, and move its date.
 *
 * Suppliers are named by category only. The list is given on request.
 */
const SECTIONS: ReadonlyArray<LegalSection> = [
  {
    id: "who-we-are",
    title: "Who we are",
    body: (
      <>
        <p>
          Nora is run by {LEGAL.entity} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). Nora is an AI sales
          assistant for LinkedIn: it finds prospects for a business, writes their connection requests
          and messages, answers replies and books meetings, all from a LinkedIn account the business
          connects.
        </p>
        <p>
          This policy covers the Nora website and the Nora application. If you have a question about
          it, write to <LegalEmail />.
        </p>
      </>
    ),
  },
  {
    id: "two-roles",
    title: "Two kinds of data, two roles",
    body: (
      <>
        <p>Nora handles two different kinds of personal data, and our role is different for each.</p>
        <ul>
          <li>
            <strong>Account data</strong> is information about you as a Nora user: your name, your
            email address, your workspace and its settings. We decide how it is used, so for this data
            we are the controller.
          </li>
          <li>
            <strong>Prospect data</strong> is information about the people your workspace finds and
            contacts on LinkedIn. Your business decides whom to contact and why, so you are the
            controller and we process that data on your behalf, as your processor. We use it only to
            run the service for the workspace that holds it.
          </li>
        </ul>
        <p>
          If Nora contacted you on behalf of a business, see{" "}
          <a href="#if-nora-contacted-you">If Nora contacted you</a>.
        </p>
      </>
    ),
  },
  {
    id: "what-we-collect",
    title: "What we collect from you",
    body: (
      <>
        <ul>
          <li>
            <strong>Your account.</strong> Your name and email address. If you give them, a short bio,
            your time zone, a business address and a link to your own scheduling page. Your password is
            handled by our authentication service and is never stored in readable form.
          </li>
          <li>
            <strong>Your business.</strong> Your company name and description, your website address
            and LinkedIn company page, and text we read from your website to draft your first
            strategies. Documents you add to your knowledge base. The strategies, campaign copy,
            pitches, openers and calls to action you write or approve.
          </li>
          <li>
            <strong>Your LinkedIn connection.</strong> You connect LinkedIn on our LinkedIn
            integration provider&rsquo;s own sign in page, so your LinkedIn password never reaches us.
            We keep an identifier for the connected account, its name and profile address, whether it
            has Sales Navigator, its connection status and counts of the actions it has taken, which is
            how sending is held inside daily and weekly limits.
          </li>
          <li>
            <strong>Your calendar.</strong> Your working hours, the times you block out and the meetings
            booked through Nora. If you add a calendar feed address, we store that address encrypted
            and keep only the start and end of your busy periods, not event titles or details.
          </li>
          <li>
            <strong>Support requests.</strong> What you write to us through Support, together with a
            snapshot of your account&rsquo;s state at that moment: which setup step you were on,
            whether LinkedIn was connected and whether sending was running.
          </li>
          <li>
            <strong>Activity records.</strong> A log of what happened in your workspace, such as a
            campaign launched or a message sent, and a record of each AI request: which feature made
            it, which model answered, how many tokens it used and what it cost.
          </li>
          <li>
            <strong>Email records.</strong> Which emails we have sent you and when, so the same one is
            never sent twice, and whether you have unsubscribed from product emails.
          </li>
        </ul>
        <p>
          You do not need a payment card for the free trial. When you choose a paid plan, your payment
          details are handled by our payment processor, Stripe, at checkout. We never see or store your
          full card number.
        </p>
      </>
    ),
  },
  {
    id: "prospect-data",
    title: "What we process about your prospects",
    body: (
      <>
        <ul>
          <li>
            <strong>Profile details from LinkedIn:</strong> name, headline, job title, company, company
            size, industry, location, the &ldquo;About&rdquo; text, the profile address and
            LinkedIn&rsquo;s own identifier for the person.
          </li>
          <li>
            <strong>What Nora works out:</strong> a fit score and the reasons for it, signals found on
            the profile, which strategy found the person, when they were last contacted and whether
            they must not be contacted.
          </li>
          <li>
            <strong>Conversations:</strong> the connection request, the messages and replies exchanged
            between your LinkedIn account and the person, and the reply drafts written for them.
          </li>
          <li>
            <strong>Meetings:</strong> the time, a short brief for the call and, when the person books
            through a Nora booking page, the name and email address they type in.
          </li>
          <li>
            <strong>Exclusions:</strong> companies and people your team has said must never be
            contacted.
          </li>
        </ul>
        <p>
          Nora reads new messages on your connected LinkedIn account to find replies. A message from
          somebody your workspace never contacted through Nora is not saved to your workspace. It may
          sit briefly in our job queue while we check who sent it (see{" "}
          <a href="#retention">How long we keep data</a>).
        </p>
      </>
    ),
  },
  {
    id: "how-we-use",
    title: "How we use it",
    body: (
      <>
        <ul>
          <li>
            To run the service: search LinkedIn for prospects, write notes and messages, send them from
            your account at the pace its limits allow, read replies, draft answers and book meetings.
          </li>
          <li>
            To keep your LinkedIn account safe: counting actions against daily and weekly caps,
            checking the account&rsquo;s health and pausing it when LinkedIn pushes back.
          </li>
          <li>
            To keep promises to prospects: a person your workspace has contacted is never sent a second
            connection request from it, and anybody who asks to be removed is never contacted by it
            again.
          </li>
          <li>To answer your support requests and find and fix problems.</li>
          <li>
            To email you about your account, and, unless you unsubscribe, about getting set up and what
            is new (see <a href="#emails">Emails we send you</a>).
          </li>
        </ul>
        <p>
          We do not sell personal data, we do not use it for advertising, and prospect data held by
          one workspace is not used for any other workspace.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    title: "How AI is used",
    body: (
      <>
        <p>
          Nora&rsquo;s writing and reading are done by AI models from outside AI model providers. To
          write a connection note, a message or a reply draft, to classify a reply, or to draft a
          strategy, pitch, opener or post, we send the provider the information that task needs: the
          prospect&rsquo;s profile details, the conversation so far, your business profile and
          strategy, your knowledge documents and your bio. Support requests may also be sent so an
          assistant can draft our answer.
        </p>
        <p>
          Our own record of each AI request holds its size and cost, not the text that was sent. The
          drafts and messages that come back are stored in your workspace like anything else you
          write.
        </p>
        <p>
          A reply asking to be removed is recognized by a fixed rule as well as by the model, and it
          stops all contact with that person. AI output can be wrong, which is why, by default, a
          person approves what is sent. The <Link href="/terms">Terms of Service</Link> say more.
        </p>
      </>
    ),
  },
  {
    id: "providers",
    title: "Service providers",
    body: (
      <>
        <p>We use other companies to run Nora. By category, they are:</p>
        <ul>
          <li>cloud hosting, for the website and the background worker;</li>
          <li>a managed database and authentication service;</li>
          <li>a job queue, which holds background work such as a message waiting to be sent;</li>
          <li>email delivery;</li>
          <li>payment processing, for paid plans;</li>
          <li>AI model providers;</li>
          <li>
            a LinkedIn integration provider, which connects to LinkedIn on your behalf and holds the
            session for your connected account.
          </li>
        </ul>
        <p>
          Each receives only what it needs to provide its service to us. The current list of providers
          is available on request at <LegalEmail />. We also disclose information when the law
          requires us to.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep data",
    body: (
      <>
        <p>
          <strong>Prospect data</strong> has a retention window, 365 days by default for each
          workspace. Every night, a prospect first added longer ago than that, and not contacted within
          it, is erased, unless they are still active in a campaign or have a meeting coming up.
          Erasure works exactly as described in <a href="#erasure">Erasing a prospect</a>.
        </p>
        <p>
          <strong>Account data</strong>, workspace settings, campaigns, the activity log and AI usage
          records are kept for as long as your workspace exists. Support requests are kept after the
          person who raised them leaves the workspace, so the answer still makes sense.
        </p>
        <p>
          <strong>The job queue</strong> removes a finished background job after a day and a failed one
          after a week. A job can contain the text of a message, which is why we state this.
        </p>
        <p>
          <strong>Deleting your workspace.</strong> There is no button for this in the product yet.
          Email <LegalEmail /> from the address on the account and we will delete the workspace, the
          data held under it and, if you ask, your user account.
        </p>
      </>
    ),
  },
  {
    id: "export",
    title: "Exporting your data",
    body: (
      <>
        <p>
          A workspace owner or admin can download everything the workspace holds from the Profile page
          in the app: its prospects, conversations, messages, meetings and campaigns, as one JSON file.
          Access tokens and other credentials are never included. If the export could not read a table
          to the end, the file says so rather than passing as complete.
        </p>
        <p>
          The same file is how you answer a prospect who asks what your business holds about them.
        </p>
      </>
    ),
  },
  {
    id: "erasure",
    title: "Erasing a prospect",
    body: (
      <>
        <p>
          Anyone in a workspace can erase a prospect with one click on the Prospects page. Erasure
          deletes the person&rsquo;s conversations, messages, reply drafts, meetings and campaign
          records, and clears their profile details, scores and signals.
        </p>
        <p>
          One thing is kept on purpose: a do-not-contact record holding the person&rsquo;s LinkedIn
          profile address, the reason it was made and when they were last contacted. Without it, the next search could find them
          again and that workspace would write to them a week after they asked to be forgotten. The
          activity log records that an erasure happened, without any details about the person.
        </p>
      </>
    ),
  },
  {
    id: "if-nora-contacted-you",
    title: "If Nora contacted you",
    body: (
      <>
        <p>
          A message from Nora was sent by a business, from the LinkedIn account of a real person who
          works there. That business decides how your information is used.
        </p>
        <ul>
          <li>
            Reply asking to be removed. Nora recognizes the request, stops every message from that
            workspace to you, and marks you as never to be contacted by it again.
          </li>
          <li>
            Ask the business that wrote to you to show you or erase what it holds. It can export your
            data or erase you in one step.
          </li>
          <li>
            Or write to us at <LegalEmail />. Because the business is the controller of your data, we
            will pass your request to it and help it act.
          </li>
        </ul>
        <p>
          If you are erased, the do-not-contact record described above stays, so that business does not
          find you and contact you again.
        </p>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <>
        <ul>
          <li>
            Access tokens for connected services and calendar feed addresses are encrypted with
            AES-256 before they are stored, with a key kept outside the database. Your LinkedIn
            password never reaches us.
          </li>
          <li>
            The database checks that you belong to a workspace before it returns any of that
            workspace&rsquo;s rows, and our background worker filters every request by workspace as
            well.
          </li>
          <li>
            Our operator console, which we use to run the service, can see that a workspace exists, its
            members, connected accounts, campaigns, meetings, activity log, AI usage and support
            requests. It is not given
            access to your prospect records, conversations, messages or reply drafts. Operator access
            cannot be granted from inside the product.
          </li>
        </ul>
        <p>
          No system is perfectly secure, and we are not SOC 2 audited. If a security incident affects
          your data, we will tell you as the law requires. More detail is on our{" "}
          <Link href="/security">security page</Link>.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and browser storage",
    body: (
      <>
        <p>
          The Nora app uses cookies set by our authentication service to keep you signed in. They are
          necessary for the app to work, so there is no setting to turn them off.
        </p>
        <p>
          The marketing website sets no cookies of its own. Neither the website nor the app runs
          analytics, advertising or tracking scripts, and our fonts are served from our own site. Like
          any website, the servers that deliver our pages receive your IP address and browser details
          with each request.
        </p>
        <p>
          The app also keeps a few things in your browser&rsquo;s own storage: which navigation
          sections you collapsed, your answers to the setup form until your workspace exists (so a
          reload does not lose them), and a marker that stops a broken page reloading itself in a loop.
          None of it is sent to us.
        </p>
      </>
    ),
  },
  {
    id: "emails",
    title: "Emails we send you",
    body: (
      <>
        <p>
          Service emails, such as the welcome, team invitations and alerts about your account, are part
          of using Nora and keep coming while you have an account.
        </p>
        <p>
          Product emails, meaning setup tips and announcements, carry an unsubscribe link. One click
          stops them, and the choice is checked immediately before every product email, so an email
          already scheduled is not sent after you unsubscribe.
        </p>
        <p>When you sign up, finish setup or connect LinkedIn, our own team receives a short notification.</p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        Nora is a business tool for adults. It is not meant for anyone under 18, and we do not knowingly
        collect information from children.
      </p>
    ),
  },
  {
    id: "transfers",
    title: "International transfers",
    body: (
      <p>
        We and our service providers may process data in the United States and in other countries. When
        data moves between countries, we use the safeguards required by the law of the country it
        leaves.
      </p>
    ),
  },
  {
    id: "your-rights",
    title: "Your choices and rights",
    body: (
      <>
        <p>
          You can correct your account details on the Profile page, export your workspace, erase
          prospects and unsubscribe from product emails at any time. Depending on where you live, you
          may also have the right to access, correct, delete or restrict the use of your personal data,
          or to object to it.
        </p>
        <p>
          To use any of these rights, write to <LegalEmail />. We answer within the time the law
          allows.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        When we change this policy we update the date at the top. If a change matters to how your data is
        used, we tell you by email or in the app before it takes effect.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        {LEGAL.entity}, by email at <LegalEmail />.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "Privacy Policy", path: "/privacy" },
        ]}
      />

      <PageHero
        crumb="Privacy Policy"
        lede={
          <>
            <p>
              How Nora handles information about you, and about the people your campaigns contact. In
              plain words, and only what the product actually does.
            </p>
            <p className="legal-updated">Last updated: {LEGAL.updated}</p>
          </>
        }
        aside={
          <Glance
            title="In short"
            items={[
              { label: "Your prospects' data", value: "Yours to control" },
              { label: "Sold or used for ads", value: "Never" },
              { label: "Prospect data kept", value: "365 days by default" },
              { label: "Erased prospects", value: "Do-not-contact only" },
              { label: "Tracking scripts", value: "None" },
            ]}
          />
        }
      >
        <h1>Privacy Policy</h1>
      </PageHero>

      <LegalDocument sections={SECTIONS} />
    </>
  );
}
