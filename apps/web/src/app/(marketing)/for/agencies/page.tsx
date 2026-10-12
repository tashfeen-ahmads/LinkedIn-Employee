import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, Callout, articleMeta, type Faq, type Source } from "@/components/article";
import { FIRST_MONTH_TOTAL, FIRST_MONTH_WEEKS, FOLLOW_UP_MINUTES } from "@/components/seo/aud-first-month";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

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
      lede="LinkedIn lead generation for agencies works when the people who hire agencies hear from you personally and steadily, and it usually runs through the founder's own profile, which makes that account the most valuable thing in the pipeline. Nora finds your buyers, writes each a personal note, answers the replies and books the calls, at a pace built to keep that account working."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="different">Why LinkedIn lead generation for agencies is different</h2>
      <p>
        Most agencies grow on referrals until referrals slow down. LinkedIn is the obvious next
        step, because the people who hire agencies are there and the founder already has a credible
        profile. Then three things make LinkedIn lead generation for agencies harder than it looks.
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
          peers, and they are the last people who should hear your pitch.
        </li>
        <li>
          <strong>The offer is bespoke.</strong> Scope and price depend on the client, so a reply
          asking &ldquo;what does it cost?&rdquo; needs a person, not a price list.
        </li>
      </ul>

      <h2 id="account-at-risk">Your best seller&rsquo;s profile is the account at risk</h2>
      <p>
        In most agencies the founder is the best seller, and outreach goes out under their name. If
        that profile is restricted, the agency loses its main sales channel and its public face on
        the same day. LinkedIn&rsquo;s User Agreement prohibits automated access, and its help
        pages, as of October 2026, say invitations can be restricted when too many go to people who
        do not know the sender. No tool removes that risk; the job is to keep it small.
      </p>
      <p>
        That is why every limit in Nora is a fixed rule rather than a setting you can raise, and why
        the warm-up counts from the account&rsquo;s first send rather than from when it was
        connected. A founder who connected months ago and never sent still starts at{" "}
        {PUBLIC_LIMITS.invitesPerDayStart} a day. Before you decide, read{" "}
        <Link href="/guides/is-linkedin-automation-safe">what actually gets LinkedIn accounts restricted</Link>.
      </p>

      <h2 id="recruitment">Recruitment agencies: winning clients, not sourcing candidates</h2>
      <p>
        For a recruitment agency, LinkedIn already does two jobs, and they are easy to mix up.
        Sourcing candidates is one. Business development, winning the companies that pay your fee,
        is the other, and it is the one Nora is built for. The buyer is a hiring manager, a head of
        talent or a founder with roles open, not the candidate.
      </p>
      <p>
        A good recruitment strategy names what the client buys (say, a retained search for senior
        engineering hires) and what they do today instead (an in-house recruiter stretched across
        thirty roles, or job boards). A public hiring push is a strong, honest reason to write. The
        note acknowledges it and stops: offering candidates in a connection request is a pitch, and
        it reads as one. Your existing clients go on the exclusion list once, and because no
        prospect is ever contacted twice, two consultants at the agency cannot both approach the
        same hiring manager.
      </p>

      <h2 id="how">How it works for you</h2>

      <h3 id="strategy">A strategy from your website</h3>
      <p>
        Nora reads your website and proposes three to five customer strategies, typically one per
        vertical you serve. Each must say what the customer buys and what they do instead today, two
        fields a competitor cannot fill honestly. If a strategy&rsquo;s audience matches a
        competitor named in your business profile, the approval screen says so. It does not block
        you, because some agencies really do sell to other agencies, but you will not approve one by
        accident. Nothing is searched until you approve.
      </p>

      <h3 id="notes">One note per person, in your voice</h3>
      <p>
        For each prospect Nora writes a note from that person&rsquo;s own headline, role and
        company, under {INVITE_NOTE_MAX_CHARS} characters and never with a link, and shows which
        details it used. An invented example for a paid social agency serving skincare brands:
      </p>
      <blockquote>
        <p>
          &ldquo;Hi Dana, saw you moved from brand to growth at Lumen Skin this spring. Curious how
          you are splitting creative work now that paid social sits with you. Would be good to
          connect.&rdquo;
        </p>
      </blockquote>
      <p>
        You approve the opening lines and the one-line pitch first. Editing a line clears its
        approval, so a colleague&rsquo;s rewrite never goes out on your earlier yes.
      </p>

      <h3 id="replies">Replies answered, calls booked</h3>
      <p>
        When someone accepts, the first message goes {FOLLOW_UP_MINUTES.min} to{" "}
        {FOLLOW_UP_MINUTES.max} minutes after Nora sees the acceptance, inside working hours, and
        does not pitch. Replies are
        answered only from your knowledge documents. Questions about pricing, legal matters and
        negative replies are held for a person by default, an opt-out stops all contact, and anyone
        who asks for a human gets one. Calls are booked on Nora&rsquo;s booking page or through your
        own scheduling link.
      </p>

      <h2 id="limits">The limits that protect your profile</h2>
      <ul>
        <li>
          {PUBLIC_LIMITS.invitesPerDayStart} connection requests a day from the first send, rising
          to {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks.
        </li>
        <li>Never more than {PUBLIC_LIMITS.invitesPerWeek} a week, and {PUBLIC_LIMITS.messagesPerDay} messages a day.</li>
        <li>Each day&rsquo;s invitations spread across working hours, never sent in one sitting.</li>
        <li>Each team member&rsquo;s account capped and warmed up separately.</li>
        <li>Nobody the workspace has contacted is ever invited again, and the exclusion list is checked before every send.</li>
      </ul>
      <p>
        The reasoning behind each number is on the{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits</Link> page.
      </p>

      <h2 id="first-month">What to expect in the first month</h2>
      <p>
        Week one is setup: connect LinkedIn, approve a strategy and the words, read the list,
        launch. From the first send, a new account can send at most {FIRST_MONTH_TOTAL} invitations
        in its first four weeks ({FIRST_MONTH_WEEKS.join(", ")} a week). That is deliberately slow
        and the same for everyone. We will not quote you a meeting rate: it depends on your vertical
        and your offer, and you will see your own numbers. If acceptance falls below{" "}
        {PUBLIC_LIMITS.healthyAcceptance}%, look at the strategy before the wording.
      </p>
      <Callout tone="info">
        Running outreach from many client accounts is a different job, and multi-sender platforms
        are built for it; our <Link href="/alternatives/heyreach">HeyReach comparison</Link> covers
        that kind of tool. Nora is for the agency&rsquo;s own new business.
      </Callout>
      <p>
        Read <Link href="/how-it-works">how Nora works from strategy to booked call</Link>, the{" "}
        <Link href="/guides/linkedin-prospecting">step-by-step LinkedIn prospecting guide</Link>, or
        the versions of this page for <Link href="/for/consultants">consultants and coaches</Link>{" "}
        and <Link href="/for/b2b-saas">SaaS founders</Link>. Back to the{" "}
        <Link href="/">Nora home page</Link>, or <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
