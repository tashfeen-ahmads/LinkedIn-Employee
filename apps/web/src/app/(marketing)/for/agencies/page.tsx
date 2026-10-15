import type { Metadata } from "next";
import Link from "next/link";
import { alwaysHoldsSentence } from "@le/shared";
import { ArticleLayout, articleMeta, type Faq, type Source } from "@/components/article";
import { AudMore, AudNote, AudStats, AudSteps } from "@/components/seo/aud-blocks";
import { FIRST_MONTH_TOTAL, FIRST_MONTH_WEEKS, FOLLOW_UP_MINUTES } from "@/components/seo/aud-first-month";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/for/agencies";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "How do agencies get clients on LinkedIn?",
    a: "By writing personally to the people who buy what the agency sells, steadily rather than in bursts. Pick one vertical, describe what those buyers purchase and what they do instead today, find them by title and industry, and send each a short note about something specific to them. The pitch waits until they reply.",
  },
  {
    q: "Is LinkedIn automation safe for agency accounts?",
    a: `No tool can promise it is risk-free: LinkedIn's User Agreement prohibits automated access. What lowers the risk is low volume, an even pace and people who accept. Nora starts at ${PUBLIC_LIMITS.invitesPerDayStart} invitations a day, ramps to ${PUBLIC_LIMITS.invitesPerDayMax} over about ${PUBLIC_LIMITS.warmupWeeks} weeks, never passes ${PUBLIC_LIMITS.invitesPerWeek} a week, and flags the account if acceptance falls.`,
  },
  {
    q: "Can I run outreach for several team members?",
    a: "Yes, for the agency's own new business. Each person in the workspace connects their own LinkedIn account, and each account gets its own daily cap and warm-up. The workspace shares one record of who has been contacted, so a prospect invited by one partner is never invited by another. Running campaigns from clients' own accounts is a different job that Nora is not built for.",
  },
  {
    q: "What is a good connection acceptance rate for agencies?",
    a: `We do not publish a target, because it depends on how narrow the vertical is and how specific the notes are. What we do apply is a floor: if an account's acceptance falls below ${PUBLIC_LIMITS.healthyAcceptance}%, Nora flags it for review. For an agency that usually means the strategy is reaching people who resemble buyers but do not buy.`,
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
      h1="LinkedIn lead generation for agencies, without risking the founder's account"
      lede="LinkedIn lead generation for agencies works when the people who hire agencies hear from you personally and steadily, usually from the founder's own profile, which makes that account the most valuable thing in the pipeline. Nora finds your buyers, writes each one a personal note and drafts every reply for you to approve, at a pace built to keep that account working."
      faq={FAQ}
      sources={SOURCES}
    >
      <AudSteps
        id="decisions"
        title="Three calls the agency keeps"
        notes={[
          "One strategy per vertical you serve. Nothing is searched until a partner says yes.",
          "The opening lines and the one-line pitch. A colleague's edit clears the approval, so it is read again.",
          "The prospect list and every note. Remove existing clients and friends, then launch.",
        ]}
      />

      <h2 id="stalls">Why agency outreach on LinkedIn stalls</h2>
      <p>
        Most agencies grow on referrals until referrals slow down. LinkedIn is the obvious next
        step, because the people who hire agencies are there and the founder already has a credible
        profile. Then three things get in the way.
      </p>
      <ul>
        <li>
          <strong>Client work always wins.</strong> Outreach happens in bursts: forty invitations on
          a quiet Friday, then nothing for three weeks. A burst is the pattern most likely to be
          noticed and the least likely to build a pipeline.
        </li>
        <li>
          <strong>Agencies look like their competitors.</strong> Other agencies share your
          vocabulary, job titles and industry tags. A search built on resemblance fills up with
          peers. Nora asks each strategy what the client buys and what they do instead today, and
          the approval screen says so when a strategy&rsquo;s audience matches a competitor you named.
        </li>
        <li>
          <strong>The offer is bespoke.</strong> Scope and price depend on the client, so a reply
          asking &ldquo;what does it cost?&rdquo; needs a person, not a price list.
        </li>
      </ul>

      <h2 id="note">A note for one marketing lead, not for a vertical</h2>
      <p>
        Nora writes each note from that person&rsquo;s own headline, role and company, never with a
        link, and shows which details it used. Here is the shape for a paid social agency that serves
        skincare brands:
      </p>
      <AudNote
        to="Dana"
        role="Head of Growth at Moonberry Skin (a made-up brand)"
        text="Hi Dana, saw you moved from brand to growth at Moonberry Skin this spring. Curious how you are splitting creative work now that paid social sits with you. Would be good to connect."
        used={["New role", "Company", "Team change"]}
      />
      <p>
        It leans on the openers you approved without pasting them, so no two people in a campaign
        get the same sentence.
      </p>

      <h2 id="account-at-risk">Your best seller&rsquo;s profile is the account at risk</h2>
      <p>
        In most agencies the founder is the best seller, and outreach goes out under their name. If
        that profile is restricted, the agency loses its main sales channel and its public face on
        the same day. LinkedIn&rsquo;s User Agreement prohibits automated access, and its help
        pages, as of October 2026, say invitations can be restricted when too many go to people who
        do not know the sender. No tool removes that risk; the job is to keep it small.
      </p>
      <AudStats
        label="Nora's sending limits for every account"
        items={[
          { value: PUBLIC_LIMITS.invitesPerDayStart, label: "Invitations a day at the first send" },
          { value: PUBLIC_LIMITS.invitesPerDayMax, label: "A day after the warm-up" },
          { value: `${PUBLIC_LIMITS.warmupWeeks} weeks`, label: "Warm-up, from the first send" },
          { value: PUBLIC_LIMITS.invitesPerWeek, label: "Most in any week" },
        ]}
      />
      <p>
        These are fixed rules, not settings you can raise, and each team member&rsquo;s account is
        capped and warmed up on its own. The warm-up counts from an account&rsquo;s first send, so a
        founder who connected months ago and never sent still starts at the bottom. Each day&rsquo;s
        invitations are spread across working hours. Before you decide, read{" "}
        <Link href="/guides/is-linkedin-automation-safe">what actually gets LinkedIn accounts restricted</Link>,
        and the reasoning behind each number on the{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits</Link> page.
      </p>

      <h2 id="recruitment">Recruitment agencies: winning clients, not sourcing candidates</h2>
      <p>
        For a recruitment agency, LinkedIn already does two jobs. Sourcing candidates is one.
        Business development, winning the companies that pay your fee, is the other, and it is the
        one Nora is built for. The buyer is a hiring manager, a head of talent or a founder with
        roles open.
      </p>
      <p>
        A good strategy names what the client buys (say, a retained search for senior engineering
        hires) and what they do today instead (an in-house recruiter stretched across thirty roles).
        A public hiring push is an honest reason to write; the note acknowledges it and stops,
        because offering candidates in a connection request is a pitch. Existing clients go on the
        exclusion list once, and because nobody is ever contacted twice, two consultants at the
        agency cannot both approach the same hiring manager.
      </p>

      <h2 id="replies">When a prospect accepts and replies</h2>
      <p>
        Acceptances are checked every hour. The first message goes out {FOLLOW_UP_MINUTES.min} to{" "}
        {FOLLOW_UP_MINUTES.max} minutes after Nora notices one, inside working hours, so usually
        within a couple of hours, and it does not pitch. When someone replies, Nora drafts an answer
        from your knowledge documents and a person approves it. You can switch on autopilot so clean
        replies go out on their own; pricing, legal and negative replies still wait for you by
        default. {alwaysHoldsSentence()} Calls are
        booked on Nora&rsquo;s booking page or through your own scheduling link.
      </p>

      <h2 id="first-month">The first month</h2>
      <p>
        Week one is setup: connect LinkedIn, approve a strategy and the words, read the list,
        launch. From the first send, a new account can send at most {FIRST_MONTH_TOTAL} invitations
        in its first four weeks ({FIRST_MONTH_WEEKS.join(", ")} a week). That is deliberately slow
        and the same for everyone. We will not quote you a meeting rate; you will see your own
        numbers. If acceptance falls below {PUBLIC_LIMITS.healthyAcceptance}%, look at the strategy
        before the wording.
      </p>
      <p>
        Running outreach from many client accounts is a different job, and multi-sender platforms
        are built for it; our <Link href="/alternatives/heyreach">comparison with HeyReach</Link>{" "}
        covers that kind of tool. For the agency&rsquo;s own pipeline, read{" "}
        <Link href="/how-it-works">how Nora works from strategy to booked call</Link> or the{" "}
        <Link href="/guides/linkedin-prospecting">step-by-step LinkedIn prospecting guide</Link>.
        Selling software rather than services? See{" "}
        <Link href="/for/b2b-saas">LinkedIn outbound for SaaS founders</Link>.
      </p>
      <AudMore current="/for/agencies" />
    </ArticleLayout>
  );
}
