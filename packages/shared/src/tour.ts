import { ONBOARDING_STEPS, type OnboardingState } from "./onboarding.js";
import { LINKEDIN_LIMITS } from "./constants.js";
import { SUSTAINED_INVITES_PER_DAY, WEEKS_TO_SUSTAINED } from "./ramp.js";
import { alwaysHoldsSentence } from "./autopilot.js";

/**
 * How this product works, start to finish, in one definition.
 *
 * Two screens explain this product: the marketing site's "how it works" and the
 * tutorial inside the app. They were written separately and said different
 * things, the site promised a calendar integration that had been removed, and
 * neither mentioned that acceptance is noticed by an hourly poll rather than
 * instantly. A person who reads a promise on the way in and finds it missing on
 * the way round does not conclude they misread.
 *
 * So there is one list, and both read it. It covers the whole arc, not just
 * setup: `ONBOARDING_STEPS` stops at launch, and everything a newcomer actually
 * worries about, when does it send, what happens when somebody replies, what
 * does it do without asking me, happens after that.
 *
 * Every stage carries a `caveat`, and it is not optional. This product's worst
 * failures have all been a screen that was quiet about a limit: a funnel
 * reporting zero meetings for a campaign that never asked for one, an
 * acceptance a day late reading as a campaign that stalled. A tutorial that
 * lists only what works teaches somebody to read the product wrongly.
 */
/**
 * Who a stage belongs to.
 *
 * `setup` is answered once, at signup, and never again. `decision` is a
 * standing act of judgement the product refuses to perform for you, there are
 * exactly three, and they are the ones enforced in code rather than asked for
 * in a prompt. `agent` runs unattended.
 *
 * This exists because the tour read as a list of chores. Six of nine stages
 * opened with the word "You", which is a fair description of the supervised
 * default and a wrong description of the product: setup is not recurring work,
 * and since autopilot shipped the reply stage runs by itself. Somebody reading
 * it concluded the founder does most of the work, and they were reading it
 * correctly, it was the page that was wrong.
 */
export type StageOwner = "setup" | "decision" | "agent" | "outside";

/**
 * The three the product refuses to do for you, in order.
 *
 * Each is a gate in code rather than a sentence in a prompt: targeting will not
 * search an unapproved strategy, `loadPitch` returns nothing at all for words
 * nobody has approved, and every send path (`Send one now` included) refuses
 * a campaign nobody has launched. Everything else in this product either runs
 * unattended or can be set to.
 */
export const YOUR_DECISIONS = [
  {
    title: "Approve a strategy",
    detail: "Who to go after, and why they would care. Sage writes them and approves none.",
    because: "A strategy aimed at your competitors looks like a perfect customer profile, and no filter can catch it, because every prospect is scored against that same strategy.",
    href: "/app/strategy",
  },
  {
    title: "Approve the words",
    detail: "The opener and the offer, one line at a time. Test the agent on a reply before a real person reads one.",
    because: "This is the copy that goes out under your name. Editing it clears its approval, so one yes in September cannot authorize every rewrite after it.",
    href: "/app/agents",
  },
  {
    title: "Launch",
    detail: "The list and the messages are in front of you. Press the button.",
    because: "Nothing is sent before you press it, and no setting, shortcut or test send skips this step.",
    href: "/app/campaigns",
  },
] as const;

export interface TourStage {
  id: string;
  title: string;
  owner: StageOwner;
  /** What the person does here. Null when the product does it unattended. */
  youDo: string | null;
  /** What the product does here. Always something: no stage is decoration. */
  weDo: string;
  /**
   * The limit, the cost, or the thing it deliberately will not do. Never null:
   * a stage with nothing honest to say about its edges has not been examined.
   */
  caveat: string;
  /** The setup step this stage completes, for stages that are setup. */
  step: keyof OnboardingState | null;
  /** Where in the app this happens. Null for stages with no screen. */
  href: string | null;
}

const step = (key: keyof OnboardingState) => {
  const found = ONBOARDING_STEPS.find((s) => s.key === key);
  // Named from the list rather than duplicated: a tour stage pointing at a step
  // that has been removed is how the calendar promise outlived the calendar.
  if (!found) throw new Error(`tour references unknown onboarding step: ${key}`);
  return found;
};

