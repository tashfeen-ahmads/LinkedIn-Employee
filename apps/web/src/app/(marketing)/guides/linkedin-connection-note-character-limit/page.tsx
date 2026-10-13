import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, articleMeta, CompareTable, type Faq, type Source } from "@/components/article";
import { LINKEDIN_NOTE_LIMITS } from "@/lib/note-check";
import { Gb1LengthBars, NOTE_AIM } from "@/components/seo/gb1-visuals";
import { PUBLIC_LIMITS } from "@/lib/site";

const PATH = "/guides/linkedin-connection-note-character-limit";

export const metadata: Metadata = articleMeta(PATH);

const FREE = LINKEDIN_NOTE_LIMITS.free;
const PREMIUM = LINKEDIN_NOTE_LIMITS.premium;
/** The one rule this page gives: aim for this range, never pass the hard stop. */
const AIM = `about ${NOTE_AIM.low} to ${NOTE_AIM.high}`;

/*
 * Example notes for the "full thought" section. Their counts are computed the
 * way Nora measures a note (`text.length`), so the page cannot claim a length
 * the text does not have.
 */
const EXAMPLES = [
  {
    label: "Too long",
    text: "Hi Sam, I came across your profile and was really impressed by your background in operations and the work you have been doing at Northwind over the last few years. I work with a lot of operations leaders and I would love to connect and share ideas.",
  },
  {
    label: "Cut to one thought",
    text: "Hi Sam, your post on moving Northwind’s onboarding to async video was the clearest version of that argument I have read. I run ops at a similar-sized team. Would be glad to connect.",
  },
  {
    label: "Shorter still",
    text: "Hi Sam, your post on async onboarding at Northwind answered a question my team has argued about for a month. Would be glad to connect.",
  },
] as const;

const FAQ: readonly Faq[] = [
  {
    q: "Is the LinkedIn connection note limit 200 or 300 characters?",
    a: `Both, depending on the account. LinkedIn’s help pages, as found in October 2026, give ${FREE} characters for a personalized note on a free account and ${PREMIUM} with Premium. Many guides still say ${PREMIUM} for everyone. Aim for ${AIM} characters and treat ${INVITE_NOTE_MAX_CHARS} as the hard stop: that works on every account, and it is the cap Nora enforces on every note.`,
  },
  {
    q: "Do spaces and emojis count toward the limit?",
    a: `Spaces count, as do punctuation and line breaks. Emojis count too, and some counters treat one emoji as two characters because of how text is stored, so a note full of emojis can run out sooner than it looks. The safe habit is to aim for ${AIM} characters and skip emojis in a first message to a stranger.`,
  },
  {
    q: "Does Premium increase the connection note limit?",
    a: `According to LinkedIn’s help pages as of October 2026, yes: Premium raises the note to ${PREMIUM} characters and removes the monthly cap on how many personalized notes you can send. Sales Navigator is a Premium product, and guides that list it give it the same ${PREMIUM}. We have not tested Sales Navigator’s limit ourselves.`,
  },
  {
    q: "Why was my LinkedIn invitation refused or cut off?",
    a: `The most common cause is a note over your account’s limit. A note we sent at 222 characters from a free account was refused outright, with a “too many characters” error, rather than trimmed. Other causes include the weekly invitation limit and invitations restricted after many recipients clicked “I don’t know this person”.`,
  },
  {
    q: "How many personalized notes can a free account send?",
    a: "A small number each month, but sources disagree on how many. LinkedIn help text and recent guides we found in October 2026 cite three, five and ten. After that, a free account can still send invitations, just without a note. Spend the notes on people where you have something specific to say.",
  },
];

