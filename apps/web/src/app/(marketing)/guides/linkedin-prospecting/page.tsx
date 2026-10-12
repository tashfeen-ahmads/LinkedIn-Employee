import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";
import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { dailyInviteCap } from "@le/linkedin";

const PATH = "/guides/linkedin-prospecting";

export const metadata: Metadata = articleMeta(PATH);

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/*
 * The ramp quoted in step 6 is the sender's own function, called for a few
 * days after a first send. The date is arbitrary; only the distance matters.
 */
const FIRST_SEND = new Date("2026-01-05T09:00:00Z");
const capOnDay = (day: number) => dailyInviteCap(FIRST_SEND, new Date(FIRST_SEND.getTime() + day * DAY_MS));
const CAP_DAY_8 = capOnDay(7);
const CAP_DAY_22 = capOnDay(21);
const MIN_GAP_MIN = Math.round(LINKEDIN_LIMITS.minGapMs / MINUTE_MS);
const MAX_GAP_MIN = Math.round(LINKEDIN_LIMITS.maxGapMs / MINUTE_MS);
const FOLLOW_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / MINUTE_MS);
const FOLLOW_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / MINUTE_MS);

const FAQ: readonly Faq[] = [
  {
    q: "How do you prospect on LinkedIn?",
    a: "Decide who actually buys from you, turn that into a search on the LinkedIn tier you have, open and check every profile, remove anyone you have contacted or must not contact, write one short note per person from their own profile, send at a steady pace inside your daily and weekly limits, then follow up promptly once they accept and book a call once they reply.",
  },
  {
    q: "What is LinkedIn prospecting?",
    a: "LinkedIn prospecting is finding the people on LinkedIn who are likely to buy what you sell and starting a one-to-one conversation with each of them, usually through a connection request with a short note. It is the LinkedIn version of outbound sales: you go to the buyer, rather than waiting for them to find your company.",
  },
  {
    q: "Do I need Sales Navigator to prospect on LinkedIn?",
    a: "No. As of October 2026, free search can filter by keywords, location, industry, current company and connection degree, and supports OR, NOT and quotes in the keyword box. What it cannot filter by is seniority, company headcount or excluded titles, and a free account runs into LinkedIn's monthly commercial use limit on searches. Sales Navigator adds those filters and removes that limit.",
  },
  {
    q: "How many prospects should I contact per day?",
    a: `LinkedIn publishes no number. Nora starts every account at ${PUBLIC_LIMITS.invitesPerDayStart} connection requests a day from its first send, ramps to ${PUBLIC_LIMITS.invitesPerDayMax} over about ${PUBLIC_LIMITS.warmupWeeks} weeks, and never sends more than ${PUBLIC_LIMITS.invitesPerWeek} in a week. Spread the day's requests across working hours rather than sending them in one sitting.`,
  },
  {
    q: "How do I generate B2B leads on LinkedIn?",
    a: "Target people who have the problem you solve and the authority to buy, not people whose profile looks like yours. Send a note that mentions something specific about them and asks for nothing. Make the offer only once they reply, in one line, and offer real meeting times. Track acceptances, replies and meetings on your own numbers rather than industry averages.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Use Boolean search on LinkedIn", url: "https://www.linkedin.com/help/linkedin/answer/75814" },
  { label: "LinkedIn Help: Commercial use limit", url: "https://www.linkedin.com/help/linkedin/answer/52950" },
  { label: "LinkedIn Premium FAQ (which plans browse without the commercial use limit)", url: "https://premium.linkedin.com/professional/faq" },
  { label: "LinkedIn Help: Choose the right Sales Navigator subscription (filters and plans)", url: "https://www.linkedin.com/help/linkedin/answer/a104003" },
  { label: "LinkedIn Help: Invitation restrictions (answer 4800)", url: "https://www.linkedin.com/help/linkedin/answer/4800" },
  { label: "LinkedIn Help: Prohibited software and extensions", url: "https://www.linkedin.com/help/linkedin/answer/a1341387" },
  { label: "Microsoft Learn: LinkedIn industry codes V2", url: "https://learn.microsoft.com/en-us/linkedin/shared/references/reference-tables/industry-codes-v2" },
  { label: "HubSpot (2012): LinkedIn 277% more effective for lead generation than Facebook and Twitter", url: "https://blog.hubspot.com/blog/tabid/6307/bid/30030/linkedin-277-more-effective-for-lead-generation-than-facebook-twitter-new-data.aspx" },
  { label: "RecruitingDaily: LinkedIn is 277% more effective than just about everything? (a critique)", url: "https://recruitingdaily.com/linkedin-is-277-more-effective-than-just-about-everything-wait-what" },
  { label: "Social Media Today: What influences a B2B purchase decision (repeats LinkedIn's 'four out of five' claim)", url: "https://www.socialmediatoday.com/news/what-influences-a-b2b-purchase-decision-infographic/607725/" },
];

