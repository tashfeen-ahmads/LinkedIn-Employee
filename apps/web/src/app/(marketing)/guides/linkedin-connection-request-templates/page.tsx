import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, articleMeta, type Faq, type Source } from "@/components/article";
import { Gb1Pairs, Gb1Summary, NOTE_AIM } from "@/components/seo/gb1-visuals";
import {
  TEMPLATE_GROUPS,
  TEMPLATE_HEADROOM,
  allTemplates,
  noteLength,
  templateText,
  type NoteTemplate,
} from "@/components/seo/guide2-templates";
import { LINKEDIN_NOTE_LIMITS } from "@/lib/note-check";

const PATH = "/guides/linkedin-connection-request-templates";

export const metadata: Metadata = articleMeta(PATH);

const COUNT = allTemplates().length;

/*
 * Generic notes and their rewrites. The rewrites' counts are computed, so the
 * page cannot print a length its own text does not have.
 */
const REWRITES = [
  {
    before: "Hi Sam, I came across your profile and would love to add you to my professional network.",
    after:
      "Hi Sam, your post on moving dispatch off spreadsheets matched what we kept hearing from other ops leads. Would be good to connect.",
    changed: "Nothing in the original could only be said to Sam. The rewrite names one post and one reaction to it.",
  },
  {
    before: "Hi Dana, we help skincare brands scale paid social. Open to a quick call next week?",
    after:
      "Hi Dana, saw you moved from brand to growth at Lumen Skin this spring. Curious how you are splitting creative work now. Would be good to connect.",
    changed: "The pitch and the meeting ask are gone. The role change on her profile is the reason, and the close asks for nothing.",
  },
  {
    before: "Hi Chris, love your content! Let’s connect.",
    after:
      "Hi Chris, your point that most forecasts fail in week one, not week twelve, changed how I run our Monday review. Would be glad to connect.",
    changed: "Praise with no content becomes the idea itself, which proves the post was read.",
  },
  {
    before: "Hi Ana, thought you’d like our guide to field scheduling (link). Let’s connect!",
    after:
      "Hi Ana, saw Northside Mechanical is hiring two more techs. That is usually when evening scheduling gets heavier. Would be good to connect.",
    changed: "The link is gone, and with it the sales sequence it signaled. A public hiring push is the grounding instead.",
  },
] as const;

const FAQ: readonly Faq[] = [
  {
    q: "What is a good LinkedIn connection message?",
    a: `One that names a specific, true thing about the person, gives an honest reason to connect, asks for nothing and stays within ${INVITE_NOTE_MAX_CHARS} characters. A post they wrote, a role they just started or news about their company is enough. If the note could be sent unchanged to somebody else, it is not good yet.`,
  },
  {
    q: "Should you pitch in a connection request?",
    a: "No. The person has not agreed to hear from you yet, so a pitch reads as an advert and gives them a reason to decline. Get the connection first and save the offer for after they reply, when you know whether it is relevant. Nora works the same way: the offer is only made once somebody has replied.",
  },
  {
    q: "How long can a LinkedIn connection note be?",
    a: `LinkedIn’s help pages, as found in October 2026, give ${LINKEDIN_NOTE_LIMITS.free} characters for a note from a free account, and guides list ${LINKEDIN_NOTE_LIMITS.premium} for Premium. Aim for about ${NOTE_AIM.low} to ${NOTE_AIM.high} characters and treat ${INVITE_NOTE_MAX_CHARS} as the hard stop: that works on every account, and it is the cap Nora enforces.`,
  },
  {
    q: "Should I add a note to a LinkedIn connection request?",
    a: "Add one when you have something specific and true to say. A blank request is ordinary on LinkedIn and beats a generic note, which tells the reader you are running a script. Free accounts can only add a note to a small number of requests each month, so spend them where you have a real reason.",
  },
  {
    q: "Can I use the same template for everyone?",
    a: "You can, and recipients notice. A template with only the first name swapped reads as a mail merge, especially when two colleagues compare the notes they received. Use these templates as shapes: keep the structure, and fill it with a detail that is true of one person only.",
  },
];

const SOURCES: readonly Source[] = [
  {
    label: "LinkedIn Help: Personalize invitations to connect (note length and the free-account monthly allowance)",
    url: "https://www.linkedin.com/help/linkedin/answer/a563153",
  },
  {
    label: "LinkedIn Help: Connecting with other members, best practices (invitations to people you do not know)",
    url: "https://www.linkedin.com/help/linkedin/answer/62928",
  },
  {
    label: "LinkedIn Help: Prohibited software and extensions (User Agreement section 8.2)",
    url: "https://www.linkedin.com/help/linkedin/answer/a1341387",
  },
];

