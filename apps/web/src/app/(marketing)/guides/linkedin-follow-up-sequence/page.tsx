import type { Metadata } from "next";
import Link from "next/link";
import {
  DEFAULT_WORKING_HOURS,
  FIRST_STEP_TIMING_LABEL,
  INVITE_NOTE_MAX_CHARS,
  LINKEDIN_LIMITS,
  OPT_OUT_PHRASES,
} from "@le/shared";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

const PATH = "/guides/linkedin-follow-up-sequence";

export const metadata: Metadata = articleMeta(PATH);

const WAIT_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / 60_000);
const WAIT_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / 60_000);
const HOURS = `${DEFAULT_WORKING_HOURS.start}:00 to ${DEFAULT_WORKING_HOURS.end}:00`;

const FAQ: readonly Faq[] = [
  {
    q: "How many follow-ups should you send on LinkedIn?",
    a: "After the first message, one or two, rarely three. Each needs a new reason to exist; when you have run out of new things to say, stop. The popular claim that most sales need five or more follow-ups traces back, in the one account we found, to a 1942 survey of fewer than 40 people, long before LinkedIn existed.",
  },
  {
    q: "How long should you wait to follow up on LinkedIn?",
    a: `The first message goes within hours of acceptance; Nora sends it ${WAIT_MIN} to ${WAIT_MAX} minutes after noticing. After that, wait several working days, and make each gap longer than the last, say four days, then a week. Measure every wait from the last message actually sent, not from when the campaign started.`,
  },
  {
    q: "Is it rude to follow up on LinkedIn?",
    a: "One or two polite follow-ups are normal and often welcome: people miss messages. What reads as rude is volume, guilt (\"I haven't heard back\"), contentless bumps, and carrying on after a no. If each message gives a new reason to reply and the sequence ends gracefully, following up is courteous persistence.",
  },
  {
    q: "Do breakup messages work on LinkedIn?",
    a: "A short, honest last message that makes one clear ask and closes the loop often gets a reply, because it is easy to answer. Guilt-trip breakups (\"I guess this isn't a priority\") can get a reply too, but at the cost of goodwill. End by making the ask and leaving the door open.",
  },
  {
    q: "How do I avoid contacting the same lead twice?",
    a: "Keep one record of everyone you have contacted, across every campaign and every teammate, and check it immediately before each invitation is sent, not only when a list is built. Lists overlap, and two campaigns can queue the same person before either sends. Nora checks that record at the moment of sending.",
  },
];

