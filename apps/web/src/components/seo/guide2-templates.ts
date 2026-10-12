/**
 * The connection note templates on /guides/linkedin-connection-request-templates.
 *
 * Each template is stored as a worked example with the parts a reader would
 * swap marked as slots, so the character count printed beside it is the count
 * of a real note rather than of a skeleton full of brackets. The test in
 * test/seo-templates.test.ts holds every one under INVITE_NOTE_MAX_CHARS with
 * room to spare for a longer name, and checks none carries a link: a page
 * that teaches notes LinkedIn would refuse is worse than no page.
 */

export type NotePart = string | { slot: string; fill: string };

export interface NoteTemplate {
  id: string;
  parts: readonly NotePart[];
  /**
   * The detail on the recipient's profile or activity the note is built on,
   * named the way Nora's writer names its own grounding: if this is empty in
   * real life, the note could have gone to anybody and should not be sent.
   */
  grounding: string;
}

export interface TemplateGroup {
  id: string;
  title: string;
  /** When this situation is real enough to write from. */
  when: string;
  /** The way this kind of note most often goes wrong. */
  watch: string;
  templates: readonly NoteTemplate[];
}

/** Room every example leaves for a longer name, company or topic than ours. */
export const TEMPLATE_HEADROOM = 20;

export const TEMPLATE_GROUPS: readonly TemplateGroup[] = [
  {
    id: "their-post",
    title: "They posted something you read",
    when: "You read the post and have a specific reaction to one point in it.",
    watch: "\"Loved your post\" is the note everybody sends. Quote the idea, not the praise.",
    templates: [
      {
        id: "post-point",
        grounding: "A recent post, and one argument inside it",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Elena" },
          ", your post on ",
          { slot: "post topic", fill: "why you stopped gating case studies" },
          " made me rethink ours, especially the point about ",
          { slot: "one detail", fill: "shorter sales cycles" },
          ". Would like to follow your writing.",
        ],
      },
      {
        id: "post-numbers",
        grounding: "A post that shared figures from their own work",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Tom" },
          ", I read your breakdown of ",
          { slot: "post topic", fill: "onboarding churn in week two" },
          ". Rare to see real numbers shared. Glad to connect if you're open to it.",
        ],
      },
    ],
  },
  {
    id: "new-role",
    title: "They changed role",
    when: "The move is recent, within the last two months or so, and shows on their profile.",
    watch: "Everybody congratulates. Say one true thing about what the new role involves.",
    templates: [
      {
        id: "role-first-90",
        grounding: "Their new title and company, from the experience section",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Owen" },
          ", congratulations on the move to ",
          { slot: "new title", fill: "VP Operations" },
          " at ",
          { slot: "company", fill: "Halden" },
          ". The first ninety days in a role like that are a lot. Glad to connect.",
        ],
      },
      {
        id: "role-promoted",
        grounding: "An internal promotion: the old title and the new one",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Mei" },
          ", saw you moved from ",
          { slot: "old title", fill: "clinic lead" },
          " to ",
          { slot: "new title", fill: "practice manager" },
          " at ",
          { slot: "company", fill: "Riverside Clinic" },
          ". Running the rota after working it must look different. Would be good to connect.",
        ],
      },
    ],
  },
  {
    id: "company-news",
    title: "Their company was in the news",
    when: "The news is about their company and is public: an office, a milestone, a launch, a hiring push.",
    watch: "Keep it about them. A note that pivots from their news to your product is a pitch, and offering candidates or services to a company that is hiring is the same mistake.",
    templates: [
      {
        id: "news-expansion",
        grounding: "A company announcement: a new office",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Fatima" },
          ", congratulations on ",
          { slot: "company", fill: "Corvel" },
          " ",
          { slot: "news", fill: "opening the Manchester office" },
          ". A second city is no small thing. Would be glad to connect.",
        ],
      },
      {
        id: "news-hiring",
        grounding: "Open roles on the company page that say what the team is building",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Nadia" },
          ", noticed you're hiring ",
          { slot: "the roles", fill: "your first two SDRs" },
          ". Building that function from zero is a big step. Would be glad to connect.",
        ],
      },
      {
        id: "news-milestone",
        grounding: "A headcount milestone the company posted",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Leo" },
          ", read that ",
          { slot: "company", fill: "Tillmark" },
          " just passed ",
          { slot: "milestone", fill: "100 staff" },
          ". Curious how the ops side changes at that size. Open to connecting?",
        ],
      },
    ],
  },
  {
    id: "group-or-event",
    title: "A shared group or event",
    when: "You have both taken part: posted or commented in the group, or attended the same event. Joining the same group years ago is not a reason.",
    watch: "Membership alone is weak. Name something the person said there, and send an event note within a week, while the event is still the reason.",
    templates: [
      {
        id: "group-answer",
        grounding: "Something they wrote in a group you are both active in",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Priya" },
          ", we're both in ",
          { slot: "group", fill: "Bootstrapped SaaS Founders" },
          ". Your answer on ",
          { slot: "topic", fill: "annual vs monthly pricing" },
          " was the most useful in that thread. Would be good to connect.",
        ],
      },
      {
        id: "event-talk",
        grounding: "A talk they gave, and one point from it",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Laura" },
          ", I was in the room for your ",
          { slot: "event", fill: "Ops Leaders" },
          " talk on ",
          { slot: "talk topic", fill: "usage pricing" },
          ". The part about ",
          { slot: "one detail", fill: "billing surprises" },
          " stuck with me. Would be glad to connect.",
        ],
      },
    ],
  },
  {
    id: "mutual-connection",
    title: "A mutual connection who knows you both",
    when: "The mutual connection actually knows you both and has agreed to be named.",
    watch: "Never name somebody who has not agreed to it. The first reply is often a message to them.",
    templates: [
      {
        id: "mutual-referred",
        grounding: "A named introduction, plus the topic they are known for",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Aisha" },
          ", ",
          { slot: "mutual connection", fill: "Daniel Okafor" },
          " said you're the person to talk to about ",
          { slot: "topic", fill: "partner programmes in fintech" },
          ". I'd value being connected.",
        ],
      },
      {
        id: "mutual-shared-past",
        grounding: "A shared former colleague, and their current function",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Ben" },
          ", we both know ",
          { slot: "mutual connection", fill: "Sara Lindqvist" },
          " from ",
          { slot: "where", fill: "her time at Northwind" },
          ". She speaks highly of how you run ",
          { slot: "their team", fill: "RevOps" },
          ". Would be glad to connect.",
        ],
      },
    ],
  },
  {
    id: "same-niche",
    title: "Same niche, different side of the table",
    when: "You serve their industry rather than work in it, and you know it well enough to have a view.",
    watch: "Say which side you are on in plain words, then stop. Pretending to be a peer when you are a supplier reads as a trick the moment they look at your profile.",
    templates: [
      {
        id: "niche-supplier",
        grounding: "Their industry, and a post about a problem in it",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Rachel" },
          ", I spend most weeks with ",
          { slot: "their industry", fill: "freight forwarders" },
          " from the ",
          { slot: "your side", fill: "software" },
          " side, and your post on ",
          { slot: "their topic", fill: "customs delays" },
          " matched what I keep hearing. Would be good to connect.",
        ],
      },
      {
        id: "niche-finance",
        grounding: "Their business type and size, and a post about running it",
        parts: [
          "Hi ",
          { slot: "first name", fill: "Jonas" },
          ", I work with ",
          { slot: "their industry", fill: "dental groups" },
          " on the ",
          { slot: "your side", fill: "finance" },
          " side, so your post on ",
          { slot: "their topic", fill: "hiring hygienists across three sites" },
          " caught my eye. Happy to connect.",
        ],
      },
    ],
  },
];

export function templateText(template: NoteTemplate): string {
  return template.parts.map((part) => (typeof part === "string" ? part : part.fill)).join("");
}

/** Characters as a person counts them, so an accented name counts once. */
export function noteLength(text: string): number {
  return [...text].length;
}

export function allTemplates(): NoteTemplate[] {
  return TEMPLATE_GROUPS.flatMap((group) => group.templates);
}
