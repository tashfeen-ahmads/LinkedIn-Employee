import type { Metadata } from "next";
import Link from "next/link";
import { MIN_SENDS_TO_COMPARE, alwaysHoldsSentence } from "@le/shared";
import { ArticleLayout, articleMeta, type Faq, type Source } from "@/components/article";
import { AudMore, AudNote, AudStats, AudSteps } from "@/components/seo/aud-blocks";
import { FIRST_MONTH_TOTAL, FIRST_MONTH_WEEKS, FOLLOW_UP_MINUTES } from "@/components/seo/aud-first-month";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/for/b2b-saas";

export const metadata: Metadata = articleMeta(PATH);

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
    a: "Yes, if you approve the words that speak for you. In Nora you approve the opening lines and the one-line pitch before anything is sent, and editing a line clears its approval. Each note is written from the recipient's own details rather than a template, you read the list and every note before launch, and replies come to you as drafts unless you switch on autopilot.",
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
      h1="LinkedIn outbound for B2B SaaS founders"
      lede="LinkedIn outreach for SaaS founders is the most direct way to reach buyers before there is a sales team, and the easiest to get wrong at volume. Nora runs founder-led outbound for you: customer profiles from your website, one personal note per buyer and a reply drafted from your own documents for every answer, inside limits that protect the founder's account."
      faq={FAQ}
      sources={SOURCES}
    >
      <AudSteps
        id="decisions"
        title="What the founder still decides"
        intro="Nora takes the searching, the profile checks, the notes, the pacing and the first follow-up. Three things wait for you."
        notes={[
          "Which segment to go after first. A strategy that describes your competitors is flagged before you approve it.",
          "The opener and the one-line pitch a buyer hears when they ask what the product does.",
          "The list and every note. Nothing has gone out before you press the button.",
        ]}
      />

      <h2 id="competitors">Your closest matches are often competitors</h2>
      <p>
        A company building a rival product matches your ideal customer profile almost perfectly:
        same titles, same industry tags, often the same headline. On title match they rank first,
        and they are the last people who should hear your pitch. So every strategy Nora writes has to
        say what the customer would buy and what they use today instead. A buyer on spreadsheets or a
        rival tool is a good target; a company building the same thing is not. The{" "}
        <Link href="/guides/ideal-customer-profile-for-linkedin">ideal customer profile guide</Link>{" "}
        explains the two fields that tell them apart.
      </p>

      <h2 id="note">One note per buyer, from their own profile</h2>
      <p>
        A hundred identical notes cannot tell you which problem buyers care about. Nora writes each
        note from that buyer&rsquo;s headline, role and company, without a link, and shows the
        details it used. For a scheduling tool sold to field service firms:
      </p>
      <AudNote
        to="Ana"
        role="Operations Manager at Quarkwell Heating & Air (a made-up company)"
        text="Hi Ana, saw Quarkwell Heating & Air is hiring two more techs. Adding people is usually when the evening scheduling job gets heavier. Would be good to connect."
        used={["Company", "Hiring post", "Role"]}
      />

      <h2 id="angles">Test the angle, not the wording</h2>
      <p>
        A campaign can split prospects between angles, such as which pain you lead with. They are
        assigned in rotation rather than at random, so the groups stay even, and an angle is only
        called behind once both have at least {MIN_SENDS_TO_COMPARE} sends and the gap is clear. Each
        angle can carry its own follow-ups and its own pitch, so an acceptance and the reply after it
        are measured against the same idea. That is how founder-led outbound turns into something you
        learn from.
      </p>

      <h2 id="replies">Product questions get answers from your documents</h2>
      <p>
        &ldquo;Does it integrate with...&rdquo; answered wrongly reaches a buyer looking exactly like a
        right answer. Nora drafts replies only from your knowledge documents, and a document too long
        to fit is left out whole rather than cut off, so a draft never quotes half a pricing page. By
        default you approve each draft; with autopilot on, clean replies go out on their own.{" "}
        {alwaysHoldsSentence()}
      </p>
      <p>
        The goal can be a demo or a sign-up link. A link campaign never proposes a call, and a demo
        campaign offers real times from your booking page or your own scheduling link. The first
        message after an acceptance goes {FOLLOW_UP_MINUTES.min} to {FOLLOW_UP_MINUTES.max} minutes
        after Nora notices it (acceptances are checked every hour), without a pitch.
      </p>

      <h2 id="limits">Limits on the founder&rsquo;s account</h2>
      <AudStats
        label="Nora's sending limits for every account"
        items={[
          { value: PUBLIC_LIMITS.invitesPerDayStart, label: "Invitations a day at the first send" },
          { value: PUBLIC_LIMITS.invitesPerWeek, label: "Most in any week" },
          { value: PUBLIC_LIMITS.messagesPerDay, label: "Messages a day" },
        ]}
      />
      <p>
        The daily allowance rises to {PUBLIC_LIMITS.invitesPerDayMax} over about{" "}
        {PUBLIC_LIMITS.warmupWeeks} weeks and is spread across your working hours. Co-founders each
        connect their own account with its own caps, and the workspace shares one record of who has
        been contacted. From the first send, a new account can send at most {FIRST_MONTH_TOTAL}{" "}
        invitations in four weeks ({FIRST_MONTH_WEEKS.join(", ")} a week): enough to learn which
        segment and angle respond, too few to burn a market. The reasoning is on the{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits</Link> page.
      </p>

      <h2 id="first-sdr">When to hire your first SDR, and what to hand over</h2>
      <p>
        This is a judgment call, not a formula, but the pattern we would look for is: you can say in
        one sentence who buys and why, the same three objections keep coming up, and there are more
        qualified conversations than you can take. Hire before that and you are asking an SDR to
        discover the pitch rather than run it. Our{" "}
        <Link href="/guides/ai-sdr-vs-human-sdr">AI SDR versus human SDR comparison</Link> sets out
        what each costs and does well.
      </p>
      <p>
        When you do hire, hand over what outbound has taught you: the strategies you approved, the
        pitch lines that held up, which angles won, the exclusion list, and the record of everyone
        already contacted, so your new hire never writes to the same buyer twice. Comparing tools
        first? Read <Link href="/guides/best-ai-sdr-for-linkedin">how to choose an AI SDR for LinkedIn</Link>{" "}
        or <Link href="/how-it-works">how Nora works end to end</Link>.
      </p>
      <AudMore current="/for/b2b-saas" />
    </ArticleLayout>
  );
}
