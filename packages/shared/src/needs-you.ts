/**
 * What needs a person, as one ordered list.
 *
 * This is the question a rep arrives with, and until now the product answered
 * it in five places and nowhere. The overview opened with a next-step card, a
 * strategy panel, a six-item checklist, a row of counters and a table — five
 * sections of equal weight — and the answer to "what is stopped until I do
 * something" was distributed across all of them plus the sidebar's single dot.
 * Everything below was already in the database. Nobody had ever assembled it
 * into a list.
 *
 * Pure for the reason `report.ts` is: three callers read it — the overview, the
 * nav's count, and the weekly email later — and if each assembled its own
 * version they would disagree about how many things need you, with the rep
 * believing whichever they happened to look at. That is rule 32's whole
 * argument, applied to the thing the nav counts.
 *
 * Four rules, each of them a mistake made somewhere else in this product.
 *
 * A blocker comes first. A held reply matters and it matters less than nobody
 * being able to send the answer: while the sending loop is down or the LinkedIn
 * account is disconnected, every other row is a job that cannot complete. Rule
 * 21 is explicit that a dead loop outranks every gentler explanation.
 *
 * Nothing is hidden. Rule 32 lets a disconnected account silence every other
 * *mark*, because a sidebar with six dots has no dots — but this is a to-do
 * list, and dropping work from a to-do list because other work exists is how
 * something waits a fortnight. It is ordered, not filtered.
 *
 * Zero items is the good day and has to look like one. Not an empty state
 * apologising: a sentence. A dashboard that looks broken when everything is
 * fine teaches people to stop opening it.
 *
 * And every row names what happens if nobody does it. "1 strategy needs review"
 * is a chore; "nothing is searched for until one is approved" is a reason.
 */

/** The stable name of a thing that can be waiting. Used by tests and the nav. */
export type NeedsYouKind =
  | "loop_stalled"
  | "linkedin_disconnected"
  | "held_reply"
  | "held_booking"
  | "pitch_unapproved"
  | "hook_unapproved"
  | "strategy_unapproved"
  | "campaign_unlaunched"
  | "thin_notes"
  | "cta_missing";

export interface NeedsYouItem {
  kind: NeedsYouKind;
  /** The row's sentence, already counted and plural-correct. */
  title: string;
  /** What happens if nobody does it. Never a restatement of the title. */
  why: string;
  href: string;
  /** The button. A verb, and the same verb the destination screen uses. */
  action: string;
  /**
   * `blocker` is the class of thing that stops every other row completing, and
   * it is the only tone that may sort above a held conversation.
   */
  tone: "blocker" | "warning";
  /** How many. One row per kind, never one row per instance. */
  count: number;
}

