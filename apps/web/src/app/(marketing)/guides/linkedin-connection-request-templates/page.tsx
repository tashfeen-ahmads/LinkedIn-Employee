import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { HOOK_MAX_CHARS, INVITE_NOTE_MAX_CHARS } from "@le/shared";
import { ArticleLayout, articleMeta, Callout, type Faq, type Source } from "@/components/article";
import {
  TEMPLATE_GROUPS,
  TEMPLATE_HEADROOM,
  allTemplates,
  noteLength,
  templateText,
  type NoteTemplate,
} from "@/components/seo/guide2-templates";
import { LINKEDIN_NOTE_LIMITS } from "@/lib/note-check";
import { PUBLIC_LIMITS, SITE } from "@/lib/site";

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
    before: "Hi Chris, love your content! Let's connect.",
    after:
      "Hi Chris, your point that most forecasts fail in week one, not week twelve, changed how I run our Monday review. Would be glad to connect.",
    changed: "Praise with no content becomes the idea itself, which proves the post was read.",
  },
  {
    before: "Hi Ana, thought you'd like our guide to field scheduling (link). Let's connect!",
    after:
      "Hi Ana, saw Northside Mechanical is hiring two more techs. That is usually when evening scheduling gets heavier. Would be good to connect.",
    changed: "The link is gone, and with it the sales sequence it signalled. A public hiring push is the grounding instead.",
  },
] as const;

