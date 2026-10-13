import type { Metadata } from "next";
import Link from "next/link";
import { DEFAULT_WORKING_HOURS, LINKEDIN_LIMITS, PITCH_MAX_CHARS } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { Gb1Pairs, Gb1Situations, clock } from "@/components/seo/gb1-visuals";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/guides/linkedin-follow-up-after-connection";

export const metadata: Metadata = articleMeta(PATH);

const MINUTE_MS = 60_000;
/** The window Nora waits after noticing an acceptance, from the constants the worker uses. */
const WAIT_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / MINUTE_MS);
const WAIT_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / MINUTE_MS);
const HOURS = `${clock(DEFAULT_WORKING_HOURS.start)} to ${clock(DEFAULT_WORKING_HOURS.end)}`;

const FAQ: readonly Faq[] = [
  {
    q: "How soon should you message after a LinkedIn connection is accepted?",
    a: `Within a few hours, while they still remember clicking Accept, but not in the same minute, which reads as a script. Nora checks for new connections every hour and writes ${WAIT_MIN} to ${WAIT_MAX} minutes after it notices one, inside working hours, so the message usually lands within a couple of hours. Many guides say one to two days; by then the request is one of several they accepted that week.`,
  },
  {
    q: "What do you say after someone accepts your LinkedIn request?",
    a: "Two sentences. Pick up the reason your request gave, or give one if it was blank, and ask a single easy question about their work. No product, no link, no meeting request. The only job of this message is to get a reply, and a question they can answer in one line does that best.",
  },
  {
    q: "Should I say thanks for connecting on LinkedIn?",
    a: "A short thank-you is polite, but on its own it is filler: it gives the other person nothing to answer. If you open with thanks, follow it in the same message with the reason you reached out and one question. That turns a courtesy into the start of a conversation.",
  },
  {
    q: "Is it okay to pitch in the first message?",
    a: "No. A pitch seconds or hours after someone accepts tells them the request was the first step of a sales sequence, and they treat it like an advert. Ask about their situation first. The pitch belongs in your reply once they have answered and you know whether it is relevant to them.",
  },
  {
    q: "How do I reply to 'thank you for connecting'?",
    a: "Answer the thanks in a few words, then give the conversation somewhere to go: one specific question about their role, their company or something they posted. “Likewise. Are you still running the partner program on your own, or has it grown a team?” is enough. Avoid replying with a pitch or a calendar link.",
  },
];

