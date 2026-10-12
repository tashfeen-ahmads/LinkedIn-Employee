import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, Callout, CompareTable, articleMeta, type Faq, type Source } from "@/components/article";
import { NoteChecker } from "@/components/seo/tool-note-checker";
import { LINKEDIN_NOTE_LIMITS } from "@/lib/note-check";
import { SITE } from "@/lib/site";

const PATH = "/tools/connection-note-checker";

export const metadata: Metadata = articleMeta(PATH);

const FAQ: readonly Faq[] = [
  {
    q: "How many characters is a LinkedIn connection note?",
    a: `As of October 2026, LinkedIn's help pages give ${LINKEDIN_NOTE_LIMITS.free} characters for a personalised note from a free account, and guides list ${LINKEDIN_NOTE_LIMITS.premium} for Premium. Spaces and punctuation count. If you do not know which account will send it, write to ${LINKEDIN_NOTE_LIMITS.free}: it fits both. Nora caps every note it writes at ${INVITE_NOTE_MAX_CHARS} for the same reason.`,
  },
  {
    q: "Why should a connection note have no link?",
    a: "A link asks a stranger to leave LinkedIn for a page you chose before they know who you are, and it looks like the first step of every sales sequence they have ignored. Some people will not click anything from somebody they have not met. Put the link in a message after they reply, when they have a reason to want it.",
  },
  {
    q: "Is what I paste stored?",
    a: "No. The check runs entirely in your browser. Nothing you type is sent to a server, logged or kept, and closing the tab discards it. That is also why the checker needs no sign-up: there is no account to attach your text to, because the text never leaves the page you are reading.",
  },
  {
    q: "Should I send a connection request without a note?",
    a: "Often, yes. A blank invitation is ordinary on LinkedIn and better than a generic one. Free accounts can also only add a note to a few invitations a month, and sources disagree on how many. Spend them on people where you have one specific, true thing to say.",
  },
];

