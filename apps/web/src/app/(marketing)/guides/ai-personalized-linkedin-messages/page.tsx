import type { Metadata } from "next";
import Link from "next/link";
import { HOOK_MAX_CHARS, INVITE_NOTE_MAX_CHARS, MIN_SENDS_TO_COMPARE } from "@le/shared";
import { ArticleLayout, articleMeta, Callout, CompareTable, type Faq, type Source } from "@/components/article";
import { LINKEDIN_NOTE_LIMITS } from "@/lib/note-check";
import { SITE } from "@/lib/site";

const PATH = "/guides/ai-personalized-linkedin-messages";

export const metadata: Metadata = articleMeta(PATH);

/*
 * An invented prospect, labelled as such on the page, used to show what a
 * grounded note looks like. The note's length is measured the way Nora
 * measures one, so the page cannot claim a note fits when it does not.
 */
const EXAMPLE_PROFILE = [
  { field: "Headline", value: "Head of Partnerships at Fernhill Studio | Building our referral channel from zero" },
  { field: "Title", value: "Head of Partnerships" },
  { field: "Company", value: "Fernhill Studio (design agency, 40 people)" },
  { field: "About (excerpt)", value: "Joined in January to turn ad-hoc client referrals into a programme." },
] as const;

const EXAMPLE_NOTE =
  "Hi Lena, building a referral channel from zero at a 40-person studio is a job most agencies never give anyone. I'd be curious how you are tracking it so far. Glad to connect.";

const EXAMPLE_GROUNDING = ["\"Building our referral channel from zero\"", "\"Fernhill Studio (design agency, 40 people)\""] as const;

const TEMPLATE_NOTE = "Hi {first_name}, I see you're the {title} at {company}. I'd love to connect and share ideas.";

const FAQ: readonly Faq[] = [
  {
    q: "Can AI write personalized LinkedIn connection requests?",
    a: `Yes, if it is given the person's real details and told to use only those. The model reads their headline, role, company and about text and writes one short note per person, under ${INVITE_NOTE_MAX_CHARS} characters. The part that needs care is not the writing; it is stopping the model inventing details and checking that each note actually used something about the person.`,
  },
  {
    q: "Is AI personalization detectable on LinkedIn?",
    a: "Usually not by the reader, according to a 2026 University of Michigan and Duke study: people rarely noticed AI-written personal messages. But they judged senders harshly once they knew or strongly suspected AI was used. So the risk is a note that gives itself away: invented details, generic praise, or the same sentence sent to colleagues.",
  },
  {
    q: "Do personalized connection notes get more replies?",
    a: "Vendor datasets reported in 2026 point that way: notes barely change acceptance but are associated with more replies afterwards, with one widely quoted pair being 9.36% against 5.44%. Those figures come from secondary reports whose original source we could not confirm, so treat them as direction, not a promise.",
  },
  {
    q: "Should a human approve AI LinkedIn messages?",
    a: "Yes, before launch. A person reading the notes catches the failures a model cannot see in itself: a detail that is technically true but awkward, a tone that is wrong for the market, an audience that should not be contacted at all. In Nora, nothing is sent until someone reviews the campaign and presses Launch.",
  },
  {
    q: "What happens if the AI cannot find anything to say about someone?",
    a: "It should say so rather than pad. Nora's writer marks a note as having too little to go on and writes a plain, honest one instead of inventing a reason. That flag shows on the review screen, where you can edit the note or remove the person. A note with nothing specific is a signal, not a failure to hide.",
  },
];