const SOURCES: readonly Source[] = [
  {
    label: "PhantomBuster: LinkedIn follow-up messages, turning first connections into conversations (suggests 24 to 48 hours)",
    url: "https://phantombuster.com/blog/outbound-sales/linkedin-follow-up-messages-how-to-turn-first-connections-into-real-conversations/",
  },
  {
    label: "Skylead: LinkedIn follow-up message",
    url: "https://skylead.io/blog/linkedin-follow-up-message/",
  },
  {
    label: "Skylead: Thank you for connecting on LinkedIn (templates, updated October 2025)",
    url: "https://skylead.io/blog/linkedin-thank-you-message/",
  },
  {
    label: "Sendspark: LinkedIn follow-up message",
    url: "https://blog.sendspark.com/linkedin-follow-up-message",
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
      h1="The first message after a LinkedIn connection is accepted"
      lede="The best follow-up message after a LinkedIn connection is accepted goes out within a few hours, runs two sentences, picks up the reason your request gave, and asks for nothing bigger than a reply. The pitch waits until they answer."
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">The short answer: soon, short, no pitch</h2>
      <p>
        Most advice on this message is about what to write. The bigger mistakes are about timing and
        ambition: sending it days later, and asking it to do the selling. Here is the whole rule set on
        one screen.
      </p>
      <CompareTable
        caption="The first message after acceptance, in short"
        columns={["Do", "Avoid"]}
        rows={[
          { label: "When", values: ["Within a few hours, inside working hours", "Three days later, or the same second"] },
          { label: "Length", values: ["Two sentences", "A paragraph with a case study"] },
          { label: "Content", values: ["Continue the reason the request gave", "Starting over as if they were a stranger"] },
          { label: "Ask", values: ["One easy question about their work", "A call, a demo or a link"] },
          { label: "Pitch", values: ["After they reply", "In this message"] },
        ]}
      />

      <h2 id="how-soon">How soon: why three days is too late</h2>
      <p>
        Many guides, as of October 2026, put this message at one to two days, or 24 to 48 hours. The reasoning is that waiting looks less automated. We
        think that trades the one advantage you have for a cosmetic one. When someone accepts, they have
        just read your note and decided you were worth connecting to. A day later they have accepted other
        requests, and your message arrives as one more name.
      </p>
      <p>
        We learned this in our own product: an early version of Nora waited three days before the first
        message, people who accepted heard nothing until they had forgotten the request, and the first
        step is now timed from the acceptance and cannot be set back to days.
      </p>

      <h3 id="window">
        {WAIT_MIN} to {WAIT_MAX} minutes, inside working hours
      </h3>
      <p>
        &ldquo;As soon as they accept&rdquo; does not mean the same second. A reply that lands the moment
        someone clicks Accept is a robot announcing itself, both to the person and to LinkedIn. So Nora
        waits a random {WAIT_MIN} to {WAIT_MAX} minutes after it notices the acceptance, which reads as a
        person who saw the notification and got around to it. Nora checks for new connections every hour,
        so in practice the message usually lands within a couple of hours of the click.
      </p>
      <p>
        The working-hours check applies on top. Somebody who accepts at three in the morning is written to
        in the morning, not at 3:20 a.m. By default that window is {HOURS} on weekdays in the
        rep&rsquo;s time zone. Every message also counts against a daily cap of{" "}
        {PUBLIC_LIMITS.messagesPerDay} messages per account, follow-ups and replies together.
      </p>

      <h2 id="what-to-say">What to say in the first message</h2>
      <p>
        Continue the thread the note started. Your connection request gave a reason, or it should have. The first message is the second line of
        that same conversation, not a new opener. Three parts, in two sentences:
      </p>
      <ol>
        <li>
          <strong>The thread.</strong> Refer back to the reason in your note: their post, the event, the
          hire, the shared problem. One clause is enough.
        </li>
        <li>
          <strong>Why you are writing.</strong> Say plainly what you are curious about. People forgive a
          clear purpose far faster than a vague one.
        </li>
        <li>
          <strong>One question they can answer quickly.</strong> About them, not about your product. Yes or
          no, or a short fact about how they work.
        </li>
      </ol>
      <p>
        Leave out your company description, results, numbers and links. A link in the first message after
        an acceptance is the pattern that most clearly reads as a sequence, and Nora&rsquo;s writer is
        told never to put one there. If you want templates for the request itself, the{" "}
        <Link href="/guides/linkedin-connection-request-templates">connection request templates by situation</Link>{" "}
        are written to set up exactly this kind of follow-up.
      </p>

      <h2 id="examples">Examples by situation</h2>
      <p>
        Each example is a starting shape, not text to paste. The specific detail is what makes it work, and
        a detail only works if it is true.
      </p>

      <Gb1Situations
        items={[
          {
            id: "after-post",
            title: "After a note about their post",
            when: <>Your note mentioned something they wrote. Continue it with a question the post left open.</>,
            message:
              "Thanks for connecting, Dana. Your post said you moved client onboarding to async video: did that survive the bigger accounts, or do those still get a kickoff call?",
          },
          {
            id: "after-blank",
            title: "After a blank request",
            when: <>No note means no thread yet, so this message supplies the reason the note would have given. Keep it just as short.</>,
            message:
              "Thanks for accepting, Marco. I reached out because you run partnerships at a 30-person agency, and I am curious: are referrals still tracked by hand at that size, or is there a system for it now?",
          },
          {
            id: "accepted-at-night",
            title: "When they accepted at night",
            when: <>Do not reply at 11 p.m. because the notification arrived then. Write the next working morning, and do not mention the hour: it adds nothing and reads as surveillance.</>,
            message:
              "Good to be connected, Priya. You mentioned hiring two SDRs this quarter: are they starting on LinkedIn, email, or both?",
          },
          {
            id: "after-event",
            title: "After an event you both attended",
            when: <>The event is the thread. Name the session or the conversation, not just the event&rsquo;s name.</>,
            message:
              "Glad we connected after the Austin ops meetup, Lena. You said on the panel that dispatch was your bottleneck: is that still true now the busy season is over?",
          },
          {
            id: "mutual-connection",
            title: "Through a mutual connection",
            when: <>Only name the person in common if they know you both and are happy to be named. Then the message says why they thought you should talk.</>,
            message:
              "Thanks for connecting, Omar. Jess mentioned you rebuilt the referral program at Calder last year: was that mostly a tracking problem or a rewards problem?",
          },
          {
            id: "they-invited-you",
            title: "When they invited you",
            when: <>If they sent the request, they had a reason. Ask for it, warmly, instead of guessing and pitching.</>,
            message:
              "Thanks for the invite, Hannah. I see you run growth at a clinic group in Phoenix: what made you reach out, and is there something I can help with?",
          },
          {
            id: "role-change",
            title: "After a role change",
            when: <>If your note congratulated a new role, the first message can ask about the first weeks in it. Keep it about the job, not about you.</>,
            message:
              "Good to be connected, Tyler. Three weeks into running RevOps at Hartline, what has surprised you most so far?",
          },
          {
            id: "no-reply-nudge",
            title: "A nudge when they have not replied",
            when: <>If the first message gets no answer, wait several working days, then send one short message with a new reason to reply. Never &ldquo;just bumping this&rdquo;.</>,
            message:
              "One more thought, Dana: a few agencies I talk to split onboarding by account size instead. Is that something you have tried?",
          },
        ]}
      />
      <p>
        Notice what none of these do: none names a product, offers a call, or asks for fifteen minutes.
        Each can be answered in a line.
      </p>

      <h2 id="thanks-for-connecting">&lsquo;Thanks for connecting&rsquo; messages that are not filler</h2>
      <p>
        &ldquo;Thanks for connecting!&rdquo; on its own is a closed loop. It is polite, it asks nothing,
        and the most natural reply is no reply. Advice on this message often mixes job-seeker tips with
        sales tips, but the fix is the same for both: thanks is fine as the first three
        words, as long as the rest of the message gives them something to answer.
      </p>
      <Gb1Pairs
        label="A filler thank-you beside one that gives them something to answer"
        items={[
          {
            key: "thanks",
            left: { label: "Filler", text: "Thanks for connecting! Looking forward to learning from your content." },
            right: {
              label: "Not filler",
              text: "Thanks for connecting. Is the hybrid team you wrote about still split across two offices, or did you consolidate?",
            },
          },
        ]}
      />
      <p>
        If they send the thanks first, the same rule applies to your reply. Acknowledge it in a few words,
        then ask one question about them. Replying to &ldquo;thank you for connecting&rdquo; with a pitch
        wastes the most open moment the conversation will have.
      </p>

      <h2 id="when-to-pitch">When the pitch comes: after they reply</h2>
      <p>
        The pitch belongs in your answer to their reply, when you know something about their situation and
        they have chosen to keep talking. Sent before that, it is an advert attached to a connection
        request. Sent after, it is a response to what they said.
      </p>
      <p>
        That is how Nora is built. The first message after acceptance never pitches. When the prospect
        replies, Nora drafts the answer for you to approve, built on a pitch line someone in the workspace
        has read and approved, kept to {PITCH_MAX_CHARS} characters because it is read in a chat window on
        a phone, and adapted to the question they asked rather than pasted underneath it. If you switch on
        autopilot, clean replies go out on their own, while pricing, legal terms or anything negative can
        still be held for a person, and anyone who says &ldquo;remove me&rdquo;
        or similar is never written to again. If they ask for a meeting, the times offered come from a real
        calendar, never invented by a model. The{" "}
        <Link href="/guides/book-meetings-from-linkedin">guide to booking meetings from LinkedIn replies</Link>{" "}
        covers that step.
      </p>
      <p>
        And if they do not reply? Then the next message is a follow-up, spaced from this one and with its
        own reason. The{" "}
        <Link href="/guides/linkedin-follow-up-sequence">LinkedIn follow-up sequence guide</Link> covers
        how many to send, how far apart, and when to stop.
      </p>

      <p>
        If you would rather have this message written and timed for you, <Link href="/how-it-works">how
        Nora works</Link> explains the daily caps, pacing and working hours around it. Any tool that sends
        messages for you carries some risk under LinkedIn&rsquo;s User Agreement. More guides are in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>
    </ArticleLayout>
  );
}