function NoteCard({ template }: { template: NoteTemplate }) {
  const length = noteLength(templateText(template));
  return (
    <li className="guide2-note">
      <p className="guide2-note-text">
        {template.parts.map((part, i) => (
          <Fragment key={i}>
            {typeof part === "string" ? part : <mark className="guide2-slot">{part.fill}</mark>}
          </Fragment>
        ))}
      </p>
      <div className="guide2-note-foot">
        <p className="guide2-note-count">
          <strong>Uses:</strong> {template.grounding}
        </p>
        <p className="guide2-note-count">
          {length} of {INVITE_NOTE_MAX_CHARS} characters
        </p>
      </div>
    </li>
  );
}

export default function Page() {
  return (
    <ArticleLayout
      path={PATH}
      h1="LinkedIn connection request templates that fit in 200 characters"
      lede={`The LinkedIn connection request templates that get accepted name one specific, true thing about the person, ask for nothing, and fit in ${INVITE_NOTE_MAX_CHARS} characters. Below are ${COUNT} of them, grouped by the situation that makes each one honest, every one annotated with the profile detail it uses and its character count.`}
      faq={FAQ}
      sources={SOURCES}
    >
      <Gb1Summary>
      <ul>
        <li>
          <strong>Use a template as a shape</strong>, never as text. The detail it is built on is
          the part that has to be true of one person only.
        </li>
        <li>
          <strong>Four rules:</strong> one specific observation, no pitch, no link, and no more than{" "}
          {INVITE_NOTE_MAX_CHARS} characters.
        </li>
        <li>
          <strong>No detail, no note.</strong> A blank request beats a generic one.
        </li>
        <li>
          <strong>Check before you send</strong> with the free{" "}
          <Link href="/tools/connection-note-checker">connection note checker</Link>, which flags
          length, links and pitch phrases.
        </li>
      </ul>
      </Gb1Summary>

      <h2 id="shapes">Templates are shapes, not text</h2>
      <p>
        Many template collections we read in October 2026 hand you finished sentences with a{" "}
        <code>{"{first_name}"}</code> gap. That is a fine place to start, but a finished sentence is
        easy to spot, because the reader may already have received it, word for word, from somebody
        else.
      </p>
      <p>
        So every LinkedIn connection request template on this page is annotated with what it is built
        on: the post, the role change, the company news. That detail is the note; the words around it
        are scaffolding. The highlighted words are the parts you replace, and if you cannot fill them
        with something true about the person in front of you, pick another template or send no note.
      </p>

      <h2 id="rules">Four rules every note follows</h2>

      <div className="gb1-sits">
        <section className="gb1-sit" aria-labelledby="rule-specific">
          <h3 id="rule-specific">One specific observation about them</h3>
          <p className="gb1-sit-when">
            One thing from their profile or their activity: a post, a talk, a new title, a hire, a
            milestone. One is enough. Three reads like a dossier, and a reader who feels researched
            rather than noticed is less likely to accept, not more.
          </p>
        </section>
        <section className="gb1-sit" aria-labelledby="rule-no-pitch">
          <h3 id="rule-no-pitch">No pitch</h3>
          <p className="gb1-sit-when">
            The note earns the connection; the conversation earns the pitch. &ldquo;We help&hellip;&rdquo;,
            &ldquo;our platform&rdquo; and &ldquo;15 minutes next week&rdquo; put a cost on the reader before
            they have a reason. The offer starts after they accept, in the{" "}
            <Link href="/guides/linkedin-follow-up-after-connection">first message after a connection is accepted</Link>.
          </p>
        </section>
        <section className="gb1-sit" aria-labelledby="rule-no-link">
          <h3 id="rule-no-link">No link</h3>
          <p className="gb1-sit-when">
            A link from a stranger asks them to leave LinkedIn for somewhere you chose, before they know
            who you are. It is the clearest sign of a sales sequence, and some people will not click
            anything from somebody they have not met. Save it for after they reply.
          </p>
        </section>
        <section className="gb1-sit" aria-labelledby="rule-length">
          <h3 id="rule-length">Up to {INVITE_NOTE_MAX_CHARS} characters</h3>
          <p className="gb1-sit-when">
            LinkedIn&rsquo;s help pages give {LINKEDIN_NOTE_LIMITS.free} on a free account and guides list{" "}
            {LINKEDIN_NOTE_LIMITS.premium} for Premium (October 2026). Aim for {NOTE_AIM.low} to {NOTE_AIM.high} and
            stop at {INVITE_NOTE_MAX_CHARS}: over it, LinkedIn can refuse the whole invitation. Every template here
            leaves {TEMPLATE_HEADROOM} or more spare.{" "}
            <Link href="/guides/linkedin-connection-note-character-limit">Why the published figures disagree</Link>.
          </p>
        </section>
      </div>

      <h2 id="templates">LinkedIn connection request templates by situation</h2>
      <p>Pick the situation you are actually in. If none fits, send the request without a note.</p>
      <ul className="guide2-jump" aria-label="Situations">
        {TEMPLATE_GROUPS.map((group) => (
          <li key={group.id}>
            <a href={`#${group.id}`}>{group.title}</a>
          </li>
        ))}
      </ul>

      {TEMPLATE_GROUPS.map((group) => (
        <section key={group.id} className="guide2-group" aria-labelledby={group.id}>
          <h3 id={group.id}>{group.title}</h3>
          <p className="guide2-group-meta">
            <strong>Use it when:</strong> {group.when}
          </p>
          <p className="guide2-group-meta">
            <strong>Watch out:</strong> {group.watch}
          </p>
          <ul className="guide2-notes">
            {group.templates.map((template) => (
              <NoteCard key={template.id} template={template} />
            ))}
          </ul>
        </section>
      ))}

      <h2 id="before-after">Before and after: generic notes rewritten</h2>
      <p>
        Each pair below starts from a note that gets sent thousands of times a day and ends with one
        that could only go to one person. The names and companies are invented.
      </p>
      <Gb1Pairs
        label="Generic notes and their rewrites"
        items={REWRITES.map((pair) => ({
          key: pair.before,
          left: { label: "Before", text: pair.before },
          right: { label: `After, ${noteLength(pair.after)} characters`, text: pair.after },
          note: (
            <>
              <strong>What changed:</strong> {pair.changed}
            </>
          ),
        }))}
      />

      <h2 id="not-to-write">What not to write</h2>
      <ul>
        <li>
          <strong>&ldquo;I&rsquo;d like to add you to my professional network.&rdquo;</strong> It
          says you had nothing to say. Send the request blank instead; our guide on{" "}
          <Link href="/guides/should-you-add-a-note-linkedin">whether to add a note at all</Link>{" "}
          covers when blank is the better choice.
        </li>
        <li>
          <strong>Fake familiarity.</strong> &ldquo;Great to reconnect&rdquo; to somebody you have
          never met, or a mutual connection who has not agreed to be named. Both are checked, and
          both cost you more than the connection.
        </li>
        <li>
          <strong>Flattery with no content.</strong> &ldquo;Impressive background!&rdquo; is sent to
          everybody. Name the thing that impressed you or say nothing.
        </li>
        <li>
          <strong>The calendar ask.</strong> A meeting request before acceptance is a request for
          time from a stranger.
        </li>
        <li>
          <strong>Emojis, hashtags and capital letters for emphasis.</strong> They read as marketing
          copy, and some counters treat one emoji as two characters.
        </li>
        <li>
          <strong>Mass sending to people you do not know.</strong> LinkedIn&rsquo;s own help pages
          say invitations can be restricted when too many recipients say they do not know you.
          Notes that land with the right people protect the account as well as the acceptance rate,
          which our <Link href="/guides/linkedin-acceptance-rate">LinkedIn acceptance rate guide</Link>{" "}
          explains.
        </li>
      </ul>

      <h2 id="at-scale">Writing one note per person at scale</h2>
      <p>
        These templates work when you send a few a day by hand. At campaign scale the temptation is to
        swap in a first name and send one sentence to everyone, which is the note this page tells you
        not to write. Nora is built the other way round:
      </p>
      <ul>
        <li>
          <strong>One note per prospect, with its sources shown.</strong> Each note is written from
          that person&rsquo;s own profile, and the details it used are listed beside it, like the
          &ldquo;Uses&rdquo; line on every template above. A note with nothing specific to stand on is
          flagged for you rather than passed off as personal.
        </li>
        <li>
          <strong>Your opening lines as a guide, never as a script.</strong> Openers you have approved
          shape the tone, but no two people receive the same sentence.
        </li>
        <li>
          <strong>You read the list before anything is sent.</strong> A note with a link goes as a blank
          request, and one over {INVITE_NOTE_MAX_CHARS} characters is replaced by the campaign&rsquo;s
          approved standard note.
        </li>
      </ul>
      <p>
        For how AI writing compares with templates in general, read{" "}
        <Link href="/guides/ai-personalized-linkedin-messages">AI-personalized LinkedIn messages</Link>;
        for the whole flow, see <Link href="/how-it-works">how Nora works</Link>. More on notes and
        limits lives in the <Link href="/guides">LinkedIn outreach guides</Link> and the{" "}
        <Link href="/tools">free LinkedIn tools</Link>.
      </p>
    </ArticleLayout>
  );
}
