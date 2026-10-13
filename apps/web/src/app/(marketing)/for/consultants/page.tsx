import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, PITCH_MAX_CHARS } from "@le/shared";
import { ArticleLayout, articleMeta, type Faq, type Source } from "@/components/article";
import { AudMore, AudNote, AudStats, AudSteps } from "@/components/seo/aud-blocks";
import { FIRST_MONTH_TOTAL, FOLLOW_UP_MINUTES } from "@/components/seo/aud-first-month";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/for/consultants";

export const metadata: Metadata = articleMeta(PATH);

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
    a: `One specific, true thing about the person and nothing about your program. A post they wrote, a role they just started or a change at their company is enough, followed by "would be good to connect." Keep it to ${INVITE_NOTE_MAX_CHARS} characters at most, with no link and no call request. The offer belongs in the conversation after they reply.`,
  },
  {
    q: "How many connection requests per day is safe?",
    a: `LinkedIn does not publish a number, so any figure is a judgment. Nora's is ${PUBLIC_LIMITS.invitesPerDayStart} a day from an account's first send, rising to ${PUBLIC_LIMITS.invitesPerDayMax} over about ${PUBLIC_LIMITS.warmupWeeks} weeks, never more than ${PUBLIC_LIMITS.invitesPerWeek} a week, spread across working hours. An account that has never sent starts at the bottom, however old it is.`,
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
      lede="LinkedIn lead generation for consultants and coaches works when the right people hear from you personally and regularly, and fails when it turns into a burst of templates under your name. Nora finds the clients who have the problem you solve, writes each a note in your voice and drafts your replies, at a pace that keeps your profile safe."
      faq={FAQ}
      sources={SOURCES}
    >
      <AudSteps
        id="decisions"
        title="Your part: three approvals"
        intro="When you sell your own expertise, you are the product, the marketing department and the delivery team. Nora does the prospecting in between and asks you three times."
        notes={[
          "Who has the problem, in their words. Nora proposes the segments and approves none of them.",
          "Your opener and your offer, one line at a time, so nothing reads as somebody else's voice.",
          "The list and every note, before a single invitation leaves.",
        ]}
      />

      <h2 id="name-is-brand">Your name is the brand</h2>
      <p>
        A generic message under a company logo is forgotten. Under your name it is remembered,
        because the reader judges you, and in a niche they may well compare notes. A template with
        the first name swapped is the opposite of what a consultant sells: attention to one
        client&rsquo;s situation. And your clients rarely use your vocabulary. You might call it
        &ldquo;operating cadence&rdquo;; they call it &ldquo;Monday meetings that go nowhere&rdquo;.
        Searching for people who talk like you finds other consultants.
      </p>
      <p>
        So every note is built from the recipient&rsquo;s own headline, role and company, and records
        which details it used. A note that could have gone to anybody is flagged on the review screen
        rather than sent as personal. For an operations consultant serving small manufacturers:
      </p>
      <AudNote
        to="Rosa"
        role="Plant Manager at Wobbleton Fabrication (a made-up company)"
        text="Hi Rosa, noticed Wobbleton Fabrication added a second shift this year. That stage is usually where planning gets interesting. Would be glad to connect."
        used={["Company", "Company news"]}
      />
      <p>
        If you also write notes by hand, the{" "}
        <Link href="/guides/linkedin-connection-request-templates">LinkedIn connection request templates</Link>{" "}
        guide shows shapes that fit in {INVITE_NOTE_MAX_CHARS} characters.
      </p>

      <h2 id="coaches">Coaches: getting clients without sounding salesy</h2>
      <p>
        Coaching is bought on trust, and nothing breaks trust faster than a stranger opening with a
        program. The fix is order, not wording:
      </p>
      <ol>
        <li>The connection note says one true thing about the person and asks for nothing.</li>
        <li>
          The first message goes {FOLLOW_UP_MINUTES.min} to {FOLLOW_UP_MINUTES.max} minutes after Nora
          notices the acceptance, continues that thread, and still does not pitch.
        </li>
        <li>
          The offer comes only when they reply. It is one line you wrote and approved, at most{" "}
          {PITCH_MAX_CHARS} characters, adapted to their question rather than pasted.
        </li>
      </ol>
      <p>
        Not every coach wants a call either. A campaign&rsquo;s goal can be a booked meeting, a link
        to something like a free diagnostic or a newsletter, or simply a conversation. A link
        campaign never offers times, and a conversation campaign sends no link at all.
      </p>

      <h2 id="replies">Replies and booking</h2>
      <p>
        Nora drafts each reply only from your documents, and by default you approve it before it
        goes. Switch on autopilot and clean replies go out on their own; pricing, legal and negative
        replies still wait for you by default. You can use Nora&rsquo;s booking page or your existing
        Calendly or Cal.com link. Bookings made on another site are not visible to Nora, and the
        screens say so rather than showing zero meetings. The{" "}
        <Link href="/guides/book-meetings-from-linkedin">guide to booking meetings from LinkedIn</Link>{" "}
        covers when to ask.
      </p>

      <h2 id="pace">How much it sends, and why so little</h2>
      <AudStats
        label="Nora's sending limits for every account"
        items={[
          { value: PUBLIC_LIMITS.invitesPerDayStart, label: "Invitations on your first day" },
          { value: PUBLIC_LIMITS.invitesPerWeek, label: "Most in any week" },
          { value: FIRST_MONTH_TOTAL, label: "Most in your first four weeks" },
          { value: `${PUBLIC_LIMITS.healthyAcceptance}%`, label: "Acceptance floor before a warning" },
        ]}
      />
      <p>
        For a consultant who needs a handful of good clients a year, that is plenty, provided they are
        the right people. The daily allowance rises to {PUBLIC_LIMITS.invitesPerDayMax} over about{" "}
        {PUBLIC_LIMITS.warmupWeeks} weeks and is spread through your working hours. Nobody is
        contacted twice, an opt-out stops everything, and a falling acceptance rate usually points at
        targeting rather than volume. We do not promise reply or booking rates; you will see your
        own. The reasoning is on the{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits</Link> page, and{" "}
        <Link href="/how-it-works">how Nora works</Link> walks through a campaign end to end.
      </p>
      <AudMore current="/for/consultants" />
    </ArticleLayout>
  );
}