const SOURCES: readonly Source[] = [
  {
    label: "LinkedIn Help: Personalize invitations to connect (200 characters on free accounts, more with Premium)",
    url: "https://www.linkedin.com/help/linkedin/answer/a563153",
  },
  {
    label: "LinkedIn Help: Personalize invitations to connect, older article ID",
    url: "https://www.linkedin.com/help/linkedin/answer/46662",
  },
  {
    label: "Unilink: LinkedIn character limits in 2026 (lists 200 basic, 300 Premium)",
    url: "https://www.unilink.us/blog/linkedin-character-limits-2026",
  },
  {
    label: "QuickMail: LinkedIn connection message character limit (lists 300)",
    url: "https://quickmail.com/linkedin-connection-message-character-limit",
  },
  {
    label: "Promiseclick: LinkedIn connection request examples (cites LinkedIn Help for 200 on free accounts)",
    url: "https://www.promiseclick.com/blog/linkedin-connection-request-examples",
  },
  {
    label: "Dripify Help: Limited personalized connection request notes for free LinkedIn accounts",
    url: "https://help.dripify.io/en/articles/8490987-limited-personalized-connection-request-notes-for-free-linkedin-accounts",
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
      h1="LinkedIn connection note character limit: 200 or 300 characters?"
      lede={`The LinkedIn connection note character limit is ${FREE} characters on a free account and ${PREMIUM} on Premium, according to LinkedIn’s help pages as of October 2026. Aim for ${AIM} characters and treat ${FREE} as the hard stop: that works on every account, and a note over the limit can get the whole invitation refused rather than trimmed.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="short-answer">The short answer: the LinkedIn connection note character limit by account</h2>
      <CompareTable
        caption="Connection note limits by account type, as reported in October 2026"
        columns={["Note length", "Personalized notes per month"]}
        rows={[
          { label: "Free (basic) account", values: [`${FREE} characters`, "Capped; sources say 3, 5 or 10"] },
          { label: "Premium", values: [`${PREMIUM} characters`, "No monthly cap on notes"] },
          { label: "Sales Navigator", values: [`${PREMIUM} characters, as listed by guides (untested by us)`, "Treated as Premium"] },
          { label: "Nora, any account", values: [`${INVITE_NOTE_MAX_CHARS} characters, enforced in code`, "One written per prospect"] },
        ]}
      />
      <p>
        The one rule: aim for {AIM} characters; {FREE} is the hard stop. A Premium user who writes to
        that loses nothing anyone notices. A free user who writes to {PREMIUM} loses the invitation.
      </p>

      <h2 id="why-sources-disagree">Why sources disagree: free, Premium and Sales Navigator</h2>
      <p>
        Look the limit up and you will find confident answers in both directions. Several popular
        guides, as of October 2026, give {PREMIUM} characters for every account. Others, including pages that quote
        LinkedIn&rsquo;s own help center, say {FREE} for free accounts and {PREMIUM} for Premium.
      </p>
      <p>Three things explain most of the disagreement:</p>
      <ul>
        <li>
          <strong>Old pages stay up.</strong> Some {PREMIUM}-for-everyone figures probably date from
          before free and paid accounts were treated differently, and were right when they were written.
        </li>
        <li>
          <strong>Many writers test from a paid account.</strong> Sales tools and the people who review
          them tend to use Premium or Sales Navigator, where {PREMIUM} is correct.
        </li>
        <li>
          <strong>LinkedIn rolls changes out gradually.</strong> One vendor reported the {FREE}-character
          limit, plus a monthly cap on notes, as a LinkedIn test. While a change is rolling out, two people
          checking on the same day can see different things.
        </li>
      </ul>
      <p>
        Sales Navigator is sold as a Premium product, and guides that list it give it the Premium figure.
        We have not sent from a Sales Navigator account to confirm it, so treat that row as reported, not
        tested.
      </p>

      <h2 id="over-the-limit">What actually happens over the limit</h2>
      <p>
        The risk is mostly text written somewhere else: a template in a spreadsheet, a note drafted by a
        tool, a paragraph pasted in a hurry. Some guides say text past the limit is cut off. What we saw
        was worse.
      </p>

      <h3 id="refused-not-truncated">A 222-character note: the whole invitation refused, not truncated</h3>
      <p>
        An early version of Nora wrote connection notes to {PREMIUM} characters, because that was the
        number it had been given and every check downstream trusted it. The first live campaign sent from a
        free account. A 222-character note came back with a &ldquo;too many characters&rdquo; error, and the
        invitation did not go at all. Nothing was trimmed; the request simply failed, and it still used up
        one of that day&rsquo;s limited invitations on a real person someone had chosen for the campaign.
      </p>
      <p>
        When we checked, sixteen of the first twenty-three notes written had been between 200 and 278
        characters: inside the limit we believed in, outside the one that was real. The fix was to cap
        every note at {INVITE_NOTE_MAX_CHARS}, for every account, and to check that cap at the moment of
        sending rather than trusting the writer. A note over it is never shortened, because a sentence cut
        mid-word reaches a real person under a real name. It is replaced by the campaign&rsquo;s approved
        fallback, and if that does not fit either, the invitation goes with no note at all, which is
        ordinary on LinkedIn.
      </p>

      <h2 id="what-counts">What counts: spaces, emojis, line breaks</h2>
      <ul>
        <li>
          <strong>Spaces and punctuation</strong> count, every one. A note with double spaces after
          periods is longer than it looks.
        </li>
        <li>
          <strong>Line breaks</strong> are characters in any counter. LinkedIn does not document how its own
          limit treats them, so count them and keep the note to one paragraph anyway; it reads better in a
          notification.
        </li>
        <li>
          <strong>Emojis</strong> count, and many count as two. Text on the web is stored in units where most
          emojis take two, and a counter that measures those units (as Nora&rsquo;s does, deliberately)
          will report a single emoji as two characters. Being conservative here costs a character; being
          optimistic costs the invitation.
        </li>
        <li>
          <strong>Names you merge in</strong> count at their real length. A template that fits with
          &ldquo;Sam&rdquo; can fail with &ldquo;Alexandra-Louise&rdquo;. That is why the aim is {AIM},
          not {FREE}.
        </li>
      </ul>
      <p>
        We could not confirm, as of October 2026, how LinkedIn&rsquo;s own invite box shows a count on
        desktop and in the mobile app, so count the note before you paste it in. The{" "}
        <Link href="/tools/connection-note-checker">free connection note checker</Link> counts a note
        the same way Nora does, tells you whether it fits a free account, Premium or neither, and flags
        links and sales phrases. Nothing you paste is stored.
      </p>

      <h2 id="notes-per-month">How many personalized notes a free account gets each month</h2>
      <p>
        The character limit is not the only constraint on free accounts. LinkedIn also caps how many
        invitations a free account can personalize each month. As of October 2026 the figure is reported
        differently almost everywhere: LinkedIn help text quoted in search results gives three in one
        version and five in another, and older vendor documentation says five to ten. Premium removes the
        cap.
      </p>
      <p>
        We would not plan around any single figure. What is consistent is the shape: a free account gets a
        handful of notes a month, and once they are used, invitations still go, just blank. So the
        practical question is not &ldquo;how long can my note be&rdquo; but &ldquo;which people deserve one
        of my few notes&rdquo;. The guide on{" "}
        <Link href="/guides/should-you-add-a-note-linkedin">whether to add a note to a connection request</Link>{" "}
        covers when a blank request is the better choice anyway.
      </p>
      <p>
        Separately from notes, there is a weekly ceiling on invitations of any kind, which LinkedIn does
        not publish. Nora stays under {PUBLIC_LIMITS.invitesPerWeek} a week and starts new accounts at{" "}
        {PUBLIC_LIMITS.invitesPerDayStart} a day; the reasoning is on the{" "}
        <Link href="/linkedin-automation-limits">LinkedIn automation limits page</Link>.
      </p>

      <h2 id="writing-in-200">Writing a full thought in 200 characters</h2>
      <p>
        {FREE} characters is about two short sentences. That is enough for exactly one idea, which is all
        a connection note needs: one specific, true reason you are writing to this person, and a
        low-pressure close. Here is one note cut down twice, counted the way Nora counts.
      </p>
      <Gb1LengthBars
        caption="The same note, cut down, against the two published limits"
        notes={EXAMPLES.map((example) => ({ label: example.label, length: example.text.length, text: example.text }))}
        free={FREE}
        premium={PREMIUM}
      />
      <p>What came out, and why:</p>
      <ul>
        <li>
          <strong>&ldquo;I came across your profile&rdquo;.</strong> They know; that is how invitations
          work.
        </li>
        <li>
          <strong>Praise without content.</strong> &ldquo;Really impressed by your background&rdquo; could
          be sent to anyone. Naming the post they wrote could not.
        </li>
        <li>
          <strong>&ldquo;I work with a lot of operations leaders&rdquo;.</strong> A pitch in disguise. Save
          what you do for after they accept.
        </li>
      </ul>
      <p>
        For ready-made shapes that fit, see the{" "}
        <Link href="/guides/linkedin-connection-request-templates">connection request templates</Link>, each
        shown with its character count.
      </p>

      <p>
        Nora writes one note per prospect from that person&rsquo;s own profile, holds every one to{" "}
        {INVITE_NOTE_MAX_CHARS} characters at the moment it is sent, and shows them all to you before
        launch; <Link href="/how-it-works">how Nora works</Link> covers the rest. Like any automation tool,
        it carries some risk under LinkedIn&rsquo;s User Agreement. More on notes is in the{" "}
        <Link href="/guides">LinkedIn outreach guides</Link>.
      </p>
    </ArticleLayout>
  );
}
