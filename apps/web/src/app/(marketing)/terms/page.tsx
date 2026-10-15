import type { Metadata } from "next";
import Link from "next/link";
import { AUTOPILOT_ALWAYS_HOLDS } from "@le/shared";
import { BreadcrumbSchema } from "@/components/schema";
import { Glance, PageHero } from "@/components/marketing";
import { LEGAL, LegalDocument, LegalEmail, type LegalSection } from "@/components/legal";
import { PUBLIC_LIMITS, pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta({
  title: "Terms of Service: Nora",
  description:
    "The terms for using Nora: the free service, your responsibilities on LinkedIn, who owns your data, AI-written drafts and the limits of our liability.",
  path: "/terms",
});

/*
 * Written to be read, and specific to this product. Two things it must never
 * do: promise the service stays free for ever, or promise a LinkedIn account
 * will not be restricted. LinkedIn's User Agreement prohibits automated
 * access, and no tool can honestly say otherwise.
 *
 * No governing law or postal address is stated, because none has been
 * decided; the general section says how to ask.
 */
const SECTIONS: ReadonlyArray<LegalSection> = [
  {
    id: "acceptance",
    title: "Accepting these terms",
    body: (
      <>
        <p>
          These terms are an agreement between you and {LEGAL.entity} (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;), which runs Nora. By creating an account or using Nora, you accept them.
        </p>
        <p>
          If you use Nora for a company, you confirm that you are allowed to accept these terms for it,
          and &ldquo;you&rdquo; includes that company. Our{" "}
          <Link href="/privacy">Privacy Policy</Link> explains how we handle personal data and is part
          of these terms.
        </p>
      </>
    ),
  },
  {
    id: "the-service",
    title: "The service",
    body: (
      <>
        <p>
          Nora is an AI sales assistant for LinkedIn. From a LinkedIn account you connect, it searches
          for prospects who match the strategies you approve, writes each one a connection request,
          sends follow-up messages, drafts and sends replies, and books meetings, inside daily and
          weekly sending limits.
        </p>
        <p>
          Nora is free while we grow, and you do not need a card to use it. We may introduce paid plans
          or change what is free. If we do, we will tell you before the change affects you, and we will
          never charge you for anything you have not agreed to pay for.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account and workspace",
    body: (
      <>
        <ul>
          <li>You must be at least 18 and give us accurate information when you sign up.</li>
          <li>
            Keep your password to yourself. You are responsible for what happens under your login, and
            you should tell us at <LegalEmail /> if you think someone else has used it.
          </li>
          <li>
            A workspace belongs to the business that set it up. Its owner decides who is a member and
            what role each has, and every member can see the workspace&rsquo;s prospects and
            conversations.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "linkedin",
    title: "Your LinkedIn account and the law",
    body: (
      <>
        <p>
          You connect your own LinkedIn account, and Nora acts from it on your instructions. You must
          have the right to use that account, and you are responsible for complying with
          LinkedIn&rsquo;s User Agreement and with every law that applies to your outreach, including
          data protection and privacy law and anti-spam law.
        </p>
        <p>
          <strong>Please read this part carefully.</strong> LinkedIn&rsquo;s User Agreement prohibits
          automated access to LinkedIn, and using Nora or any similar tool may break it. LinkedIn can
          warn, restrict or close an account it believes is automated. Nora keeps sending well under the
          line (an account starts at {PUBLIC_LIMITS.invitesPerDayStart} connection requests a day and
          never passes {PUBLIC_LIMITS.invitesPerWeek} in a week) and pauses when LinkedIn pushes back,
          but no tool can guarantee that an account will not be restricted, and we do not. You accept
          that risk when you connect an account.
        </p>
        <p>
          You decide whom to contact and why. For your prospects&rsquo; personal data you are the
          controller: you need a lawful reason to contact each person, and you must honor their
          requests, such as a request to be erased. Nora is not affiliated with or endorsed by LinkedIn.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <>
        <p>You may not use Nora to:</p>
        <ul>
          <li>send messages that are false, misleading, harassing, hateful or threatening;</li>
          <li>pretend to be someone you are not, or send from an account that is not yours to use;</li>
          <li>promote anything illegal, or contact people in a way the law forbids;</li>
          <li>target children, or collect sensitive personal data such as health or religion;</li>
          <li>
            get around Nora&rsquo;s sending limits, its do-not-contact rules or its security, or help
            anyone else do so;
          </li>
          <li>
            copy, scrape, resell or take apart the service, or use it to build a database of people for
            a purpose other than your own outreach.
          </li>
        </ul>
        <p>
          If an account breaks these rules or puts other people at risk, we may pause its sending or
          suspend it, and we will tell you why where we reasonably can.
        </p>
      </>
    ),
  },
  {
    id: "your-content",
    title: "Your content and prospect data",
    body: (
      <>
        <p>
          What you put into Nora stays yours: your business details, knowledge documents, campaign copy
          and the data about your prospects. So do the drafts and messages Nora writes for you.
        </p>
        <p>
          You give us permission to store, copy, process and transmit that content, including sending
          it to our service providers such as AI model providers, only as needed to provide, secure and
          support the service for you. You confirm that you have the right to give us that permission.
        </p>
        <p>
          We do not sell your content or use it for advertising. A workspace owner or admin can export
          the workspace&rsquo;s data at any time. If you send us feedback or ideas, we may use them
          without owing you anything.
        </p>
      </>
    ),
  },
  {
    id: "ai-output",
    title: "AI-written messages",
    body: (
      <>
        <p>
          Nora writes with AI models, and AI output can be wrong, incomplete or badly judged. It is
          instructed to use only the facts in your documents and never to invent a meeting time or a
          link, but it can still make mistakes.
        </p>
        <p>
          By default, a person in your workspace approves a campaign&rsquo;s strategy and copy before
          launch, and approves each reply before it is sent. If you turn on autopilot, replies Nora
          judges safe are sent without review. Either way, you are responsible for the messages sent
          from your account, including those sent automatically under settings you chose.
        </p>
        <p>Whatever your settings, the following are never left to autopilot:</p>
        <ul>
          {AUTOPILOT_ALWAYS_HOLDS.map((hold) => (
            <li key={hold.id}>
              <strong>{hold.title}</strong> {hold.detail}
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes",
    body: (
      <>
        <p>
          We work to keep Nora running, but we do not promise it will always be available or free of
          errors. We may change, add or remove features as the product develops.
        </p>
        <p>
          We may pause sending across the service, for example when LinkedIn changes how it treats
          automated activity, to protect the accounts connected to Nora. LinkedIn and our service
          providers can also change what they allow, which may change what Nora can do.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    body: (
      <p>
        Nora is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent the law
        allows, we make no promises beyond those written in these terms, including any promise of a
        number of replies, accepted invitations or meetings, or that a LinkedIn account will stay in
        good standing.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <>
        <p>To the extent the law allows:</p>
        <ul>
          <li>
            we are not liable for indirect or consequential losses, such as lost profits, lost
            business, lost data or a restricted or closed LinkedIn account;
          </li>
          <li>
            our total liability for any claim about Nora is limited to the greater of what you paid us
            for Nora in the twelve months before the claim, or one hundred US dollars.
          </li>
        </ul>
        <p>
          Some places do not allow these limits. Where that is so, they apply only as far as the law
          permits.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    title: "Ending your use",
    body: (
      <>
        <p>
          You can stop using Nora at any time. To close your workspace and have its data deleted, email{" "}
          <LegalEmail />. Export anything you want to keep first.
        </p>
        <p>
          We may suspend or end your access if you break these terms, if your use puts other people or
          the service at risk, or if we stop offering Nora. Where we reasonably can, we will give you
          notice and a chance to export your data.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        When we change these terms we update the date at the top. If a change is significant, we tell
        you by email or in the app before it takes effect. Continuing to use Nora after that means you
        accept the new terms.
      </p>
    ),
  },
  {
    id: "general",
    title: "General",
    body: (
      <>
        <p>
          These terms and the Privacy Policy are the whole agreement between you and us about Nora. If
          one part of them cannot be enforced, the rest still applies. Not enforcing a right straight
          away does not mean we have given it up.
        </p>
        <p>
          If you have a question about which law applies or how to give notice, contact us at{" "}
          <LegalEmail />.
        </p>
      </>
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

export default function TermsPage() {
  return (
    <>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: "Terms of Service", path: "/terms" },
        ]}
      />

      <PageHero
        crumb="Terms of Service"
        lede={
          <>
            <p>
              The agreement for using Nora, written to be read. The part about your LinkedIn account
              matters most, so please read that one even if you skim the rest.
            </p>
            <p className="legal-updated">Last updated: {LEGAL.updated}</p>
          </>
        }
        aside={
          <Glance
            title="In short"
            items={[
              { label: "Cost", value: "Free while we grow, no card" },
              { label: "Your content", value: "Stays yours" },
              { label: "What is sent", value: "You approve it by default" },
              { label: "Account restrictions", value: "Possible, and we say so" },
            ]}
            foot={<a href="#linkedin">Read the LinkedIn section</a>}
          />
        }
      >
        <h1>Terms of Service</h1>
      </PageHero>

      <LegalDocument sections={SECTIONS} />
    </>
  );
}