export interface NeedsYouFacts {
  /** The pacing loop has not stamped recently (rule 21). */
  loopStalled: boolean;
  /** A LinkedIn account exists and is active. */
  linkedInConnected: boolean;
  /** Conversations held right now for a reply, and for a manual booking. */
  heldReplies: number;
  heldBookings: number;
  /**
   * An approved pitch or opener is missing while a campaign step needs one.
   *
   * Counted as a blocker rather than a chore, because rule 40 makes the pitch
   * the entire body of the message: a follow-up with no approved pitch is
   * **held**, its schedule untouched, and there is no second chance at a first
   * follow-up. The hold is correct and it was invisible — nothing on any screen
   * said a real conversation was stopped waiting for somebody to read one line.
   */
  heldForCopy: number;
  /** Written by an agent, never approved. Nothing is sent from these. */
  pitchesUnapproved: number;
  hooksUnapproved: number;
  /** Strategies the Strategy Agent wrote that nobody has approved (rule 9). */
  strategiesUnapproved: number;
  /** Campaigns with a reviewed list that were never launched. */
  campaignsUnlaunched: number;
  /**
   * Campaigns whose notes fell back to the template, or whose notes cite
   * nothing about the person (rules 16 and 27).
   */
  campaignsWithThinNotes: number;
  /** Campaigns whose copy carries {{cta_link}} with no destination (rule 29). */
  campaignsMissingCta: number;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const isare = (n: number) => (n === 1 ? "is" : "are");

/**
 * The list, ordered by what is most expensive to leave undone.
 *
 * Blockers, then the warm leads going cold, then the work that has not started.
 * Within a tone the order is fixed rather than by count: a list that reorders
 * itself as numbers move is a list somebody has to read from the top every
 * time.
 */
export function needsYou(facts: NeedsYouFacts): NeedsYouItem[] {
  const items: NeedsYouItem[] = [];

  /*
   * The deployment first, because every row below it is a job that cannot
   * finish. A campaign launched into a dead worker and a campaign correctly
   * waiting out its gap are the same screen, and the first live launch was
   * spent on that question.
   */
  if (facts.loopStalled) {
    items.push({
      kind: "loop_stalled",
      title: "Nothing is being sent: the sending loop is not running.",
      why: "This is the deployment rather than your campaigns. Nothing queued goes out until it is back, and everything else on this list is waiting behind it.",
      href: "/app/system",
      action: "Open the system check",
      tone: "blocker",
      count: 1,
    });
  }

  if (!facts.linkedInConnected) {
    items.push({
      kind: "linkedin_disconnected",
      title: "Your LinkedIn account is not connected.",
      why: "Every invitation, message and reply goes through it, so nothing reaches anybody until it is reconnected.",
      href: "/app/profile#team",
      action: "Reconnect LinkedIn",
      tone: "blocker",
      count: 1,
    });
  }

  /*
   * A conversation stopped mid-flow, which is the most expensive row here.
   *
   * A prospect who asked "how much is it?" on a Friday and is never answered is
   * not a conversation being handled carefully, it is a warm lead lost — and the
   * funnel then reads 0% for a reason no screen explains.
   */
  if (facts.heldReplies > 0) {
    items.push({
      kind: "held_reply",
      title: `${plural(facts.heldReplies, "reply", "replies")} ${isare(facts.heldReplies)} waiting for you.`,
      why: "Each one has a draft ready to read and send. A prospect who asked a question on Friday and hears nothing is a warm lead going cold, not a conversation being handled carefully.",
      href: "/app/inbox",
      action: "Open the inbox",
      tone: "warning",
      count: facts.heldReplies,
    });
  }

  if (facts.heldBookings > 0) {
    items.push({
      kind: "held_booking",
      title: `${plural(facts.heldBookings, "meeting")} ${isare(facts.heldBookings)} waiting to be put in a diary.`,
      why: "Somebody agreed to a time and the booking has to be made by hand. Sending a reply does not clear this one.",
      href: "/app/inbox?stage=waiting",
      action: "Open the inbox",
      tone: "warning",
      count: facts.heldBookings,
    });
  }

  /*
   * A follow-up held for want of an approved line.
   *
   * Rule 40 holds the message rather than failing it, and leaves its schedule
   * untouched, because approving a pitch is the whole of what it takes to send
   * it. That is right and it was silent: a real accepted connection sat waiting
   * on somebody reading ninety characters, and no screen said so.
   *
   * There is no equivalent for the opener, deliberately. A missing approved
   * opener holds nothing — the invite writer falls back to the strategy's own
   * and then to the campaign template (rule 40), so a field for it would be a
   * number wired to zero, which is how a setting comes to exist and mean
   * nothing.
   */
  if (facts.heldForCopy > 0) {
    items.push({
      kind: "pitch_unapproved",
      title: `${plural(facts.heldForCopy, "conversation")} ${isare(facts.heldForCopy)} held: the copy they need has not been approved.`,
      why: "The message body is the offer, so it is held rather than sent half-written. Its schedule is untouched — approving one line sends it.",
      href: "/app/agents",
      action: "Read and approve the offer",
      tone: "blocker",
      count: facts.heldForCopy,
    });
  } else if (facts.pitchesUnapproved > 0) {
    items.push({
      kind: "pitch_unapproved",
      title: `${plural(facts.pitchesUnapproved, "offer")} ${isare(facts.pitchesUnapproved)} written and waiting for you.`,
      why: "An agent wrote them and cannot approve them. Nothing is sent from an unapproved line, so the first prospect who asks what this is gets no answer.",
      href: "/app/agents",
      action: "Review the offers",
      tone: "warning",
      count: facts.pitchesUnapproved,
    });
  }

  if (facts.hooksUnapproved > 0) {
    items.push({
      kind: "hook_unapproved",
      title: `${plural(facts.hooksUnapproved, "opener")} ${isare(facts.hooksUnapproved)} written and waiting for you.`,
      why: "The invitation writer leans on the approved ones. Until one is approved it falls back to the campaign's generic line.",
      href: "/app/agents",
      action: "Review the openers",
      tone: "warning",
      count: facts.hooksUnapproved,
    });
  }

  /*
   * Notes that read as personalised and are not.
   *
   * Above the unlaunched campaign deliberately: this is a campaign that will
   * launch and send the wrong thing, which is worse than one that has not
   * launched at all.
   */
  if (facts.campaignsWithThinNotes > 0) {
    items.push({
      kind: "thin_notes",
      title: `${plural(facts.campaignsWithThinNotes, "campaign")} ${isare(facts.campaignsWithThinNotes)} sending notes that are not personalised.`,
      why: "The writer fell back to the template, so those notes read as generic on arrival. The agent can rewrite them before anybody is invited.",
      href: "/app/campaigns",
      action: "Review the notes",
      tone: "warning",
      count: facts.campaignsWithThinNotes,
    });
  }

  if (facts.campaignsMissingCta > 0) {
    items.push({
      kind: "cta_missing",
      title: `${plural(facts.campaignsMissingCta, "campaign")} ${isare(facts.campaignsMissingCta)} asking people to click a link that is not set.`,
      why: "The copy carries a placeholder with no destination behind it, so the last message arrives with the placeholder visible.",
      href: "/app/cta",
      action: "Set the destination",
      tone: "warning",
      count: facts.campaignsMissingCta,
    });
  }

  if (facts.strategiesUnapproved > 0) {
    items.push({
      kind: "strategy_unapproved",
      title: `${plural(facts.strategiesUnapproved, "strategy", "strategies")} ${isare(facts.strategiesUnapproved)} written and waiting for you.`,
      why: "Nothing is searched for until one is approved. Check each is somebody who would buy from you rather than somebody who does what you do.",
      href: "/app/strategy",
      action: "Read and approve",
      tone: "warning",
      count: facts.strategiesUnapproved,
    });
  }

  if (facts.campaignsUnlaunched > 0) {
    items.push({
      kind: "campaign_unlaunched",
      title: `${plural(facts.campaignsUnlaunched, "campaign")} ${isare(facts.campaignsUnlaunched)} built and never launched.`,
      why: "The list is picked and the notes are written. Nobody is invited until you launch it.",
      href: "/app/campaigns",
      action: "Review and launch",
      tone: "warning",
      count: facts.campaignsUnlaunched,
    });
  }

  return items;
}

/*
 * There is no `needsYouCount`, deliberately.
 *
 * The plan called for the nav to carry "how many things need you", and writing
 * it made the argument against it: the nav already has exactly one number, the
 * Inbox badge, and a second badge reading 8 beside it reading 3 invites
 * arithmetic nobody wants to do — which is rule 32's point about marks applied
 * to counts. The two answer different questions and neither sums with the
 * other.
 *
 * `items.length` is one expression at the one call site that wants it. A
 * function wrapping it, exported and tested, would have been a thing that
 * exists and changes nothing.
 */

/** The sentence for a day with nothing on the list. Never the word "None". */
export const NOTHING_NEEDS_YOU = "Nothing needs you. Here is what your agent did.";
