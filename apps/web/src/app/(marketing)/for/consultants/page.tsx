import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, PITCH_MAX_CHARS, YOUR_DECISIONS } from "@le/shared";
import { ArticleLayout, Callout, articleMeta, type Faq, type Source } from "@/components/article";
import { FIRST_MONTH_TOTAL, FIRST_MONTH_WEEKS, FOLLOW_UP_MINUTES } from "@/components/seo/aud-first-month";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/for/consultants";

export const metadata: Metadata = articleMeta(PATH);

const [, WORDS, LAUNCH] = YOUR_DECISIONS;

const FAQ: readonly Faq[] = [
  {
    q: "How do consultants find clients on LinkedIn?",
    a: "Describe the client who has the problem you solve in their words, not yours, then search for them by title, industry and location. Write each a short note about something specific on their profile, follow up soon after they accept without pitching, and make your offer only once they reply. Do it a little every working day rather than in bursts.",
  },
  {
    q: "Can I automate LinkedIn outreach as a coach?",
    a: `Yes, with care. LinkedIn's User Agreement prohibits automated access, so no tool can promise zero risk. Keep volume low, keep notes personal, and approve what goes out under your name. Nora starts at ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day, writes one note per person, and sends nothing until you approve the strategy, the words and the launch.`,
  },
  {
    q: "What should a coach say in a connection request?",
    a: `One specific, true thing about the person and nothing about your programme. A post they wrote, a role they just started or a change at their company is enough, followed by "would be good to connect." Keep it under ${INVITE_NOTE_MAX_CHARS} characters, with no link and no call request. The offer belongs in the conversation after they reply.`,
  },
  {
    q: "How many connection requests per day is safe?",
    a: `LinkedIn does not publish a number, so any figure is a judgement. Nora's is ${PUBLIC_LIMITS.invitesPerDayStart} a day from an account's first send, rising to ${PUBLIC_LIMITS.invitesPerDayMax} over about ${PUBLIC_LIMITS.warmupWeeks} weeks, never more than ${PUBLIC_LIMITS.invitesPerWeek} a week, spread across working hours. An account that has never sent starts at the bottom, however old it is.`,
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Prohibited software and extensions (User Agreement section 8.2)", url: "https://www.linkedin.com/help/linkedin/answer/a1341387" },
  { label: "LinkedIn Help: Connecting with other members, best practices", url: "https://www.linkedin.com/help/linkedin/answer/62928" },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn lead generation for consultants and coaches"
      lede="LinkedIn lead generation for consultants and coaches works when the right people hear from you personally and regularly, and fails when it turns into a burst of templates under your name. Nora finds the clients who have the problem you solve, writes each a note in your voice, and books calls at a pace that keeps your profile safe."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="different">Why LinkedIn lead generation for consultants and coaches is different</h2>
      <p>
        When you sell your own expertise, you are the product, the marketing department and the
        delivery team. Most advice for independents is about posting content, which builds
        reputation slowly. Outreach is the part that fills next month&rsquo;s calendar, and LinkedIn
        lead generation for consultants behaves differently from a sales team&rsquo;s in three ways.
      </p>
      <ul>
        <li>
          <strong>Prospecting stops when delivery starts.</strong> The month you win two clients is
          the month your pipeline empties, and you find out three months later.
        </li>
        <li>
          <strong>Your clients do not use your vocabulary.</strong> You might call it
          &ldquo;operating cadence&rdquo;. They call it &ldquo;Monday meetings that go
          nowhere&rdquo;. Searching for people who talk like you finds other consultants.
        </li>
        <li>
          <strong>One conversation is worth a lot.</strong> You need dozens of the right people, not
          thousands of loosely matched ones.
        </li>
      </ul>

      <h2 id="name-is-brand">Your name is the brand: why mass templates cost more than they earn</h2>
      <p>
        A generic message under a company logo is forgotten. Under your name it is remembered,
        because the reader judges you, not a brand, and in a niche they may well compare notes. A
        template with the first name swapped is also a message that could have gone to anyone, which
        is the opposite of what a consultant sells: attention to one client&rsquo;s situation.
      </p>
      <p>
        That is why every note Nora writes is built from the recipient&rsquo;s own headline, role
        and company, and records which of those details it used. A note that could have gone to
        anybody is flagged on the review screen rather than sent as personal. If you also write
        notes by hand, the{" "}
        <Link href="/guides/linkedin-connection-request-templates">
          LinkedIn connection request templates
        </Link>{" "}
        guide shows the shapes that fit in {INVITE_NOTE_MAX_CHARS} characters.
      </p>

      <h2 id="coaches">Coaches: getting clients without sounding salesy</h2>
      <p>
        Coaching is bought on trust, and nothing breaks trust faster than a stranger opening with a
        programme. The fix is order, not wording. The connection note says one true thing about the
        person and asks for nothing. The first message after they accept continues that thread and
        still does not pitch. The offer comes only when they reply, and it is one line you wrote
        and approved, at most {PITCH_MAX_CHARS} characters, adapted to their question rather than
        pasted.
      </p>
      <p>
        Not every coach wants a call either. A campaign&rsquo;s goal can be a booked meeting, a link
        to something like a free diagnostic or a newsletter, or simply a conversation. A link
        campaign never offers times, a conversation campaign sends no link at all, and no campaign
        sends a link the agent was not given.
      </p>

      <h2 id="how">How it works for you</h2>

      <h3 id="strategy">A strategy from your website</h3>
      <p>
        Nora reads your website and proposes customer strategies, each naming the pains, what the
        client would buy and what they do instead today. For an operations consultant serving small
        manufacturers that might be &ldquo;a planning rhythm the whole floor follows&rdquo; instead
        of &ldquo;a whiteboard and the owner&rsquo;s memory&rdquo;. Approving one is your call: Nora
        approves none itself, and nothing is searched until you do.
      </p>

      <h3 id="notes">One note per person, in your voice</h3>
      <p>
        Nora writes each note from the prospect&rsquo;s own headline, role and company, in the tone
        of your business profile and any writing instructions you give it. An invented example for
        that consultant:
      </p>
      <blockquote>
        <p>
          &ldquo;Hi Tom, noticed Hartley Fabrication added a second shift this year. That stage is
          usually where planning gets interesting. Would be glad to connect.&rdquo;
        </p>
      </blockquote>
      <p>
        Two decisions stay with you. {WORDS.title}: the opening lines and the pitch, one line at a
        time, and editing a line clears its approval. {LAUNCH.title}: the list and every note are in
        front of you, and nothing has been sent before you press the button.
      </p>

      <h3 id="replies">Replies answered, calls booked</h3>
      <p>
        If Tom accepts, a short first message follows {FOLLOW_UP_MINUTES.min} to{" "}
        {FOLLOW_UP_MINUTES.max} minutes after Nora sees the acceptance, inside your working hours.
        Replies are answered only from your documents; pricing, legal and negative replies wait for
        you by default. You can use Nora&rsquo;s booking page or your existing Calendly or Cal.com
        link. Bookings made on another site are not visible to Nora, and the screens say so rather
        than showing zero meetings. The{" "}
        <Link href="/guides/book-meetings-from-linkedin">guide to booking meetings from LinkedIn</Link>{" "}
        covers when to ask.
      </p>

      <h2 id="limits">The limits that protect your profile</h2>
      <p>
        {PUBLIC_LIMITS.invitesPerDayStart} invitations a day from your first send, rising to{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks, never more
        than {PUBLIC_LIMITS.invitesPerWeek} a week, spread through your working hours. Nobody is
        contacted twice, an opt-out stops everything, and if acceptance drops below{" "}
        {PUBLIC_LIMITS.healthyAcceptance}% the account is flagged, which usually points at targeting
        rather than volume. The reasoning is on the{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits</Link> page.
      </p>

      <h2 id="first-month">What to expect in the first month</h2>
      <p>
        Setup comes first: connect LinkedIn, approve a strategy, approve your opener and pitch, read
        the list. From the first send, a new account can send at most{" "}
        {FIRST_MONTH_TOTAL} invitations in four weeks ({FIRST_MONTH_WEEKS.join(", ")} a week). For a
        consultant who needs a handful of good clients a year, that is plenty, provided they are the
        right people. We do not promise reply or booking rates; you will see your own.
      </p>
      <Callout tone="info">
        Nora is free for every workspace while it grows, with no card. See{" "}
        <Link href="/free-linkedin-automation-tool">what the free LinkedIn automation tool covers</Link>.
      </Callout>
      <p>
        Read <Link href="/how-it-works">how Nora works end to end</Link>, or the versions of this
        page for <Link href="/for/agencies">agencies</Link> and{" "}
        <Link href="/for/b2b-saas">SaaS founders</Link>. Back to the{" "}
        <Link href="/">Nora home page</Link>, or <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
