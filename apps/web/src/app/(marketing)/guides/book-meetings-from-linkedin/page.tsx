import type { Metadata } from "next";
import Link from "next/link";
import { ArticleLayout, articleMeta, Callout, CompareTable } from "@/components/article";
import { PUBLIC_LIMITS } from "@/lib/site";
import {
  CTA_DEFINITIONS,
  CTA_KINDS,
  INVITE_NOTE_MAX_CHARS,
  LINKEDIN_LIMITS,
  OPT_OUT_PHRASES,
  PITCH_MAX_CHARS,
  containsLink,
} from "@le/shared";

const PATH = "/guides/book-meetings-from-linkedin";

export const metadata: Metadata = articleMeta(PATH);

const MINUTE = 60_000;
const FOLLOW_UP_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / MINUTE);
const FOLLOW_UP_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / MINUTE);

/* The phrases that end everything, quoted from the list the reply path checks. */
const OPT_OUTS = OPT_OUT_PHRASES.map((p) => `"${p}"`).join(", ");

/* Proof, at build time, that the link rule is the one the send path runs. */
const LINK_NOTE_EXAMPLE = "Saw your post on onboarding churn. We wrote up what fixed ours: https://example.com/churn";
const LINK_NOTE_BLOCKED = containsLink(LINK_NOTE_EXAMPLE);

/* One set of example times, US Eastern, used everywhere on the page. */
const TIMES = "Tue 10 a.m., Wed 2:30 p.m. or Thu 9:30 a.m. ET";

const FAQ = [
  {
    q: "How do you ask for a call on LinkedIn without being pushy?",
    a: "Ask only after the other person has replied, and make the ask small and specific. Answer whatever they asked first, give one sentence on why a call would help them, then offer two or three exact times with a time zone and a length, such as 20 minutes. Add an easy way out: if none of those suit, say you can send a link or pick another week.",
  },
  {
    q: "Should you send a Calendly link in a LinkedIn message?",
    a: "Yes, once there is a conversation and the person has shown interest, or when they ask for one. A link in a first message or a connection request asks a stranger to do the scheduling work for you. Offering specific times first and the link as the fallback usually reads as more considerate. Keep links out of connection notes entirely.",
  },
  {
    q: "How do you turn a LinkedIn conversation into a meeting?",
    a: "Find the point where a call would genuinely save them time: they have asked a question that needs a demo, described a problem you solve, or asked about price. Answer briefly, name what the call would cover, and offer specific times. If they accept a time, confirm it in the thread and send the calendar invitation straight away.",
  },
  {
    q: "How do you respond to 'not interested' on LinkedIn?",
    a: "Do not argue or ask why. If you reply at all, one line is enough: thank them and confirm you will not follow up. Then make sure no sequence, colleague or second campaign writes to them again. Nora treats 'not interested' as an opt-out: it sends nothing further and marks the person do-not-contact across the workspace.",
  },
  {
    q: "Can an AI book meetings from LinkedIn?",
    a: "Yes, within limits. Nora drafts replies, offers times worked out from the availability the rep sets, and books a time the prospect accepts after checking it is still free. The model never invents a time or a link. By default a person approves each reply before it sends, and pricing, legal and negative messages wait for a person.",
  },
];

const SOURCES = [
  { label: "Calendly: Calendly + LinkedIn integration (browser extension for LinkedIn Messaging)", url: "https://calendly.com/integration/linkedin" },
  { label: "Calendly blog: browser extension for LinkedIn Messaging, Recruiter and Sales Navigator", url: "https://click.calendly.com/blog/linkedin-browser-extension" },
  {
    label: "Calendly press release, March 2025: Calendly teams up with LinkedIn",
    url: "https://calendly.com/newsroom/press-release/calendly-teams-up-with-linkedin-to-help-professionals-source-more-client",
  },
  { label: "LinkedIn Help: custom button on your profile (Premium)", url: "https://www.linkedin.com/help/linkedin/answer/a1484520" },
  {
    label: "Social Media Today: LinkedIn adds Calendly integration for custom profile buttons",
    url: "https://www.socialmediatoday.com/news/linkedin-adds-calendly-integration-custom-profile-cta-buttons/743152/",
  },
  { label: "Calendly blog: best practices for sharing your scheduling link", url: "https://calendly.com/blog/share-scheduling-link" },
  { label: "Monday Morning (Substack): Calendly etiquette", url: "https://mondaymorning.substack.com/p/calendly-etiquette" },
  { label: "GDPR Article 21: right to object (direct marketing)", url: "https://gdpr-info.eu/art-21-gdpr/" },
];