const FAQ: readonly Faq[] = [
  {
    q: "What is a good LinkedIn connection message?",
    a: `One that names a specific, true thing about the person, gives an honest reason to connect, asks for nothing and stays under ${INVITE_NOTE_MAX_CHARS} characters. A post they wrote, a role they just started or news about their company is enough. If the note could be sent unchanged to somebody else, it is not good yet.`,
  },
  {
    q: "Should you pitch in a connection request?",
    a: "No. The person has not agreed to hear from you yet, so a pitch reads as an advert and gives them a reason to decline. Let the note earn the connection and the conversation earn the pitch, after they reply. Nora works the same way: the offer is only made once somebody has replied.",
  },
  {
    q: "How long can a LinkedIn connection note be?",
    a: `LinkedIn's help pages, as found in October 2026, give ${LINKEDIN_NOTE_LIMITS.free} characters for a note from a free account, and guides list ${LINKEDIN_NOTE_LIMITS.premium} for Premium. Writing to ${LINKEDIN_NOTE_LIMITS.free} works on every account. We have seen a 222-character note refused outright, so Nora caps every note at ${INVITE_NOTE_MAX_CHARS}.`,
  },
  {
    q: "Should I add a note to a LinkedIn connection request?",
    a: "Add one when you have something specific and true to say. A blank request is ordinary on LinkedIn and beats a generic note, which tells the reader you are running a script. Free accounts can only add a note to a small number of requests each month, so spend them where you have a real reason.",
  },
  {
    q: "Can I use the same template for everyone?",
    a: "You can, and recipients notice. A template with only the first name swapped reads as a mail-merge, especially when two colleagues compare the notes they received. Use these templates as shapes: keep the structure, and fill it with a detail that is true of one person only.",
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
  {
    label: "Overloop: LinkedIn connection request messages (templates by scenario, studied for this page)",
    url: "https://overloop.com/blog/linkedin-connection-request-messages",
  },
  {
    label: "SalesBread: 60 LinkedIn connection request message templates (studied for this page)",
    url: "https://salesbread.com/60-linkedin-connection-request-message-templates/",
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
      <p className="guide2-note-count">
        <strong>Uses:</strong> {template.grounding}
      </p>
      <p className="guide2-note-count">
        {length} of {INVITE_NOTE_MAX_CHARS} characters, {INVITE_NOTE_MAX_CHARS - length} to spare
      </p>
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
      <p>In short:</p>
      <ul>
        <li>
          <strong>Use a template as a shape</strong>, never as text. The detail it is built on is
          the part that has to be true of one person only.
        </li>
        <li>
          <strong>Four rules:</strong> one specific observation, no pitch, no link, under{" "}
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

      <h2 id="shapes">Templates are shapes, not text</h2>
      <p>
        Many template collections we read in October 2026 hand you finished sentences with a{" "}
        <code>{"{first_name}"}</code> gap. That is a fine place to start, but a finished sentence is
        easy to spot, because the reader may already have received it, word for word, from somebody
        else.
      </p>
      <p>
        So every LinkedIn connection request template on this page is annotated with what it is actually built on: the post,
        the role change, the company news. That detail is the note. The words around it are
        scaffolding you can rearrange freely. If you cannot fill the highlighted parts with something
        true about the person in front of you, that template is the wrong one, and possibly no
        template is right. The highlighted words are the parts you replace.
      </p>

      <h2 id="rules">Four rules every note follows</h2>

      <h3 id="rule-specific">One specific observation about them</h3>
      <p>
        One thing from their profile or their activity: a post, a talk, a new title, a hire, a
        milestone. One is enough. Three reads like a dossier, and a reader who feels researched
        rather than noticed is less likely to accept, not more.
      </p>

      <h3 id="rule-no-pitch">No pitch</h3>
      <p>
        The note earns the connection; the conversation earns the pitch, later, if they want it.
        &ldquo;We help...&rdquo;, &ldquo;our platform&rdquo; and &ldquo;15 minutes next week&rdquo;
        put the cost on the reader before you have given them a reason. If what you do is relevant,
        the first message after they accept is where it starts to come up, and our guide to the{" "}
        <Link href="/guides/linkedin-follow-up-after-connection">follow-up after a connection is accepted</Link>{" "}
        covers that message.
      </p>

      <h3 id="rule-no-link">No link</h3>
      <p>
        A link from a stranger asks them to leave LinkedIn for somewhere you chose, before they know
        who you are. It is the clearest sign of a sales sequence, and some people will not click
        anything from somebody they have not met. Save it for after they reply.
      </p>

      <h3 id="rule-length">Under 200 characters</h3>
      <p>
        As of October 2026, LinkedIn&rsquo;s help pages give {LINKEDIN_NOTE_LIMITS.free} characters
        for a note sent from a free account, and guides list {LINKEDIN_NOTE_LIMITS.premium} for
        Premium. We have watched LinkedIn refuse a 222-character note outright, so the whole
        invitation failed, not just the extra words. Writing to {INVITE_NOTE_MAX_CHARS} works on
        any account. Every template here leaves at least {TEMPLATE_HEADROOM} characters spare for a
        longer name or company than ours. The{" "}
        <Link href="/guides/linkedin-connection-note-character-limit">connection note character limit guide</Link>{" "}
        explains why the published figures disagree.
      </p>

      <h2 id="templates">LinkedIn connection request templates by situation</h2>
      <p>Jump to a situation:</p>
      <ul>
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
      {REWRITES.map((pair, i) => (
        <section key={pair.before} className="guide2-group" aria-label={`Rewrite ${i + 1}`}>
          <blockquote>
            <p>
              <strong>Before:</strong> &ldquo;{pair.before}&rdquo;
            </p>
          </blockquote>
          <blockquote>
            <p>
              <strong>After ({noteLength(pair.after)} characters):</strong> &ldquo;{pair.after}&rdquo;
            </p>
          </blockquote>
          <p className="guide2-group-meta">
            <strong>What changed:</strong> {pair.changed}
          </p>
        </section>
      ))}

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
        These templates work when you send a few a day by hand. At campaign scale they break, and we
        learned that ourselves. In an early version of Nora, everyone in a campaign got the
        campaign&rsquo;s template with their first name substituted. Each prospect&rsquo;s headline,
        title, company and about text had been searched for, scored and shown on screen, then dropped
        at the one moment it mattered. The product now works the way this page does:
      </p>
      <ul>
        <li>
          <strong>One note per prospect, with its grounding named.</strong> Nora writes each note
          from that person&rsquo;s own details and records up to three of them, quoted from the
          profile, as the note&rsquo;s grounding. That is the &ldquo;Uses&rdquo; line on every
          template above, done for real. A note with empty grounding is reported on the review
          screen rather than passed off as personal, and when a profile is too thin to say anything
          specific the writer says so instead of inventing familiarity.
        </li>
        <li>
          <strong>Approved openers are shapes, not text.</strong> The writer is handed every opening
          line you approved, capped at {HOOK_MAX_CHARS} characters so there is always room left for
          the person, and told to lean on them rather than paste them.
        </li>
        <li>
          <strong>A person reads the list before anything is sent.</strong> Nothing leaves until
          somebody presses Launch.
        </li>
        <li>
          <strong>A link means no note.</strong> A written note that contains a link is not trimmed
          into a broken sentence. It is dropped, and the invitation goes without a note.
        </li>
        <li>
          <strong>The limit is enforced in code.</strong> A note over {INVITE_NOTE_MAX_CHARS}{" "}
          characters is never sent. If the writer fails, the campaign falls back to its approved
          template rather than stopping, and records that it did.
        </li>
      </ul>
      <p>
        A perfect note does not protect an account that sends too many. LinkedIn&rsquo;s User
        Agreement prohibits automated access, so no tool can promise zero risk. Nora starts every
        account at {PUBLIC_LIMITS.invitesPerDayStart} connection requests a day, ramps to at most{" "}
        {PUBLIC_LIMITS.invitesPerDayMax} over about {PUBLIC_LIMITS.warmupWeeks} weeks from the first
        send, and stops at {PUBLIC_LIMITS.invitesPerWeek} a week. For how AI writing compares with
        templates in general, read{" "}
        <Link href="/guides/ai-personalized-linkedin-messages">AI-personalised LinkedIn messages</Link>
        ; for the whole flow, see <Link href="/how-it-works">how Nora works</Link>. More on notes and
        limits lives in the <Link href="/guides">LinkedIn outreach guides</Link> and the{" "}
        <Link href="/tools">free LinkedIn tools</Link>.
      </p>

      <Callout tone="safety">
        Want each note written for its person, with the details it used shown, and read by you
        before launch? <a href={`${SITE.app}/signup`}>Sign up free</a>. No card.
      </Callout>
    </ArticleLayout>
  );
}