export const TOUR_STAGES: readonly TourStage[] = [
  {
    id: "business",
    title: "You tell it what you sell, once",
    owner: "setup",
    youDo: "Give it your website and a sentence about what you do, at signup.",
    weDo: "Sage, the strategist, reads the site and writes three to five customer strategies: who to go after, why they would care, what to say.",
    caveat:
      "It reads what is publicly on your site. If your pricing lives behind a login, it does not know it, and neither will any message it writes.",
    step: "hasBusinessProfile",
    href: step("hasBusinessProfile").href,
  },
  {
    id: "approve",
    title: "You approve a strategy",
    owner: "decision",
    youDo: "Read a customer profile and say yes, or edit it first.",
    weDo: "Nothing is searched for until you do.",
    caveat:
      "Most businesses end up running several. Approving one does not commit you to the rest, and a fit score against one strategy says nothing about another.",
    step: "hasApprovedProfile",
    href: step("hasApprovedProfile").href,
  },
  {
    id: "connect",
    title: "You connect LinkedIn, once",
    owner: "setup",
    youDo: "Sign in on LinkedIn's own hosted page, at signup.",
    weDo: "We hold a session token, never your password, and every action after this goes out as you.",
    caveat:
      "Sales Navigator is a separate subscription. Without it, searches cannot filter by seniority, company size or excluded titles. The campaign says so before you launch rather than quietly returning a looser list.",
    step: "hasLinkedInAccount",
    href: step("hasLinkedInAccount").href,
  },
  {
    id: "build",
    title: "It builds the campaign",
    owner: "agent",
    youDo: null,
    weDo: "Scout searches LinkedIn, scores everyone against the strategy and checks that each profile opens. Quinn writes a connection note for each person from their own headline and role.",
    caveat:
      "Anyone whose profile cannot be opened is left out and counted, not hidden. They are usually real people outside your network, but every invitation spends a capped daily allowance, and nobody can review a profile they cannot open.",
    step: "hasCampaign",
    href: step("hasCampaign").href,
  },
  {
    id: "words",
    title: "You approve the words",
    owner: "decision",
    youDo: "Read the opener and the offer, and approve them a line at a time. Try the agent on a reply while you are there.",
    weDo: "Several of each are written so they can be compared, and none is sent until somebody has said yes.",
    caveat:
      "An unapproved line is never sent. A follow-up built around an offer nobody approved waits for you rather than going out half-written.",
    step: null,
    href: "/app/agents",
  },
  {
    id: "review",
    title: "You launch it",
    owner: "decision",
    youDo: "Press Launch. Read the names and the messages first if you want to. Everything is there, and you can cut anyone.",
    weDo: "Launching starts the sending, and the team takes it from there.",
    caveat:
      "Every way of sending goes through this button, including sending a single invitation by hand to test. Reading first is yours to skip; launching is not.",
    step: "hasLaunchedCampaign",
    href: step("hasLaunchedCampaign").href,
  },
  {
    id: "send",
    title: "It sends, slowly and inside your hours",
    owner: "agent",
    youDo: null,
    weDo: `A day's invitations are spread across your working hours, never closer than ${Math.round(LINKEDIN_LIMITS.minGapMs / 60_000)} minutes apart, starting at ${LINKEDIN_LIMITS.invitesPerDayStart} a day and growing to ${SUSTAINED_INVITES_PER_DAY} a day over ${WEEKS_TO_SUSTAINED} weeks, never more than ${LINKEDIN_LIMITS.invitesPerWeek} a week.`,
    caveat:
      "A quiet afternoon is usually the system working. The campaign page says which (waiting out the gap, outside your hours, allowance spent, or nothing running at all), because those look identical otherwise.",
    step: null,
    href: "/app/campaigns",
  },
  {
    id: "accept",
    title: "It notices who accepted",
    owner: "agent",
    youDo: null,
    weDo: `Connections are checked every hour. Once an acceptance is noticed, the first message goes out ${Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / 60_000)} to ${Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / 60_000)} minutes later, inside your working hours.`,
    caveat:
      "LinkedIn offers no way to be told the moment somebody accepts, so the first message usually lands within a couple of hours of the acceptance, not the minute it happens. That is a limit of the platform, not a setting.",
    step: null,
    href: "/app/campaigns",
  },
  {
    id: "reply",
    title: "It drafts the replies, and books",
    owner: "agent",
    youDo: null,
    weDo: "Reese drafts each reply from the documents you gave it and offers only times you have open. By default every draft waits for your approval in the Inbox; switch on autopilot and clean replies send and book on their own.",
    caveat:
      `It may never invent a price, a date or a link. ${alwaysHoldsSentence()}`,
    step: "hasKnowledge",
    href: "/app/inbox",
  },
  {
    id: "close",
    title: "You close",
    owner: "outside",
    youDo: "Take the call, send the proposal, do the part that is yours.",
    weDo: "Meetings booked through our booking page appear on your Meetings page.",
    caveat:
      "A booking made through your own scheduling link happens there, where we cannot see it, so a campaign relying on your link cannot report meetings automatically, and the screens say so rather than showing a zero.",
    step: null,
    href: "/app/meetings",
  },
];

/** Where the reader actually is: the first stage whose setup step is undone. */
export function currentStage(state: OnboardingState): TourStage | null {
  // Only a step that stops something. The knowledge base is optional, and
  // counted here it pinned every workspace that had finished setup on the
  // reply stage, with a warning and a button to the Inbox.
  const required = new Set(ONBOARDING_STEPS.filter((step) => step.required).map((step) => step.key));
  return TOUR_STAGES.find((stage) => stage.step !== null && required.has(stage.step) && !state[stage.step]) ?? null;
}

/**
 * Whether this stage is behind the reader.
 *
 * A stage the product runs itself has no step of its own, so it is counted done
 * once everything before it is, otherwise the unattended half of the product
 * reads as never having happened, on a workspace that is sending right now.
 */
export function stageStatus(
  stage: TourStage,
  state: OnboardingState,
): "done" | "current" | "ahead" {
  const current = currentStage(state);
  if (!current) return "done";
  const here = TOUR_STAGES.indexOf(stage);
  const at = TOUR_STAGES.indexOf(current);
  if (here < at) return "done";
  return here === at ? "current" : "ahead";
}