const STEPS = [
  { label: "1. Decide who buys", values: ["Writing to people who resemble you: peers and competitors."] },
  { label: "2. Turn it into a search", values: ["A search that returns nobody, or the wrong people, with no error."] },
  { label: "3. Check every profile", values: ["Spending a capped invitation on someone nobody looked at."] },
  { label: "4. Exclude, and contact once", values: ["Writing to a customer, or to the same stranger twice."] },
  { label: "5. One note per person", values: ["A template the recipient recognises as a template."] },
  { label: "6. Pace the sending", values: ["A burst of invitations, the pattern behind most restrictions."] },
  { label: "7. Follow up, answer, book", values: ["An acceptance followed by silence, or by a pitch."] },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn prospecting: a step-by-step system that keeps your account safe"
      lede="LinkedIn prospecting is finding the people on LinkedIn who would buy what you sell and starting a one-to-one conversation with each of them. Done well it is seven steps: decide who buys, search on the tier you have, check every profile, exclude and contact each person once, write one note per person, pace the sending, then follow up and book the call."
      faq={FAQ}
      sources={SOURCES}
    >
      <CompareTable caption="LinkedIn prospecting in seven steps, and what each one prevents" columns={["The mistake it prevents"]} rows={STEPS} />

      <p>
        Most prospecting guides are lists of tactics: optimise your profile, join groups, use
        InMail, try Sales Navigator. This one is a sequence, and every step is written from a rule
        Nora enforces in code, because each rule exists to stop something that went wrong for a real
        account. Where we say &ldquo;Nora does X&rdquo;, you can do X by hand with nothing but a
        LinkedIn account and a spreadsheet.
      </p>
      <Callout tone="warning">
        <strong>A word on risk before you start.</strong> As of October 2026, LinkedIn&rsquo;s User
        Agreement and its help page on prohibited software bar bots and automated methods that send
        messages or add contacts. No tool, including ours, can promise an account will never be
        restricted. Everything below lowers the risk; nothing removes it.
      </Callout>

      <h2 id="who-buys">Step 1: decide who buys (not who resembles you)</h2>
      <p>
        The first step of LinkedIn prospecting is the one people rush, and it decides everything
        after it. The usual advice is &ldquo;define your ideal customer profile&rdquo;. The usual
        failure is subtler: you describe a customer using your own vocabulary, and the people who
        share your vocabulary are your peers.
      </p>
      <p>
        We saw this happen inside a single strategy. A business listed networking groups as a
        competitor, and the same document made networking group leaders the top segment to pursue.
        On LinkedIn the two read identically: same titles, same industry, often the same headline.
        A competitor matches an ideal customer profile almost perfectly, which is why no fit score
        will catch it. The score measures resemblance to the profile, and the profile is what is
        wrong.
      </p>
      <p>Two questions separate a buyer from a peer, and every segment should answer both in plain words:</p>
      <ul>
        <li>
          <strong>What do they pay you for?</strong> In their words, not yours. Somebody who sells
          what you sell has no answer.
        </li>
        <li>
          <strong>What do they do about the problem today?</strong> A tool, a spreadsheet, a
          freelancer, or nothing. That is what your offer replaces, and it is the most useful line
          you will ever write in a connection note.
        </li>
      </ul>
      <p>
        Nora&rsquo;s customer profiles carry both fields, and the approval screen compares each
        segment against the competitors your own business profile names. It warns rather than
        blocks, because some companies really do sell to their competitors. The full method,
        with a template, is in our guide to{" "}
        <Link href="/guides/ideal-customer-profile-for-linkedin">building an ideal customer profile for LinkedIn outreach</Link>.
      </p>

      <h2 id="search">Step 2: turn that into a LinkedIn search</h2>
      <p>
        A profile is a description. LinkedIn needs a query, and the translation loses more than
        people expect. Three things decide whether the query returns the people you described.
      </p>

      <h3 id="search-tier">Classic search versus Sales Navigator</h3>
      <p>
        As of October 2026, free LinkedIn search can filter people by keywords, location, industry,
        current and past company, school and connection degree. Sales Navigator, LinkedIn&rsquo;s separate paid seat,
        adds structured filters including seniority, company headcount and job titles to exclude.
        Free search cannot express those three at all. If your profile says &ldquo;directors and
        above at companies of 11 to 50 people&rdquo;, a free account can type
        &ldquo;director&rdquo; as a keyword, which is a hint, not a filter.
      </p>
      <p>
        Free accounts also hit LinkedIn&rsquo;s commercial use limit, a monthly cap on people
        searches that LinkedIn says resets on the first of each calendar month and does not publish
        as a number. As of October 2026, LinkedIn&rsquo;s Premium FAQ says Premium Business, Sales
        Navigator and Recruiter Lite browse without it. Nora searches on whichever tier your account
        actually has, and lists every filter the tier dropped on the campaign before you launch, so a
        list never looks narrower than it is. Our guide to{" "}
        <Link href="/guides/linkedin-prospecting-without-sales-navigator">LinkedIn prospecting without Sales Navigator</Link>{" "}
        covers what you lose and when the seat pays for itself.
      </p>

      <h3 id="search-names">LinkedIn&rsquo;s own location and industry names</h3>
      <p>
        LinkedIn filters places and industries by its own list, not by whatever you type. A
        location of &ldquo;USA&rdquo; or an industry of &ldquo;SaaS&rdquo; has to be matched to an
        entry LinkedIn recognises before it filters anything. In our own search integration, a
        location written as words rather than LinkedIn&rsquo;s id returned nobody at all, with no
        error, which is how our first live campaign found nobody.
      </p>
      <p>
        Industries carry a second trap. LinkedIn replaced its industry list with a longer second
        version (Microsoft&rsquo;s developer reference describes the new codes as available from
        2022; some third-party lists date the rollout to 2023), so an industry name
        from an old playbook may now map to something narrower or differently named. Nora looks up
        every location and industry in LinkedIn&rsquo;s own list first, leaves out any term LinkedIn
        does not have, and tells you on the campaign when a term was searched under a different
        name. By hand: pick from LinkedIn&rsquo;s filter suggestions, never type and hope.
      </p>

      <h3 id="search-or">OR between titles, not spaces</h3>
      <p>
        LinkedIn&rsquo;s keyword box supports Boolean operators: quotes for an exact phrase,
        capitalised <code>OR</code>, <code>AND</code> and <code>NOT</code>, and parentheses to
        group. Its help page says quotes are processed first, then parentheses, then NOT, then AND,
        then OR. The trap is what happens without them. Typing several titles separated by spaces
        asks for profiles containing all of those words, which is almost nobody. A list of titles is
        a list of alternatives and has to be written as one:
      </p>
      <p>
        <code>{'"head of operations" OR "operations director" OR "COO"'}</code>
      </p>
      <p>
        Finally, exclude your first-degree connections. They have already accepted, so they cannot
        be invited, and a campaign that spends its day on them sends nothing.
      </p>

      <h2 id="check-profiles">Step 3: check every profile before it enters a list</h2>
      <p>
        A search result is a lead, not a person you have checked. Before anybody goes on a list,
        someone should be able to open their profile and confirm three things: the role is current,
        the company fits, and the person is the one the search meant.
      </p>
      <p>
        That sounds obvious until a search returns people with no profile address. In our search
        integration, some results arrive without the public link to the person, typically when they
        are outside the searching account&rsquo;s network. They are real people. But a reviewer
        cannot open them, and an invitation costs a slot from a capped daily allowance plus a little
        restriction risk for the sender. So Nora first asks for the full profile, which usually
        supplies the missing address, and only drops the people it still cannot open. The campaign
        reports how many were dropped, rather than quietly shrinking the list.
      </p>
      <p>
        One check worth stealing for a spreadsheet: a link of the form{" "}
        <code>linkedin.com/in/</code> followed by a long internal ID looks like a profile address and
        does not open. Nora&rsquo;s profile check compares the link against the person&rsquo;s
        internal ID for exactly that reason.
      </p>

      <h2 id="contact-once">Step 4: an exclusion list and a contact-once rule</h2>
      <p>
        Two lists protect you from the most embarrassing mistakes in outbound, and both should be
        checked at the moment of sending, not only when the list is built.
      </p>
      <ul>
        <li>
          <strong>The exclusion list:</strong> customers, partners, suppliers, open deals,
          and anyone a colleague promised would not be contacted. Add by
          company name or by profile. Nora checks it immediately before every send, because a
          campaign built this morning already has invitations queued, and a customer added at 10am
          has to stop the 10:05 send.
        </li>
        <li>
          <strong>The contact-once rule:</strong> once anyone in your workspace has invited a
          person, nobody invites them again, from any campaign. A second approach from the same
          company under a different pretext makes the first look like a mail-merge. Two campaigns
          built from the same profile can both pick up one person, so this check also runs right
          before the send, the only moment it has a settled answer.
        </li>
      </ul>
      <p>
        The rule covers invitations, not conversations. Somebody who accepted keeps getting the
        follow-ups they were promised; what never happens is a second, unrelated first contact.
      </p>

      <h2 id="one-note">Step 5: one note per person</h2>
      <p>
        A connection note is the only part of LinkedIn prospecting the prospect actually reads. Keep
        it under {INVITE_NOTE_MAX_CHARS} characters, mention one specific thing from their profile,
        and ask for nothing but the connection. Leave out links: Nora&rsquo;s invite writer drops a
        note that contains one and sends no note instead, because a link in a connection request
        reads as a pitch.
      </p>
      <Callout tone="info">
        <strong>Illustration, not a real prospect.</strong> &ldquo;Hi Priya, saw you took on
        operations at a 40-person logistics firm in March. Curious how you are handling carrier
        onboarding with a team that size. Would be good to connect.&rdquo; One fact from the
        profile, one question, no offer.
      </Callout>
      <p>
        Nora writes one note per prospect from their headline, title, company and about text, and
        records which of those details each note used, so &ldquo;personalised&rdquo; is something
        you can check on the review screen. A note that used none of them is flagged. If the writer
        fails, the campaign falls back to the template you approved and records that it did. For worked
        examples, see our{" "}
        <Link href="/guides/linkedin-connection-request-templates">connection request templates under {INVITE_NOTE_MAX_CHARS} characters</Link>.
      </p>

      <h2 id="pace">Step 6: pace the sending</h2>
      <p>
        LinkedIn does not publish a daily or weekly number. As of October 2026, its help center says invitations get
        restricted when an account sends many in a short time, or when many are ignored, left
        pending or marked as spam, and that support will not lift those restrictions on request.
        So pacing is two things: how many, and how spread out.
      </p>
      <ul>
        <li>
          <strong>How many:</strong> Nora starts every account at{" "}
          {PUBLIC_LIMITS.invitesPerDayStart} invitations a day, counted from its first send rather
          than from when it connected. It is at {CAP_DAY_8} a day after a week, {CAP_DAY_22} after
          three, and {PUBLIC_LIMITS.invitesPerDayMax} after about {PUBLIC_LIMITS.warmupWeeks} weeks,
          with a hard ceiling of {PUBLIC_LIMITS.invitesPerWeek} a week across all campaigns.
          Follow-up messages are capped separately at {PUBLIC_LIMITS.messagesPerDay} a day.
        </li>
        <li>
          <strong>How spread out:</strong> the day&rsquo;s allowance is spread across the working
          hours left, and never closer together than a random gap of {MIN_GAP_MIN} to {MAX_GAP_MIN} minutes. A daily cap
          with no pacing underneath is a burst with a maximum size.
        </li>
        <li>
          <strong>Housekeeping:</strong> invitations still pending after{" "}
          {LINKEDIN_LIMITS.withdrawAfterDays} days are withdrawn, and an account whose acceptance
          rate falls below {PUBLIC_LIMITS.healthyAcceptance}% is flagged for a look at targeting.
        </li>
      </ul>
      <p>
        The reasoning behind every number is on our page about{" "}
        <Link href="/linkedin-automation-limits">LinkedIn connection request limits</Link>.
      </p>

      <h2 id="follow-up">Step 7: follow up, answer and book</h2>
      <p>
        An acceptance is the moment the whole campaign exists for, and most outreach wastes it with
        either silence or a pitch. Nora sends the first message {FOLLOW_MIN} to {FOLLOW_MAX} minutes
        after it sees an acceptance, inside working hours, and that message continues the note rather than
        selling. The offer arrives when they reply, as a single line you approved.
      </p>
      <p>
        From there, answer the question they asked, offer two or three real times rather than
        &ldquo;a quick call sometime&rdquo;, and stop the moment anyone says no. Nora checks every
        reply for an opt-out in code before any model reads it, and a prospect who asks for a
        person is always handed to one. Our guide on{" "}
        <Link href="/guides/book-meetings-from-linkedin">booking meetings from LinkedIn</Link> covers
        the last mile in detail.
      </p>

      <h2 id="statistics">The unsourced statistics you will see quoted, and why we do not repeat them</h2>
      <p>
        Read enough LinkedIn prospecting guides and the same numbers appear in all of them, usually
        without a date or a link. Two are worth tracing.
      </p>
      <ul>
        <li>
          <strong>&ldquo;LinkedIn is 277% more effective for lead generation.&rdquo;</strong> It
          comes from a HubSpot post published in 2012, which compared the visitor-to-lead conversion
          rate of website traffic arriving from LinkedIn (2.74%) with Facebook and Twitter. It says
          nothing about outreach, connection requests or replies, and it is fourteen years old.
        </li>
        <li>
          <strong>&ldquo;Four out of five LinkedIn members drive business decisions.&rdquo;</strong>{" "}
          It is LinkedIn&rsquo;s own marketing claim, repeated by trade press; we could not find
          the research behind it. Even if accurate, it describes members in general, not the people
          who will answer you.
        </li>
      </ul>
      <p>
        Acceptance and reply &ldquo;benchmarks&rdquo; have the same problem: they come from
        vendors&rsquo; own customers, with unpublished samples and definitions. Measure your own
        acceptance rate, reply rate and meetings per hundred invitations instead, and compare an
        angle against another only once both have enough sends to mean something.
      </p>

      <h2 id="nora">Where Nora fits into LinkedIn prospecting</h2>
      <p>
        Nora runs these seven steps for you and leaves three decisions with you: which strategy to
        pursue, which words go out under your name, and when to launch. See{" "}
        <Link href="/how-it-works">how the AI SDR works end to end</Link>, or read the version of
        this guide for{" "}
        <Link href="/for/agencies">agencies</Link>, <Link href="/for/consultants">consultants and coaches</Link>,{" "}
        <Link href="/for/b2b-saas">SaaS founders</Link>,{" "}
        <Link href="/for/professional-services">professional services firms</Link> or{" "}
        <Link href="/for/small-business">small businesses without a sales team</Link>. Every other
        topic is in the <Link href="/guides">LinkedIn outreach guides</Link>. Nora is free while it
        grows, with no card: <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