const SOURCES: readonly Source[] = [
  {
    label: "PhantomBuster: LinkedIn follow-up sequence",
    url: "https://phantombuster.com/blog/social-selling/linkedin-follow-up-sequence/",
  },
  {
    label: "SalesRobot: LinkedIn follow-up templates (Day 1, 4, 9 and 14 cadence)",
    url: "https://www.salesrobot.co/blogs/linkedin-follow-up-templates",
  },
  {
    label: "SalesRobot: LinkedIn follow-up sequence",
    url: "https://salesrobot.co/blogs/linkedin-follow-up-sequence",
  },
  {
    label: "Snov.io: LinkedIn follow-up message",
    url: "https://snov.io/blog/linkedin-follow-up-message",
  },
  {
    label: "Carly: Sales follow-up statistics (traces the '80% after five follow-ups' claim to a 1942 survey)",
    url: "https://www.usecarly.com/blog/sales-follow-up-statistics/",
  },
  {
    label: "LinkedIn Help: Prohibited software and extensions",
    url: "https://www.linkedin.com/help/linkedin/answer/a1341387",
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="A LinkedIn follow-up sequence that reads like a conversation"
      lede="A good LinkedIn follow-up sequence is short: the invitation, a two-sentence message within hours of acceptance, then one or two follow-ups spaced further apart, each measured from the last message actually sent. It stops the moment they reply, say no or ask you to stop, and nobody it reached is ever started on a second sequence."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="sequence">The LinkedIn follow-up sequence, step by step</h2>
      <CompareTable
        caption="A LinkedIn follow-up sequence that reads like a conversation"
        columns={["When", "What it does"]}
        rows={[
          { label: "Invitation", values: ["Day 0", `One specific reason to connect, or no note; under ${INVITE_NOTE_MAX_CHARS} characters, no link, no pitch`] },
          { label: "First message", values: ["Within hours of acceptance", "Continues the reason, asks one easy question"] },
          { label: "Follow-up", values: ["Several working days later", "A new reason to reply: a specific observation or a useful question"] },
          { label: "Last message", values: ["About a week after that", "Makes the campaign's one ask, then closes the loop"] },
        ]}
      />

      <h3 id="invitation">Invitation</h3>
      <p>
        The sequence starts with a connection request, and the request sets the thread everything after it
        continues. Give one true, specific reason, or send it blank if you have none. No link and no pitch: the
        request earns the connection, not the sale. The{" "}
        <Link href="/guides/linkedin-connection-request-templates">connection request templates</Link> show
        notes that set up a natural second message.
      </p>

      <h3 id="first-message">First message after acceptance</h3>
      <p>
        This is the message most sequences get wrong, by putting it on the same schedule as everything else.
        There is no previous message to measure a delay from; there is the acceptance, which is the moment the
        person is most likely to answer. In Nora this step is not configurable at all: it goes{" "}
        {FIRST_STEP_TIMING_LABEL}, {WAIT_MIN} to {WAIT_MAX} minutes after Nora notices, inside working hours.
        Two sentences, one question, no pitch. The{" "}
        <Link href="/guides/linkedin-follow-up-after-connection">guide to the first message after acceptance</Link>{" "}
        has examples by situation.
      </p>

      <h3 id="measured-from-last">Follow-ups measured from the last real message</h3>
      <p>
        Every later step waits a set number of days measured from the message before it, not from launch day.
        That sounds obvious, but it is what keeps a sequence sane when something is delayed: if the first
        message went a day late, the follow-up moves with it instead of arriving the next morning. In Nora each
        step after the first keeps the delay the person who approved the campaign chose, and a step whose time
        has not come is never pulled forward, even when a stalled prospect is put back on schedule.
      </p>

      <h2 id="how-long-to-wait">How long to wait between follow-ups</h2>
      <p>
        Published cadences, as of October 2026, cluster around a fortnight. A widely copied one sends on days
        1, 4, 9 and 14: a connection message, a value-add with no ask, a soft ask, and a break-up. Other guides
        suggest three to five business days between messages. Those are reasonable, with two adjustments:
      </p>
      <ul>
        <li>
          <strong>Day 1 should be hours, not a day.</strong> See above: the first message works because it
          follows the acceptance closely.
        </li>
        <li>
          <strong>Make the gaps grow.</strong> Four working days, then about a week. A shrinking or constant
          gap reads like a machine with a timer; a growing one reads like a person who did not want to be a
          nuisance.
        </li>
        <li>
          <strong>Count working days, in their time zone.</strong> A follow-up landing on Saturday morning is
          either ignored or resented. Nora only sends inside the rep&rsquo;s working hours, by default{" "}
          {HOURS} on weekdays.
        </li>
      </ul>
      <p>
        Volume matters as much as spacing. Every message counts toward a daily cap of{" "}
        {PUBLIC_LIMITS.messagesPerDay} per account in Nora, follow-ups and replies together, so a large campaign
        never turns into a morning burst of identical-looking follow-ups.
      </p>

      <h2 id="how-many">How many follow-ups: the myth stat and a stopping rule</h2>
      <p>
        Many guides push five to eight follow-ups on the strength of a statistic: 80% of sales need five or more
        follow-ups. It is repeated everywhere, usually without a source. The one attempt we found to trace it
        reports that it goes back to a 1942 survey of a single local chapter of a sales executives association,
        with fewer than 40 respondents. That is one secondary account, but we found
        no primary study behind the number either. It is not evidence for anything on LinkedIn.
      </p>
      <p>A better rule is about content, not count:</p>
      <ol>
        <li>Each follow-up must give a new reason to reply. &ldquo;Just bumping this&rdquo; is not one.</li>
        <li>When you have nothing new to say, the sequence is over.</li>
        <li>After the first message, that is usually one or two follow-ups.</li>
      </ol>
      <p>
        Nora&rsquo;s campaigns are written as a connection note plus two or three follow-ups, and the sequence
        cannot run past three messages after an acceptance. When a campaign tests several angles, each angle
        owns its own sequence end to end; when its sequence runs out, it is finished, rather than falling
        through to another angle&rsquo;s step in a different voice.
      </p>

      <h2 id="breakup">The last message (breakup) that keeps the door open</h2>
      <p>
        The last message has one job: make the campaign&rsquo;s ask clearly, once, and make it easy to say yes,
        no or not now. It is not a guilt trip and not a fake goodbye. Nora&rsquo;s writer is told that the final
        follow-up makes the campaign&rsquo;s ask and nothing else, never &ldquo;just bumping this up&rdquo;,
        never guilt. Two shapes that work:
      </p>
      <blockquote>
        <p>
          Last note from me on this, Sam. If tightening up how referrals are tracked is on your list this
          quarter, I would be glad to show you how other studios do it in 20 minutes. If not, no problem at
          all.
        </p>
      </blockquote>
      <blockquote>
        <p>
          I will leave it here. If the hiring plan changes and outbound becomes a priority, I am easy to find.
          Good luck with the launch next month.
        </p>
      </blockquote>
      <p>
        The ask depends on the campaign. It might be a meeting, a link to a page or simply a reply. If it is a
        meeting, offer real times rather than &ldquo;a quick call sometime&rdquo;; the{" "}
        <Link href="/guides/book-meetings-from-linkedin">guide to booking meetings from LinkedIn</Link> covers
        that step.
      </p>

      <h2 id="when-to-stop">When to stop immediately</h2>
      <p>
        Any reply stops the automated sequence. From that point it is a conversation, answered as one, and no
        scheduled follow-up should arrive on top of it. Two kinds of reply end the outreach entirely.
      </p>

      <h3 id="opt-out">Opt-out phrases</h3>
      <p>
        Sending another message after &ldquo;remove me&rdquo; is the one mistake outreach cannot make. Nora does
        not leave that to a language model&rsquo;s judgement: every reply is checked against a fixed list of
        phrases before anything else happens, and a match stops all contact with that person for good. The list
        it matches, case-insensitively:
      </p>
      <ul>
        {OPT_OUT_PHRASES.map((phrase) => (
          <li key={phrase}>&ldquo;{phrase}&rdquo;</li>
        ))}
      </ul>
      <p>
        A model also reads each reply, so an opt-out phrased some other way is caught too. But the fixed list
        means the obvious cases never depend on the model getting it right.
      </p>

      <h3 id="clear-no">A clear no</h3>
      <p>
        &ldquo;Thanks, but we are happy with what we have&rdquo; is not an opt-out, but it is an answer. Nora
        closes the sequence when a reply is read as not interested, and depending on the workspace&rsquo;s
        rules, negative replies can be held for a person to read before anything else is said. A gracious
        one-line acknowledgement is fine; a rebuttal is not.
      </p>

      <h2 id="never-twice">Never contact the same person twice, even from another campaign</h2>
      <p>
        The second sequence is where well-run outreach quietly goes wrong. A business runs several campaigns,
        their lists overlap, and someone who ignored a request in spring gets another in autumn under a
        different pretext. It makes the first message look like a mail merge in hindsight, and to the person it
        is simply being chased.
      </p>
      <p>
        Nora keeps one record per person of when they were first contacted, and checks it immediately before
        every invitation is sent, across every campaign in the workspace. Checking only when a list is built is
        not enough: two campaigns built from the same customer profile can both queue the same person before
        either has sent anything. Anyone already contacted is closed with a reason, visible on the list, rather
        than quietly dropped. The rule only blocks a second invitation; it never stops a conversation already
        under way from continuing.
      </p>
      <p>
        That is also the respectful reading of data and consent rules. The{" "}
        <Link href="/guides/is-linkedin-automation-legal">guide to whether LinkedIn automation is legal</Link>{" "}
        covers the user agreement and privacy side, including the fact that LinkedIn&rsquo;s user agreement
        prohibits automated activity and no tool can remove that risk entirely.
      </p>

      <Callout tone="safety">
        Nora writes the sequence, sends the first message within hours of acceptance, stops at a reply or an
        opt-out, and never starts a second sequence with anyone. See <Link href="/how-it-works">how Nora works</Link>,
        or <a href={`${SITE.app}/signup`}>Sign up free</a>. No card. More in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>.
      </Callout>
    </ArticleLayout>
  );
}
