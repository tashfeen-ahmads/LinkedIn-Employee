import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS, LINKEDIN_LIMITS } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { Gb1Message, NOTE_AIM } from "@/components/seo/gb1-visuals";
import { LINKEDIN_NOTE_LIMITS } from "@/lib/note-check";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/guides/should-you-add-a-note-linkedin";

export const metadata: Metadata = articleMeta(PATH);

/** The worked example. Its count is computed, so the page cannot print a length the text does not have. */
const EXAMPLE_NOTE =
  "Hi Elena, your post on why you stopped gating case studies made me rethink ours, especially the point about shorter sales cycles. Would like to follow your writing.";

const WITHDRAW_DAYS = LINKEDIN_LIMITS.withdrawAfterDays;

const FAQ: readonly Faq[] = [
  {
    q: "Is it better to send a LinkedIn request without a note?",
    a: "It is better than sending a generic note; on that the studies agree. Whether blank beats a genuinely specific note is not settled. If you can name one true thing about the person that explains why you are writing, add it. If all you have is “I’d love to connect”, send the request blank and put the effort into the first message after they accept.",
  },
  {
    q: "Do blank connection requests get accepted more?",
    a: "Some studies say yes, some say there is no difference, and as of October 2026 none settles it. The largest reported dataset, about 20 million requests, found acceptance within a tenth of a point either way. At least one later dataset found that noted requests got more replies once accepted, so a note’s value may show up after the accept button rather than on it.",
  },
  {
    q: "Can a link in a connection note hurt acceptance?",
    a: "We treat it as a near-certain way to read as a sales sequence, and Nora never sends one: a note containing a link is replaced by no note at all. We have not found LinkedIn documentation saying links are penalized, so that is our rule rather than a published LinkedIn behavior. Put links in a later message, after a reply.",
  },
  {
    q: "Should I personalize every connection request?",
    a: "Only where you have something real to say. A note with the name swapped in is not personalized; readers can tell, and it costs more acceptance than a blank request. Free accounts can only add a note to a few requests a month anyway, so spend them on the people where you have a specific reason.",
  },
];