const SOURCES: readonly Source[] = [
  { label: "LinkedIn Help: Personalize invitations to connect", url: "https://www.linkedin.com/help/linkedin/answer/a563153" },
  {
    label: "LinkedIn Help: Personalize invitations to connect, older article ID",
    url: "https://www.linkedin.com/help/linkedin/answer/46662",
  },
  {
    label: "LinkedIn Help: Connecting with other members, best practices",
    url: "https://www.linkedin.com/help/linkedin/answer/62928",
  },
];

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn connection note checker"
      lede={`This LinkedIn connection note checker counts your note against the character limit (${LINKEDIN_NOTE_LIMITS.free} on a free account as of October 2026, and the ${LINKEDIN_NOTE_LIMITS.premium} that guides give for Premium) and flags links and the phrases that turn an introduction into a pitch. It runs in your browser and nothing you paste is stored.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <h2 id="checker">The LinkedIn connection note checker</h2>
      <p>
        Paste a note, or edit the example. The result updates as you type.
      </p>
      <NoteChecker />

      <h2 id="what-it-checks">What it checks and why</h2>
      <p>
        A connection note has one job: to make a stranger think &ldquo;fair enough&rdquo; and press
        accept. The connection note checker looks for the mechanical mistakes that most often sink a note. It does
        not score your writing, because whether a detail is interesting to one person is a judgement
        about someone you know and it does not.
      </p>

      <h3 id="length">Length</h3>
      <p>
        The count is measured against both of LinkedIn&rsquo;s limits, so you can see whether a note
        fits any account or only a Premium one. LinkedIn&rsquo;s help pages describe the free-account
        limit as {LINKEDIN_NOTE_LIMITS.free} characters, and we have seen it refuse a 222-character
        note outright rather than trim it: the invitation is not sent at all, note or no note.
      </p>
      <CompareTable
        caption="Connection note limits as of October 2026"
        columns={["Free account", "Premium account", "Nora"]}
        rows={[
          {
            label: "Characters per note",
            values: [`${LINKEDIN_NOTE_LIMITS.free}, per LinkedIn Help`, `${LINKEDIN_NOTE_LIMITS.premium}, per third-party guides`, `${INVITE_NOTE_MAX_CHARS}, on every account`],
          },
          {
            label: "Notes per month",
            values: ["A few; sources disagree on the number", "More than free; check your plan", "Follows the account"],
          },
          {
            label: "A link in the note",
            values: ["Allowed by LinkedIn", "Allowed by LinkedIn", "Never: sent as no note"],
          },
        ]}
      />

      <h3 id="links">Links</h3>
      <p>
        It catches a full web address, a <code>www.</code> address, and a bare domain such as{" "}
        <code>example.com/demo</code>, which reads as a link even without{" "}
        <code>https://</code> in front. The check for full and <code>www.</code> addresses is the
        same <code>containsLink</code> function Nora runs before every invitation it sends.
      </p>
      <Callout tone="safety">
        <strong>How Nora handles a link.</strong> A note that carries one is not trimmed into a
        broken sentence. The invitation goes with no note at all, which is ordinary on LinkedIn, and
        the link waits until the person replies.
      </Callout>

      <h3 id="pitch">Pitch patterns</h3>
      <p>
        Most ignored notes are not rude. They are about the sender. The checker flags a small,
        deliberately literal list, each one a prompt to reread a sentence rather than a verdict:
      </p>
      <ul>
        <li>
          <strong>Opening with what you do</strong>: &ldquo;we help&rdquo;, &ldquo;we
          provide&rdquo;, &ldquo;we specialise&rdquo;.
        </li>
        <li>
          <strong>Asking for a meeting</strong>: &ldquo;book a quick call&rdquo;, &ldquo;15
          minutes&rdquo;, a scheduling link.
        </li>
        <li>
          <strong>Talking about your product</strong>: &ldquo;our platform&rdquo;, &ldquo;our
          solution&rdquo;, &ldquo;our services&rdquo;.
        </li>
        <li>
          <strong>Price or a deal</strong>: a currency figure, a discount, a trial offer.
        </li>
        <li>
          <strong>Two or more questions</strong>, which turn a note into a form.
        </li>
        <li>
          <strong>A leftover placeholder</strong> such as <code>{"{{first_name}}"}</code> or{" "}
          <code>[Name]</code>, which tells the reader the note was a template.
        </li>
      </ul>

      <h2 id="fixing">Fixing a note that fails</h2>
      <ol>
        <li>
          <strong>Find the one detail.</strong> Keep the sentence about them (their post, their new
          role, their company&rsquo;s news) and delete the sentence about you.
        </li>
        <li>
          <strong>Cut the ask.</strong> Replace &ldquo;open to a quick call?&rdquo; with &ldquo;would
          be good to connect.&rdquo; The meeting comes after a reply, if it comes at all.
        </li>
        <li>
          <strong>Move the link.</strong> Delete it from the note and keep it for the first message
          after they respond.
        </li>
        <li>
          <strong>Shorten to two sentences.</strong> A note at 140 characters is easier to read than
          one at 199, and leaves room for a longer name.
        </li>
        <li>
          <strong>If nothing specific is left, send it blank.</strong> An empty note beats a generic
          one.
        </li>
      </ol>
      <blockquote>
        <p>
          <strong>Before:</strong> &ldquo;Hi Sam, we help logistics companies cut admin time with
          our AI platform. Do you have 15 minutes this week for a quick call?&rdquo;
        </p>
      </blockquote>
      <blockquote>
        <p>
          <strong>After:</strong> &ldquo;Hi Sam, your post about moving dispatch off spreadsheets
          matched what we kept hearing from other ops leads. Would be good to connect.&rdquo;
        </p>
      </blockquote>
      <p>
        For starting points by situation, each annotated with the profile detail it uses, see{" "}
        <Link href="/guides/linkedin-connection-request-templates">
          connection request templates that fit in 200 characters
        </Link>
        . The{" "}
        <Link href="/guides/linkedin-connection-note-character-limit">character limit guide</Link>{" "}
        explains why published figures disagree. A good note does not protect an account that sends
        too many, so pair this with the{" "}
        <Link href="/tools/linkedin-limit-calculator">LinkedIn limit calculator</Link>, or browse
        all the <Link href="/tools">free LinkedIn tools</Link>.
      </p>
      <p>
        Nora writes one note per person from their own details, caps each at{" "}
        {INVITE_NOTE_MAX_CHARS} characters in code, and shows you every note before launch. See{" "}
        <Link href="/how-it-works">how Nora works</Link>. It is free while it grows:{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a>.
      </p>
    </ArticleLayout>
  );
}
