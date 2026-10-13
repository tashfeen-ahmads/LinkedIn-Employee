import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, type Faq, type Source } from "@/components/article";
import { AudMore, AudNote, AudStats, AudSteps } from "@/components/seo/aud-blocks";
import { FIRST_MONTH_TOTAL, FIRST_MONTH_WEEKS, FOLLOW_UP_MINUTES } from "@/components/seo/aud-first-month";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/for/small-business";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "Is LinkedIn good for small business lead generation?",
    a: "If you sell to other businesses, usually yes: the people who buy from you list their job, company and location on LinkedIn, so you can find them by what they do rather than by guessing. It suits considered purchases where one conversation is worth a lot. It suits impulse or consumer purchases far less, and it rewards patience over volume.",
  },
  {
    q: "How can I get B2B leads without a sales team?",
    a: "Narrow the buyer to people who have the problem you solve, write each a short note about something specific on their profile, follow up promptly when they accept, and offer real meeting times once they reply. An AI SDR like Nora can do the searching, writing and pacing and draft the replies, while you approve the strategy, the words, the launch and each answer.",
  },
  {
    q: "Is there an affordable AI SDR for a small business?",
    a: `Nora is free while we grow, with no card. It finds prospects, writes one note per person, follows up, drafts replies for you to approve and books meetings, inside the same limits for everyone: ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day at first, rising to ${PUBLIC_LIMITS.invitesPerDayMax}, and never more than ${PUBLIC_LIMITS.invitesPerWeek} a week.`,
  },
  {
    q: "Is Sales Navigator worth it for a small business?",
    a: "Only if your buyer is defined by seniority or company size, which free LinkedIn search cannot filter, or you search often enough to hit LinkedIn's monthly commercial use limit. It does not raise how many invitations you can safely send. Many small businesses can find enough buyers with free search, using a few job titles, a location and an industry.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Prohibited software and extensions", url: "https://www.linkedin.com/help/linkedin/answer/a1341387" },
  { label: "LinkedIn Help: Invitation restrictions (answer 4800)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "LinkedIn Premium FAQ (commercial use limit)", url: "https://premium.linkedin.com/professional/faq" },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn lead generation for small businesses without a sales team"
      lede="LinkedIn lead generation for a small business means finding the few hundred people who could buy from you and writing to each one personally, which is exactly the work an owner never has time for. Nora does that work as a free AI SDR: it finds the buyers, writes each a note, follows up and drafts the replies, while you approve what goes out under your name."
      faq={FAQ}
      sources={SOURCES}
    >
      <AudSteps
        id="decisions"
        title="An hour a week, in three steps"
        intro="A salesperson is a salary, a ramp-up and a manager's time. What a small business can usually spare is an hour or so a week. That is our suggested budget, not a measurement, and this is where it goes."
        notes={[
          "Once, then now and then: read the segments Nora proposed and approve the ones worth pursuing.",
          "Approve the opening lines and the one-line offer. Editing a line clears its approval.",
          "Read the list and the notes, cut anyone you know personally, and press the button.",
        ]}
      />
      <p>
        The rest of the hour goes on the inbox: each reply arrives as a draft for you to approve or
        edit, and questions about price wait for you. Once you trust the drafts, autopilot can send
        the clean ones on their own. Our{" "}
        <Link href="/guides/ai-sdr-vs-human-sdr">AI SDR versus human SDR comparison</Link> sets out
        what a hire would cost instead.
      </p>

      <h2 id="one-profile">One profile, and it is also your reputation</h2>
      <p>
        A sales team can afford a bad week. A small business usually prospects from the
        owner&rsquo;s profile, which is also its referral network and often its only sales channel.
        LinkedIn&rsquo;s User Agreement prohibits automated sending, and its help center says
        invitations get restricted when many go out in a short time or many are ignored. No tool can
        promise zero risk, so the tool has to send slowly, to the right people, and never in the
        forty-on-a-quiet-Friday bursts that owners fall into by hand. In a small market, the same
        person getting two different pitches from you is noticed too, so nobody your workspace has
        contacted is ever invited again.
      </p>

      <h2 id="note">A note a local owner would answer</h2>
      <p>
        For each prospect, Nora writes a connection note from that person&rsquo;s own headline, role
        and company, never containing a link, and the review screen shows which details each note
        used. For a bookkeeping firm writing to a growing bakery:
      </p>
      <AudNote
        to="Jess"
        role="Owner of Puddleford Bakery (a made-up business)"
        text="Hi Jess, saw Puddleford Bakery opened a second location in Columbus this year. Curious whether the books grew with it or stayed on one spreadsheet. Would be good to connect."
        used={["Company", "New location", "City"]}
      />
      <p>
        When someone accepts, the first message goes {FOLLOW_UP_MINUTES.min} to{" "}
        {FOLLOW_UP_MINUTES.max} minutes after Nora notices, within working hours, and does not pitch.
        When they reply, the draft uses only the facts in your knowledge documents, makes the offer
        you approved, and either proposes real times from your booking page or sends your own
        scheduling link. An opt-out stops all contact at once, and anyone who asks for a person gets
        you.
      </p>

      <h2 id="first-month">Your first month, by the numbers</h2>
      <AudStats
        label="The most a new account can send in each of its first four weeks"
        items={FIRST_MONTH_WEEKS.map((count, week) => ({ value: count, label: `Week ${week + 1}` }))}
      />
      <p>
        That is {FIRST_MONTH_TOTAL} invitations at most, spread across working days, because every
        account starts at {PUBLIC_LIMITS.invitesPerDayStart} a day from its first send and rises to{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks, never more than{" "}
        {PUBLIC_LIMITS.invitesPerWeek} a week. It is deliberately slow and the same for every account.
        We will not quote you an acceptance or meeting rate; those depend on your market, and you
        will see your own. If acceptance falls below {PUBLIC_LIMITS.healthyAcceptance}%, the account
        is flagged, and the fix is usually the strategy rather than the wording. The reasoning is on
        our <Link href="/linkedin-automation-limits">LinkedIn limits page</Link>.
      </p>

      <h2 id="free-vs-paid">Free versus paid: what you actually need</h2>
      <p>
        Three things: a way to find the right people, a way to write to each of them personally, and
        something that handles the replies. You do not necessarily need a paid LinkedIn seat. Free
        search filters by keywords, location, industry and company; it cannot filter by seniority or
        company size, and heavy searching runs into LinkedIn&rsquo;s monthly commercial use limit.
        Our guide to{" "}
        <Link href="/guides/linkedin-prospecting-without-sales-navigator">LinkedIn prospecting without Sales Navigator</Link>{" "}
        shows when the seat is worth it.
      </p>
      <p>
        Nora itself is free while we grow, with no card and no plans to choose between: every
        workspace gets the whole product and the same limits. The{" "}
        <Link href="/free-linkedin-automation-tool">free LinkedIn automation tool</Link> page says
        exactly what that covers, and <Link href="/how-it-works">how Nora works</Link> walks through
        a campaign from strategy to booked call.
      </p>
      <AudMore current="/for/small-business" />
    </ArticleLayout>
  );
}