const SOURCES: readonly Source[] = [
  {
    label: "La Growth Machine: Should I add a note to my LinkedIn connection request?",
    url: "https://lagrowthmachine.com/should-i-add-a-note-to-my-linkedin-connection-request/",
  },
  {
    label: "Expandi: LinkedIn acceptance rate in 2026 (reports the Belkins 20M+ study, 26.42% vs 26.37%)",
    url: "https://expandi.io/blog/linkedin-acceptance-rate/",
  },
  {
    label: "Outscore: Average LinkedIn connection acceptance rate in 2026, seven studies compared",
    url: "https://www.connectiontracker.org/guides/average-linkedin-connection-acceptance-rate",
  },
  {
    label: "Botdog: LinkedIn connection request acceptance rates, 16,492 invitations analyzed (2025)",
    url: "https://www.botdog.co/blog-posts/linkedin-acceptance-rates",
  },
  {
    label: "ReactIn: LinkedIn connection request with or without note, 80K+ requests",
    url: "https://www.reactin.io/blog/linkedin-connection-request-with-or-without-note",
  },
  {
    label: "SalesRobot: LinkedIn connection request tips",
    url: "https://www.salesrobot.co/blogs/linkedin-connection-request-tips",
  },
  {
    label: "LinkedIn Help: Withdraw an invitation (no new invitation to the same member for up to three weeks)",
    url: "https://www.linkedin.com/help/linkedin/answer/4800",
  },
  {
    label: "LinkedIn Help: Using the “I don’t know this person” option for invitations",
    url: "https://www.linkedin.com/help/linkedin/answer/a540947/using-the-i-don-t-know-this-person-option-for-invitations",
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="Should you add a note to a LinkedIn connection request?"
      lede="Add a note to a LinkedIn connection request when you can say one specific, true thing about the person; otherwise send it blank. No note beats a generic one, which the studies agree on, and a specific note is the only kind worth the characters."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">The short answer: specific beats blank, blank beats generic</h2>
      <p>
        The question is usually framed as note or no note. The useful split is three ways, because a generic
        note and a specific note are different things that happen to share a text box. Blank beating generic
        is measured; specific beating blank is our judgment, explained below.
      </p>
      <CompareTable
        caption="Which kind of request to send, by situation"
        columns={["Send", "Why"]}
        rows={[
          {
            label: "You read something they wrote, or share a real context",
            values: ["A specific note", "One true detail separates you from every other request that day"],
          },
          {
            label: "Your headline already explains why you would connect",
            values: ["Blank", "The reason is visible without a note; a note adds length, not information"],
          },
          {
            label: "All you could write is “I’d love to connect”",
            values: ["Blank", "A generic note signals a script, which is worse than silence"],
          },
          {
            label: "You want to sell them something",
            values: ["Neither, yet", "Connect first; the offer comes after a conversation starts"],
          },
        ]}
      />

      <h2 id="why-studies-disagree">Why the studies disagree</h2>
      <p>
        If you search this question you will find data pointing in opposite directions, as of October 2026:
      </p>
      <ul>
        <li>
          A study of about 20 million outreach attempts, attributed to Belkins and reported by Expandi, found
          acceptance of 26.42% with a note and 26.37% without: no meaningful difference.
        </li>
        <li>
          A later Belkins dataset, as summarized by other sites, put blank requests slightly ahead (27.6%
          against 25.3%) but found noted requests replied more often after acceptance.
        </li>
        <li>
          Botdog, analyzing 16,492 of its users&rsquo; invitations, reported blank requests accepted 80%
          more often. ReactIn, over 80,000 automated requests, reported a similar gap, with its most specific
          notes narrowing it but not clearly closing it.
        </li>
        <li>
          The opposite claim, that personalized notes are accepted &ldquo;3 to 5 times&rdquo; more often, is
          widely repeated. As of October 2026 we could not trace it to any study: the versions we found cite no
          dataset, or a vendor&rsquo;s test of its own tool. Treat it as unsourced.
        </li>
      </ul>
      <p>None of these is wrong, exactly. They measure different things:</p>
      <ul>
        <li>
          <strong>What a &ldquo;note&rdquo; was.</strong> In datasets drawn from automation tools, most
          notes are templates with a merge field. Those studies compare blank requests with generic notes,
          and generic notes lose. They say little about a note that is actually about the person.
        </li>
        <li>
          <strong>Acceptance or replies.</strong> A note that slightly lowers acceptance but raises replies
          afterward can still be the better choice. Studies that stop at the accept button miss that.
        </li>
        <li>
          <strong>Who was sending.</strong> Each dataset is one vendor&rsquo;s users, with their own targeting
          habits and account types. A tool whose users target well will report higher rates for everything.
        </li>
      </ul>
      <p>
        Read that way, the evidence supports one conclusion and leaves one open. Generic notes do worse than
        blank requests; on that, the datasets agree. Whether a genuinely specific note beats a blank request on
        acceptance has not been measured cleanly by anyone we found. What we would bet on, without a study to
        prove it, is that a specific note helps most after the accept button, when the first message has
        something to continue. How to read these percentages against your own numbers is covered in the{" "}
        <Link href="/guides/linkedin-acceptance-rate">guide to LinkedIn acceptance rates</Link>.
      </p>

      <h2 id="when-blank">When a blank request is the right call</h2>
      <ul>
        <li>
          <strong>You have nothing specific.</strong> Not a post, not a shared group, not a detail in their
          profile that connects to why you are writing. Do not invent one.
        </li>
        <li>
          <strong>Your headline does the work.</strong> A founder of an HR software company connecting with
          HR directors does not need to explain the overlap.
        </li>
        <li>
          <strong>You are on a free account and out of notes.</strong> Free accounts can personalize only a
          few invitations a month, and sources disagree on how many. Blank requests still go.
        </li>
        <li>
          <strong>You would rather spend the words after they accept.</strong> The first message has more room
          than {INVITE_NOTE_MAX_CHARS} characters and arrives to someone who has chosen to hear from you. The{" "}
          <Link href="/guides/linkedin-follow-up-after-connection">first message after acceptance</Link> is
          where a blank request earns its reply.
        </li>
      </ul>

      <h2 id="when-note">When a note on a LinkedIn connection request earns its place</h2>
      <ul>
        <li>
          <strong>The connection would otherwise look random.</strong> Different industry, different
          country, no shared connections: one sentence of context prevents an &ldquo;I don&rsquo;t know this
          person&rdquo; click, which LinkedIn says can restrict your ability to send invitations when it
          happens often.
        </li>
        <li>
          <strong>You have a true, specific reason.</strong> Their post, their talk, a hire they announced, a
          problem their role usually owns. One is enough.
        </li>
        <li>
          <strong>The person is senior or busy.</strong> They get more requests, and a blank one from a
          stranger is the easiest to leave pending.
        </li>
      </ul>
      <p>One example of a note that earns its place, built on a post the person wrote:</p>
      <div className="gb1-stack">
        <Gb1Message>&ldquo;{EXAMPLE_NOTE}&rdquo;</Gb1Message>
        <p className="gb1-msg-meta">
          {EXAMPLE_NOTE.length} of {INVITE_NOTE_MAX_CHARS} characters. Uses: one post, and one point inside it.
        </p>
      </div>
      <p>
        Short is the point: aim for {NOTE_AIM.low} to {NOTE_AIM.high} characters at most and
        never pass {INVITE_NOTE_MAX_CHARS}, which is the free-account limit (the{" "}
        <Link href="/guides/linkedin-connection-note-character-limit">connection note character limit guide</Link>{" "}
        explains why {LINKEDIN_NOTE_LIMITS.premium} is not safe), and check it with the{" "}
        <Link href="/tools/connection-note-checker">connection note checker</Link>. The{" "}
        <Link href="/guides/linkedin-connection-request-templates">connection request templates</Link> show
        the shape by situation.
      </p>

      <h2 id="mistakes">Mistakes that cost acceptances</h2>

      <h3 id="link-in-note">A link in the note</h3>
      <p>
        A link from a stranger is the clearest sign that the request is step one of a funnel. Some guides
        go further and say LinkedIn penalizes links in invitations; we have not found LinkedIn documentation
        that says so, and we do not need it to. In Nora, every note is checked for a link in code before it
        is sent, and a note containing one is not trimmed into a broken sentence: the invitation goes with no
        note at all. Links belong in a later message, after the person has replied.
      </p>

      <h3 id="pitch-in-note">A pitch in the note</h3>
      <p>
        &ldquo;We help agencies like yours grow pipeline&rdquo; is an advert in a text box meant for a reason
        to connect. People accept peers and ignore adverts, so keep the offer for after they reply.
        Nora&rsquo;s note writer is instructed not to pitch, not to make claims about the
        product, and not to state anything about the person it was not given.
      </p>

      <h3 id="reinvite-withdrawn">Re-inviting someone you withdrew</h3>
      <p>
        Withdrawing old, unanswered invitations is good hygiene: pending requests that never resolve drag on
        an account. But LinkedIn&rsquo;s help center says that after you withdraw an invitation, you cannot
        invite the same person again for up to three weeks. It is tempting to re-invite the day the wait
        ends, with the same note. Someone who ignored you once usually ignores you twice, and a second request reads as
        pressure. Nora withdraws invitations still pending after {WITHDRAW_DAYS} days and never invites that
        person again.
      </p>

      <h3 id="second-campaign">Messaging the same person from a second campaign</h3>
      <p>
        This one is easy to do by accident. Two campaigns built from overlapping lists both contain the same
        person, and they get two requests, or a request and then a message under a different pretext. It
        makes the first contact look like a mail merge after the fact. Nora records the first contact with
        every person and checks it immediately before each invitation, across every campaign in the
        workspace. Anyone already contacted is closed with a reason rather than invited again.
      </p>

      <p>
        Nora writes one note per person from that person&rsquo;s own profile, names the details each note
        used, and flags the ones it could find nothing specific for; you read every note before launch, and
        each account starts at {PUBLIC_LIMITS.invitesPerDayStart} invitations a day. No tool can make LinkedIn
        automation risk-free, since LinkedIn&rsquo;s user agreement prohibits it. See{" "}
        <Link href="/how-it-works">how Nora works</Link> for the guards we use, and more in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>
    </ArticleLayout>
  );
}