const PATH_ROWS = [
  {
    label: "Connection request",
    values: [
      `Why you picked them, in ${INVITE_NOTE_MAX_CHARS} characters or fewer`,
      "A pitch or a link. Either turns a request to connect into an advert.",
    ],
  },
  {
    label: "Acceptance",
    values: ["A short pause, so your first message does not land in the same minute.", "A message in the same second, which reads as a machine."],
  },
  {
    label: "First message",
    values: [
      "Continue the note's thread within a couple of hours, while they still remember accepting.",
      "Three days of silence, then an opener about a request they have forgotten.",
    ],
  },
  {
    label: "Their reply",
    values: ["Answer what they asked. This is where the offer belongs.", "Ignoring the question to push for a call."],
  },
  {
    label: "The ask",
    values: ["Two or three exact times, a length and a time zone.", "\"Open to a quick call sometime?\""],
  },
  {
    label: "Booking",
    values: ["Confirm in the thread and send the invitation at once.", "Booking a time nobody offered, or one already taken."],
  },
];

/* The definitions are written for the app's screens; the page's own voice uses no dashes and starts cells with a capital. */
const plain = (text: string) => {
  const t = text.replace(/\s*[\u2013\u2014]\s*/g, ": ").replace(/this product/g, "Nora");
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
};
const GOAL_ROWS = CTA_KINDS.map((kind) => ({
  label: CTA_DEFINITIONS[kind].label,
  values: [plain(CTA_DEFINITIONS[kind].asks), plain(CTA_DEFINITIONS[kind].conversion)],
}));

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="How to book meetings from LinkedIn, from first reply to calendar"
      lede="To book meetings from LinkedIn, ask for the meeting only after the person has replied, then offer two or three specific times you can keep instead of a vague 'quick call sometime'. Keep links out of the connection request, use a booking link as the fallback rather than the opener, and treat 'not now' and 'remove me' as two different answers."
      faq={FAQ}
      sources={SOURCES}
    >
      <Callout tone="info">
        <p className="ga2-summary-title">In short</p>
        <ul className="ga2-callout-list">
          <li>
            <strong>Earn the reply first.</strong> The invitation and the first message after acceptance start a
            conversation. Neither pitches, and neither asks for time.
          </li>
          <li>
            <strong>Ask with times, not a question.</strong> &quot;{TIMES}, 20 minutes&quot; can be accepted in one word.
            &quot;Open to a chat?&quot; needs three more messages.
          </li>
          <li>
            <strong>Only offer what is real.</strong> Every time must be free on your calendar, and every link must be one
            you meant to send.
          </li>
          <li>
            <strong>Hear the no.</strong> &quot;Not now&quot; is a date to come back. &quot;Remove me&quot; is the end, for every
            campaign and every colleague.
          </li>
        </ul>
      </Callout>
      <p>
        This guide is written from the rules Nora follows when it answers replies and books meetings. Where a rule is ours
        rather than LinkedIn&apos;s, it says so.
      </p>

      <h2 id="path">The path from acceptance to meeting</h2>
      <p>
        A booked meeting is the last of six small steps, and most lost meetings were lost at an earlier
        one. A request that pitched got ignored; a follow-up that arrived three days late got no answer; a
        reply that asked a question got a calendar link instead of an answer. The table below is the
        whole path with the most common way each step goes wrong.
      </p>
      <CompareTable
        caption="The steps between a LinkedIn connection request and a booked meeting"
        columns={["What works", "What loses the meeting"]}
        rows={PATH_ROWS}
      />
      <p>
        The first two steps are covered in depth elsewhere: our{" "}
        <Link href="/guides/linkedin-connection-request-templates">LinkedIn connection request templates</Link>{" "}
        and the guide to the{" "}
        <Link href="/guides/linkedin-follow-up-after-connection">follow-up message after a connection is accepted</Link>.
        This page starts where those stop, at the reply.
      </p>

      <h2 id="when-to-ask">When to ask: after they reply, not before</h2>
      <p>
        A meeting request in a connection note asks a stranger for half an hour before they have agreed
        to anything. A meeting request in the first message after acceptance does the same thing one
        step later. Both are easy to ignore, and an ignored message is the end of the thread.
      </p>
      <p>
        So the order is: connect, open a conversation, and make the offer when they answer. In Nora this
        is a written rule rather than a style tip. The connection note carries no pitch and no link. Nora
        checks for acceptances every hour and sends the first message {FOLLOW_UP_MIN} to {FOLLOW_UP_MAX}{" "}
        minutes after it notices one, inside working hours, so usually within a couple of hours of the
        acceptance. That message only starts a conversation. The pitch, a single line of at most{" "}
        {PITCH_MAX_CHARS} characters that a person on your team approved, is sent when they reply, adapted to
        what they actually said.
      </p>
      <p>Replies worth turning into a meeting usually look like one of these:</p>
      <ul>
        <li>
          <strong>A question about what you do.</strong> &quot;What is it exactly?&quot; Answer in two sentences,
          then offer to show them.
        </li>
        <li>
          <strong>A description of the problem.</strong> &quot;We tried that last year and it fell apart at
          handover.&quot; A call is now useful to them, not just to you.
        </li>
        <li>
          <strong>A question that needs context to answer well</strong>, such as price for their setup or
          how it fits a tool they use. Answer what you can, and offer the call for the rest.
        </li>
      </ul>
      <p>
        A reply that is only polite (&quot;Thanks for connecting!&quot;) is not yet a reason to ask for time. Ask
        one question about their side of the problem first. If you need a fuller picture of the messages
        between acceptance and reply, the{" "}
        <Link href="/guides/linkedin-follow-up-sequence">LinkedIn follow-up sequence guide</Link> covers
        how many to send and how far apart.
      </p>

      <h2 id="offer-times">Offer real times, not &quot;a quick call sometime&quot;</h2>
      <p>
        &quot;Would you be open to a quick call?&quot; feels polite and costs the other person work: they have to
        say yes, then propose times, then wait for you to confirm. Each of those is a message that may
        not get sent. Specific times collapse it into one reply. A message that does this well looks like:
      </p>
      <blockquote>
        <p>
          That handover problem is the exact thing we fixed for ourselves. Easier to show than to type: I
          could do {TIMES}, 20 minutes. If none of those work, tell me a better week.
        </p>
      </blockquote>
      <p>
        Three options on three different days is a useful default; three back-to-back slots on one afternoon
        are really one option. Always name the time zone and the length, because &quot;a call&quot; with no end
        time sounds like an hour.
      </p>

      <h3 id="ask-templates">LinkedIn messages to ask for a meeting</h3>
      <p>Three templates for the three replies that most often lead to a meeting. Swap in your own times and details.</p>
      <p>
        <strong>When they ask what you do:</strong>
      </p>
      <blockquote className="ga2-template">
        <p>
          Short version: we [what you do] for [type of company], so [the result they care about]. Easier to show than to
          type. I could do {TIMES}, 20 minutes. If none of those work, tell me a better week.
        </p>
      </blockquote>
      <p>
        <strong>When they describe the problem:</strong>
      </p>
      <blockquote className="ga2-template">
        <p>
          That is exactly the gap we close for [similar companies]. Worth 20 minutes to see whether it fits how your team
          works? I have {TIMES}.
        </p>
      </blockquote>
      <p>
        <strong>When they ask for more information first:</strong>
      </p>
      <blockquote className="ga2-template">
        <p>
          Happy to. In two lines: [what it is and who it is for]. If it raises questions, I can walk you through it in 15
          minutes, Wed at 11 a.m. or Thu at 3 p.m. ET.
        </p>
      </blockquote>

      <h3 id="keepable-times">Times you can actually keep</h3>
      <p>
        Every time you offer is a promise. Offer only times that are free on your calendar, during your
        working hours, with enough notice that you will be prepared and enough buffer that the previous
        meeting running over does not make you late. If you work with several calendars, check all of
        them; a time that looks free in one and is taken in another is how two people end up waiting in
        two different calls.
      </p>
      <p>
        When a prospect picks a time, confirm it in the same thread and send the calendar invitation at once. A booking
        that exists only in a LinkedIn chat is the one most likely to be missed; the next section has the messages for it.
      </p>

      <h3 id="never-invent">Never inventing a time or a link</h3>
      <p>
        This is where AI-written replies go wrong, and it is worth knowing even if you write every message
        yourself. A language model asked to propose a meeting will happily write &quot;How about Thursday at
        3 p.m.?&quot; with no idea whether that hour is free on anybody&apos;s calendar. Asked for a link, it will
        write a plausible address that does not exist.
      </p>
      <p>Nora handles both the same way: the model never decides.</p>
      <ul>
        <li>
          <strong>Times come from the calendar, not the model.</strong> A separate, deterministic step
          works out the free times from the rep&apos;s availability. It treats meetings booked in Nora, times
          the rep has blocked out and any calendar feed they connect as busy, and sees nothing else, so a busy
          calendar elsewhere needs blocking out or a feed connected. The agent may only offer times from that
          list, and the times stored are the ones actually offered, not the model&apos;s wording of them.
        </li>
        <li>
          <strong>An acceptance must match.</strong> When the prospect answers, the time they accept has to
          match an offered time to the day and the minute. It is checked against the calendar again
          before it is booked, because another prospect may have taken it since, and the database
          refuses a second meeting at the same start time on one rep&apos;s calendar. If the time has gone, the
          conversation waits for a person to offer another. A time the prospect proposes themselves is
          never booked on a guess.
        </li>
        <li>
          <strong>Links must be ones you gave it.</strong> Every address in a draft is compared with the
          links the agent was handed: your booking link, the campaign&apos;s destination, and anything in your
          own knowledge documents. A draft with any other link is held for a person, not sent with the
          link cut out, because &quot;book here:&quot; followed by nothing reads worse than either.
        </li>
      </ul>

      <h2 id="after-yes">After the yes: confirmation, reminder and no-shows</h2>
      <p>
        A meeting is not booked until it is on both calendars. Three short messages carry it the rest of the way.
      </p>
      <p>
        <strong>Confirmation, in the thread, as soon as they pick:</strong>
      </p>
      <blockquote className="ga2-template">
        <p>Great, Thu 9:30 a.m. ET it is, 20 minutes. What is the best email for the calendar invitation?</p>
      </blockquote>
      <p>
        <strong>Reminder, the morning of the call:</strong>
      </p>
      <blockquote className="ga2-template">
        <p>
          Looking forward to our call at 9:30 a.m. ET today. The link is in the invitation. If something has come up, just
          say and we will move it.
        </p>
      </blockquote>
      <p>
        <strong>No-show, about 15 minutes after the start:</strong>
      </p>
      <blockquote className="ga2-template">
        <p>Looks like today did not work out, no problem. Want to pick another time? I could do Mon 1 p.m. or Tue 11 a.m. ET.</p>
      </blockquote>
      <p>
        If the no-show message gets no answer, send one more a few days later and then stop: a missed call is often a busy
        week, and two polite offers are enough. When a prospect books through Nora&apos;s own booking page, both of you are
        emailed a calendar invitation that carries a 15-minute reminder. Nora does not send the morning-of message or chase
        a no-show for you, so those two are yours.
      </p>

      <h2 id="booking-links">Booking links: Calendly, Cal.com or your own page</h2>
      <p>
        A booking link is the right tool at the right moment: when somebody asks for one, when none of the
        times you offered suit, or once the conversation is warm enough that sending your calendar is a
        convenience rather than a demand. Even Calendly&apos;s own advice is to suggest a meeting once you have
        a rapport going and then share the link. The common mistake is using the link as the opener.
      </p>
      <p>As of October 2026, there are three ways people share one on LinkedIn:</p>
      <ul>
        <li>
          <strong>Paste it into the conversation.</strong> Calendly offers a browser extension that adds
          its scheduling links to LinkedIn Messaging, Sales Navigator and Recruiter.
        </li>
        <li>
          <strong>Put it on your profile.</strong> LinkedIn&apos;s help center describes a custom profile button
          for Premium Business, Sales Navigator and Recruiter Lite subscribers, with &quot;Book an appointment&quot;
          among the presets. Calendly announced an integration with that button in March 2025 and said
          more than 165,000 LinkedIn users already featured a Calendly link on their profile.
        </li>
        <li>
          <strong>Use your outreach tool&apos;s own page.</strong> Nora has a booking page that offers only times
          its calendar check says are free, and checks again when one is picked. Each link is made for one
          prospect and expires, so nobody else can fill your week with it.
        </li>
      </ul>

      <h3 id="not-in-the-request">Never in the connection request</h3>
      <p>
        A connection note has {INVITE_NOTE_MAX_CHARS} characters on a free LinkedIn account (more on
        Premium, which is why Nora writes to the lower number) and one job: a reason
        to accept. A URL from a stranger is what spam looks like, and it spends characters that should be
        about the person. Nora checks every note for a link in code, not just in the writing instructions.
        A note such as &quot;{LINK_NOTE_EXAMPLE}&quot; {LINK_NOTE_BLOCKED ? "is caught by that check" : "is the kind it looks for"}, and
        a note that is caught is sent with no note at all rather than with the address cut out of the
        middle of a sentence. A request with no note is ordinary on LinkedIn; a broken one is not.
      </p>

      <h3 id="reporting">What you lose in reporting</h3>
      <p>
        A meeting booked on Calendly or Cal.com happens on their site, so unless you connect it to your CRM, your LinkedIn
        outreach never learns it happened. That is no reason to avoid them, since a rep who has used one for years keeps
        their availability, buffers and reminders there, but your numbers will undercount meetings. Nora allows a rep&apos;s
        own scheduling link and says on screen that meetings booked through it are not counted automatically. Meetings
        booked by accepting an offered time, or through Nora&apos;s own booking page, are counted.
      </p>

      <h2 id="when-no">When the answer is no</h2>
      <p>
        Most replies to outreach are not yes. How you handle the rest decides whether the next person at
        that company ever answers you.
      </p>

      <h3 id="not-now">&quot;Not now&quot; versus &quot;remove me&quot;</h3>
      <p>
        &quot;Not now&quot;, &quot;maybe next quarter&quot; and &quot;we just signed with someone&quot; are timing answers. Thank them,
        ask whether a particular month would be better, and write it down. Coming back when they said to
        is welcome; coming back next week is not.
      </p>
      <p>
        &quot;Remove me&quot;, &quot;stop messaging me&quot; and &quot;not interested&quot; are not timing answers. Do not ask why, do not
        offer a lighter version, do not reply with a case study. One line acknowledging it is enough, and
        nothing at all is fine.
      </p>
      <p>
        <strong>A reply to &quot;not interested&quot;:</strong>
      </p>
      <blockquote className="ga2-template">
        <p>Understood, thanks for letting me know. I will not follow up.</p>
      </blockquote>
      <p>
        <strong>A reply to &quot;not now&quot;:</strong>
      </p>
      <blockquote className="ga2-template">
        <p>Makes sense. Would it be useful if I checked back in [month], or is it a no for this year?</p>
      </blockquote>
      <p>
        An honest note on Nora here: it drafts a polite reply to &quot;not now&quot;, but it does
        not yet set a reminder to come back on the date they named. If timing matters, note it in your
        CRM.
      </p>

      <h3 id="opt-out">Why an opt-out stops everything</h3>
      <p>
        An opt-out has to stop more than the current sequence. It has to stop the colleague who was about
        to invite the same person from another campaign, and the campaign you build next month from a
        similar list. In the EU and UK, a person&apos;s objection to direct marketing is absolute under GDPR
        Article 21: once they object, their data may no longer be used for it.
      </p>
      <Callout tone="safety">
        <p>
          <strong>Nora&apos;s rule.</strong> Before any model reads a reply, the text is checked against a fixed
          list of phrases: {OPT_OUTS}. A match stops the conversation with no reply sent, marks the person
          do-not-contact for the whole workspace, and closes them on every campaign. The model can add
          opt-outs the list misses; it can never overrule one the list finds.
        </p>
      </Callout>
      <p>
        That list deliberately counts &quot;not interested&quot; as an opt-out, which is stricter than most people
        would be by hand. Writing again to somebody who said they were not interested is the single
        message most likely to be reported, and a report costs the sending account far more than one lost
        lead. More on the legal side is in{" "}
        <Link href="/guides/is-linkedin-automation-legal">whether LinkedIn automation is illegal, and how GDPR applies</Link>.
      </p>

      <h2 id="other-goals">Goals other than meetings: sign-ups, demos, replies</h2>
      <p>
        Not every campaign should end in a call. Some want a sign-up, a look at a product page, or simply a
        conversation with the right person. Asking for a meeting when you wanted a sign-up adds a step the
        prospect did not need, and measuring a sign-up campaign by meetings booked makes a working campaign
        look like a failure.
      </p>
      <CompareTable
        caption="The three goals a Nora campaign can have, and what each one counts as success"
        columns={["What the messages ask for", "What counts as done"]}
        rows={GOAL_ROWS}
      />
      <p>
        The goal changes what the replies do, not just the report. A campaign sending people to a page is
        given no meeting times to offer, and a campaign that only wants a conversation is given no link at
        all, not even the rep&apos;s own. One limit applies to every link campaign, ours included: LinkedIn
        does not report clicks, and Nora will not wrap your link in a redirect to count them, because a
        redirect through another domain breaks tracking parameters and reads as spam. The last thing it
        can measure is the link being sent.
      </p>

      <h2 id="how-nora-books">How Nora answers replies and books meetings from LinkedIn</h2>
      <p>
        Put together, this is what happens when somebody replies to a Nora campaign. The full flow is on{" "}
        <Link href="/how-it-works">how Nora works</Link>.
      </p>
      <ul>
        <li>
          <strong>The reply is read for opt-outs first,</strong> by the fixed phrase list, then classified:
          interested, a question, not now, not interested, and whether it mentions price, legal matters or
          asks for a person.
        </li>
        <li>
          <strong>A gate decides who answers.</strong> By default a person approves every reply before it
          sends. Even with that switched off, pricing, legal and negative messages wait for a person unless
          the workspace chooses otherwise, and two holds never lift: a message the agent is not confident it
          understood, and a prospect who asks to speak to a human.
        </li>
        <li>
          <strong>The draft answers the question first,</strong> uses only facts from your business profile
          and knowledge documents, and makes the approved offer when the person is interested.
        </li>
        <li>
          <strong>For a meeting campaign, it offers real times</strong> from your availability, or your own
          booking link if you set one. An accepted time is checked and booked, and the confirmation says it
          is on the calendar rather than offering the same times again.
        </li>
        <li>
          <strong>Everything sends inside the account&apos;s limits:</strong> replies and follow-ups share a cap
          of {PUBLIC_LIMITS.messagesPerDay} messages a day, inside working hours. The{" "}
          <Link href="/linkedin-automation-limits">LinkedIn automation limits page</Link> lists every cap.
        </li>
      </ul>
      <p>
        None of this makes automating a LinkedIn account risk-free, since LinkedIn&apos;s user agreement prohibits it.
        It keeps the conversation honest: real times, real links, and a stop that means stop.
      </p>
    </ArticleLayout>
  );
}
