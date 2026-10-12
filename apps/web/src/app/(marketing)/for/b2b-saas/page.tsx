import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, MIN_SENDS_TO_COMPARE, YOUR_DECISIONS } from "@le/shared";
import { ArticleLayout, Callout, articleMeta, type Faq, type Source } from "@/components/article";
import { FIRST_MONTH_TOTAL, FIRST_MONTH_WEEKS, FOLLOW_UP_MINUTES } from "@/components/seo/aud-first-month";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/for/b2b-saas";

export const metadata: Metadata = articleMeta(PATH);

const [STRATEGY, WORDS, LAUNCH] = YOUR_DECISIONS;

const FAQ: readonly Faq[] = [
  {
    q: "How should a founder do outbound on LinkedIn?",
    a: "Pick one segment that has the problem today, write to each person about something specific to them, and keep the pitch for when they reply. Send a steady amount every working day rather than in bursts, and read every reply yourself at first: early outbound is as much about learning what buyers say as about booking demos.",
  },
  {
    q: "When should a founder hire the first SDR?",
    a: "Usually once the founder can say in one sentence who buys and why, the same objections keep coming up, and there are more qualified conversations than the founder can take. Before that, an SDR is asked to discover the pitch rather than run it. Hand over the approved segments, the pitch, and the record of who has already been contacted.",
  },
  {
    q: "Does LinkedIn automation get founder accounts restricted?",
    a: `It can. LinkedIn's User Agreement prohibits automated access, and no tool can promise zero risk. Restrictions follow volume, bursts and invitations to people who do not know you. Nora keeps volume low (${PUBLIC_LIMITS.invitesPerDayStart} a day at first, never more than ${PUBLIC_LIMITS.invitesPerWeek} a week), spreads each day's sends and flags the account if acceptance drops below ${PUBLIC_LIMITS.healthyAcceptance}%.`,
  },
  {
    q: "Can I keep my own voice in automated messages?",
    a: "Yes, if you approve the words that speak for you. In Nora you approve the opening lines and the one-line pitch before anything is sent, and editing a line clears its approval. Each note is written from the recipient's own details rather than a template, and you read the list and every note before launch.",
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
      h1="LinkedIn outreach for SaaS founders: founder-led outbound for B2B"
      lede="LinkedIn outreach for SaaS founders is the most direct way to reach buyers before there is a sales team, and the easiest to get wrong at volume. Nora runs founder-led outbound for you: customer profiles from your website, one personal note per buyer, replies answered from your own documents and demos booked, inside limits that protect the founder's account."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="different">Why LinkedIn outreach for SaaS founders is different</h2>
      <p>
        Early SaaS sales are founder-led because the founder is the only person who can explain the
        product and hear what buyers say back. LinkedIn is where those buyers list their title,
        company and size. Three things make LinkedIn outreach for SaaS founders harder than it looks.
      </p>
      <ul>
        <li>
          <strong>Your best-matching prospects are often competitors.</strong> A company building a
          rival product matches your ideal customer profile almost perfectly: same titles, same
          industry tags, often the same headline. On title match they rank top, and they are the
          last people who should hear your pitch.
        </li>
        <li>
          <strong>Templates teach you nothing.</strong> A hundred identical notes cannot tell you
          which problem buyers care about, and falling acceptance gets blamed on the market rather
          than the message.
        </li>
        <li>
          <strong>Product questions need real answers.</strong> &ldquo;Does it integrate
          with...&rdquo; answered wrongly reaches a buyer looking exactly like a right answer.
        </li>
      </ul>

      <h2 id="founder-led">Founder-led sales without spending the day in LinkedIn</h2>
      <p>
        Founder-led sales does not have to mean the founder doing the clerical part. Nora takes
        the searching, the profile checks, the notes, the pacing, the first follow-up and the
        routine replies. You keep the decisions that shape what buyers hear:
      </p>
      <ol>
        <li>
          <strong>{STRATEGY.title}.</strong> Choose which segment to go after first. Nothing is
          searched until you do.
        </li>
        <li>
          <strong>{WORDS.title}.</strong> The opening lines and the one-line pitch a buyer hears
          when they ask what the product does.
        </li>
        <li>
          <strong>{LAUNCH.title}.</strong> Read the list and the notes, remove anyone you know, and
          launch. {LAUNCH.because}
        </li>
      </ol>
      <p>
        A campaign can also test angles, such as which pain you lead with. Prospects are split in
        rotation, not at random, so groups stay even, and an angle is only called behind once both
        have at least {MIN_SENDS_TO_COMPARE} sends and the gap is clear. That is how founder-led
        outbound turns into something you learn from.
      </p>

      <h2 id="first-sdr">When to hire your first SDR, and what to hand over</h2>
      <p>
        This is a judgement, not a formula, but the pattern we would look for is: you can say in one
        sentence who buys and why, the same three objections keep coming up, and there are more
        qualified conversations than you can take. Hire before that and you are asking an SDR to
        discover the pitch rather than run it. Our{" "}
        <Link href="/guides/ai-sdr-vs-human-sdr">AI SDR versus human SDR comparison</Link> sets out
        what each costs and does well.
      </p>
      <p>
        When you do hire, hand over what outbound has taught you: the strategies you approved and
        why, the pitch lines that held up, which angles won, the exclusion list, and the record of
        everyone already contacted, so your new hire never writes to the same buyer twice.
      </p>

      <h2 id="how">How it works for you</h2>

      <h3 id="strategy">A strategy from your website</h3>
      <p>
        Nora reads your website and proposes customer strategies: who has the problem, what they
        would buy and what they use instead today. A buyer on spreadsheets or a rival tool is a good
        target; a company building the same thing is not, and if a strategy matches a competitor you
        named, the approval screen says so. The{" "}
        <Link href="/guides/ideal-customer-profile-for-linkedin">ideal customer profile guide</Link>{" "}
        explains the two fields that tell them apart.
      </p>

      <h3 id="notes">One note per person, in your voice</h3>
      <p>
        Each note is written from that buyer&rsquo;s headline, role and company, under{" "}
        {INVITE_NOTE_MAX_CHARS} characters and without a link, with the details it used shown. An
        invented example for a scheduling tool sold to field service firms:
      </p>
      <blockquote>
        <p>
          &ldquo;Hi Ana, saw Northside Mechanical is hiring two more techs. Adding people is usually
          when the evening scheduling job gets heavier. Would be good to connect.&rdquo;
        </p>
      </blockquote>

      <h3 id="replies">Replies answered, calls booked</h3>
      <p>
        The first message goes {FOLLOW_UP_MINUTES.min} to {FOLLOW_UP_MINUTES.max} minutes after an
        acceptance is seen, without a pitch. Replies are answered only from your knowledge
        documents, and a document too long to fit is left out whole rather than cut off, so the
        agent never answers from half a pricing page. The goal can be a demo or a sign-up link; a
        link campaign never proposes a call, and a draft containing a link the agent was not given
        is held for you.
      </p>

      <h2 id="limits">The limits that protect your profile</h2>
      <p>
        {PUBLIC_LIMITS.invitesPerDayStart} invitations a day from the first send, rising to{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks, never more
        than {PUBLIC_LIMITS.invitesPerWeek} a week, spread across your working hours. Co-founders
        each connect their own account with its own caps, and the workspace shares one record of
        who has been contacted. The reasoning is on the{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits</Link> page.
      </p>

      <h2 id="first-month">What to expect in the first month</h2>
      <p>
        From the first send, a new account can send at most {FIRST_MONTH_TOTAL} invitations in four
        weeks ({FIRST_MONTH_WEEKS.join(", ")} a week). That is enough to learn which segment and
        which angle respond, and too few to burn a market. We will not quote you a demo rate; your
        own funnel shows it, and if acceptance drops below {PUBLIC_LIMITS.healthyAcceptance}%, look
        at the strategy first.
      </p>
      <Callout tone="info">
        Comparing tools? Read <Link href="/guides/best-ai-sdr-for-linkedin">how to choose an AI SDR for LinkedIn</Link>.
      </Callout>
      <p>
        See <Link href="/how-it-works">how Nora works end to end</Link>, or the versions of this
        page for <Link href="/for/agencies">agencies</Link> and{" "}
        <Link href="/for/consultants">consultants</Link>. Back to the{" "}
        <Link href="/">Nora home page</Link>. Nora is free while it grows:{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