const SOURCES: readonly Source[] = [
  {
    label: "University of Michigan Psychology: People remain 'blissfully ignorant' of AI use in everyday messages (Zhu and Molnar, Computers in Human Behavior, 2026)",
    url: "https://prod.lsa.umich.edu/psych/news-events/all-news/faculty-news/people-remain--blissfully-ignorant--of-ai-use-in-everyday-messag.html",
  },
  {
    label: "PsyPost: People remain blissfully ignorant of AI use in everyday messages",
    url: "https://www.psypost.org/people-remain-blissfully-ignorant-of-ai-use-in-everyday-messages-new-research-shows/",
  },
  {
    label: "Gracker: InMail vs connection requests (quotes 9.36% vs 5.44%, attributed to Expandi)",
    url: "https://gracker.ai/blog/linkedin-inmail-vs-connection-requests",
  },
  {
    label: "Expandi: LinkedIn acceptance rate in 2026 (reports the Belkins 20M+ study)",
    url: "https://expandi.io/blog/linkedin-acceptance-rate/",
  },
  {
    label: "Valley: How to personalize LinkedIn messages at scale using AI",
    url: "https://joinvalley.co/blog/how-to-personalize-linkedin-messages-at-scale-using-ai-1",
  },
  {
    label: "SalesMind: How AI personalizes LinkedIn connection requests",
    url: "https://sales-mind.ai/blog/ai-personalizes-linkedin-connection-requests",
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
      h1="AI personalized LinkedIn messages: personal you can check, not just claim"
      lede="AI personalized LinkedIn messages work when the model writes each note from that person's own profile and records which details it used, so you can check the note is personal rather than take it on trust. Add a human review before launch and enforce the length and no-link rules in code, and AI writing becomes safer than most templates."
      faq={FAQ}
      sources={SOURCES}
    >
      <p>
        Nearly every outreach tool now says its messages are AI-personalised. As of October 2026, the pages
        that rank for this query mostly describe the idea and quote a lift in acceptance or replies
        without showing what any one message actually used. This guide is about the part they
        skip: how to tell whether a message is personal, and the guardrails that stop an AI writer doing
        damage under your name.
      </p>

      <h2 id="what-personalised-means">What &lsquo;personalised&rsquo; should mean</h2>
      <p>
        A message is personalised when it could not have been sent to anyone else without becoming false.
        That is a stricter test than it sounds. &ldquo;I see you work in marketing&rdquo; passes a merge
        field but fails the test: it is true of millions of people. &ldquo;Your post on pricing pages for
        agencies&rdquo; passes, because it is about one person&rsquo;s work.
      </p>
      <p>Three things follow from that definition:</p>
      <ul>
        <li>
          <strong>It must be true.</strong> A personal detail the model invented (&ldquo;loved your recent
          post&rdquo; when there was none) is worse than no detail, because the reader knows instantly.
        </li>
        <li>
          <strong>It must be about them, not about you.</strong> Personalising the pitch (&ldquo;agencies like
          Fernhill need our tool&rdquo;) is still a pitch.
        </li>
        <li>
          <strong>It must be checkable.</strong> If nobody can see what the message was based on, nobody can
          tell personalised from plausible.
        </li>
      </ul>

      <h2 id="grounding">Grounding: naming the details a message used</h2>
      <p>
        Grounding means the writer reports, next to each message, which of the person&rsquo;s details it
        relied on, quoted from their profile. It turns &ldquo;is this personal?&rdquo; from a matter of
        opinion into something you can verify in a second: read the note, read what it claims to be based
        on, check they match.
      </p>

      <h3 id="fields">Headline, role, company, about text</h3>
      <p>
        These are the fields that exist for nearly everyone a LinkedIn search returns. With company size,
        industry and location, they are all Nora&rsquo;s writer is given about a person. It is told to use
        only those, never to state or imply anything else, and to quote what it used. Here is the shape with an invented prospect:
      </p>
      <CompareTable
        caption="An invented prospect's details, as the writer receives them"
        columns={["Value"]}
        rows={EXAMPLE_PROFILE.map((row) => ({ label: row.field, values: [row.value] }))}
      />
      <blockquote>
        <p>&ldquo;{EXAMPLE_NOTE}&rdquo;</p>
        <p>
          {EXAMPLE_NOTE.length} of {INVITE_NOTE_MAX_CHARS} characters. Grounded in:{" "}
          {EXAMPLE_GROUNDING.join(" and ")}.
        </p>
      </blockquote>
      <p>
        Notice what it does not say. It does not claim she wrote a post, does not guess her budget, does not
        mention a mutual connection, and does not describe the sender&rsquo;s product. Every specific word
        traces to a field above.
      </p>

      <h3 id="empty-grounding">Empty grounding is a warning sign</h3>
      <p>
        Some profiles give a writer nothing: a headline of just a job title, no about text, a company name
        and nothing else. A model asked to be personal will fill that gap by inventing something. Nora&rsquo;s
        writer is told to do the opposite: mark the note as too thin and write a short, plain one. That flag
        appears on the campaign&rsquo;s review screen as &ldquo;too little to go on&rdquo;, next to the
        note, so you can edit it or drop the person before launch. A note that cites nothing looks exactly
        like one that cites everything unless something says otherwise.
      </p>

      <h2 id="templates-are-not-personal">Why a template with {"{first_name}"} is not personalisation</h2>
      <p>A merge-field template looks like this:</p>
      <blockquote>
        <p>&ldquo;{TEMPLATE_NOTE}&rdquo;</p>
      </blockquote>
      <p>
        Every recipient gets the same sentence with three words swapped. Two colleagues who compare notes
        see it immediately, and so does anyone who has received a few hundred of them. It also fails
        quietly: an empty {"{title}"} field produces &ldquo;the at&rdquo;, and the tool has no way to know.
      </p>
      <p>
        We made this mistake ourselves. In an early version of Nora, every prospect in a campaign received
        the campaign&rsquo;s template with their first name substituted. Their headline, title, company and
        about text had been searched for, scored, stored and shown on screen, then dropped at the one moment
        they mattered. Writing one note per person from those details, matched to the right person by their
        LinkedIn ID rather than by position in a list, is what replaced it. The ID matching matters more than
        it sounds: matching by position means one off-by-one error sends a paragraph about one person to
        another. For hand-written shapes that avoid merge fields, see the{" "}
        <Link href="/guides/linkedin-connection-request-templates">connection request templates by situation</Link>.
      </p>

      <h2 id="detectable">Is AI personalisation detectable?</h2>
      <p>
        Mostly not by reading, according to the best evidence we found. A 2026 study by researchers at the
        University of Michigan and Duke, published in <em>Computers in Human Behavior</em>, ran experiments
        with more than 1,300 US adults across email, social media and text messages. Recipients rarely
        suspected AI when nothing told them, and rated those senders about as warmly as senders of
        human-written messages. But when people knew a message was AI-written, they rated the sender much
        more negatively, with words like &ldquo;lazy&rdquo; and &ldquo;insincere&rdquo;.
      </p>
      <p>
        So the practical risk is not a detector. It is a message that gives itself away: an invented detail,
        praise that could apply to anyone, the same phrasing arriving at two people in one team, or the
        over-polished tone of &ldquo;I hope this message finds you well&rdquo;. Nora&rsquo;s writer is told
        to write like one person typing to another, in plain words, with no exclamation marks and no stock
        openers. The study did not test LinkedIn specifically, and its authors note that suspicion in the real
        world may be higher than in an experiment.
      </p>

      <h2 id="guardrails">Guardrails AI personalized LinkedIn messages need</h2>
      <p>
        A prompt is a request, not a guarantee. Models write fluently past their instructions, so every rule
        that matters has to be checked after the writing, in code.
      </p>

      <h3 id="length">Under the length limit, checked in code</h3>
      <p>
        LinkedIn limits connection notes to {LINKEDIN_NOTE_LIMITS.free} characters on a free account, as of October 2026, and an over-length note can get
        the whole invitation refused. Nora caps notes at {INVITE_NOTE_MAX_CHARS} and checks each one after the
        model returns it, because the model&rsquo;s own schema does not reliably enforce length. A note over
        the cap is never cut mid-sentence; it is discarded. The{" "}
        <Link href="/tools/connection-note-checker">connection note checker</Link> applies the same count to
        anything you paste.
      </p>

      <h3 id="no-links">No links in the invitation</h3>
      <p>
        A link in a connection request reads as a funnel. Every note is checked for a link, by any of the ways
        one gets in, before it is sent, and a note that carries one goes out as no note at all rather than as a
        sentence with a hole in it. The same check holds a reply that contains a link the agent was never given,
        because a model asked for a booking link will happily write a plausible one that goes nowhere.
      </p>

      <h3 id="human-review">A human reads the copy before launch</h3>
      <p>
        Every campaign arrives as a draft with each person&rsquo;s note on screen, editable. Nothing is sent
        until somebody presses Launch. Approved opening lines, which the writer leans on as shapes rather than
        text to paste, are each capped at {HOOK_MAX_CHARS} characters and approved one at a time; editing one
        clears its approval.
      </p>

      <h3 id="fallback">A fallback when the writer fails</h3>
      <p>
        Models time out and providers have bad afternoons. When the note writer fails, the campaign is still
        built, with its approved fallback note, and the campaign records that personalised notes are missing.
        Degrading silently would be its own failure: a review screen that reads as personalised when it is not.
        If the fallback cannot be filled in for someone, for example because their company field is empty, that
        person gets no note rather than a broken one.
      </p>

      <h2 id="angles">Angles, not wording: what to test</h2>
      <p>
        Once every note is different, a classic A/B test of message text stops making sense: you would be
        comparing hundreds of one-off sentences. What a campaign can hold constant and vary is the{" "}
        <strong>angle</strong>: the pain named, the reason for reaching out. Nora assigns prospects to angles in
        strict rotation rather than at random, so the groups stay even, keeps each person&rsquo;s angle for the
        whole sequence, and will not call one angle ahead until each has at least {MIN_SENDS_TO_COMPARE}{" "}
        invitations sent and their likely ranges stop overlapping. How to read those ranges is in the{" "}
        <Link href="/guides/linkedin-acceptance-rate">guide to LinkedIn acceptance rates</Link>.
      </p>

      <Callout tone="safety">
        Any tool that sends LinkedIn messages for you, Nora included, runs against LinkedIn&rsquo;s user
        agreement, which prohibits automated activity; no tool can promise zero risk. See{" "}
        <Link href="/how-it-works">how Nora works</Link> for the caps and pacing it uses, or{" "}
        <a href={`${SITE.app}/signup`}>Sign up free</a> to see a note per person, with its grounding, before
        anything is sent. No card. More in the <Link href="/guides">LinkedIn outreach guides</Link>.
      </Callout>
    </ArticleLayout>
  );
}
