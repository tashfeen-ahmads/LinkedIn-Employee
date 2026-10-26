/**
 * Onboarding, one step at a time, in an order nobody can skip (rule 65).
 *
 * It used to be one long form followed by a checklist on the dashboard, and the
 * checklist was advice: a new customer could land in the app with no LinkedIn
 * account, a CTA nobody had chosen and hours in the wrong zone, and wander off
 * to the agents page before a single strategy was approved. Every one of those
 * defaults reached a real prospect. Watching somebody set it up was watching
 * them guess which screen came next.
 *
 * So setup is a sequence. Each step is a screen with one job, each is checked
 * against what is actually stored rather than against a click, and the app
 * opens when the first campaign is live — which is what setting it up was for.
 *
 * Pure, so the order and the gate can be tested without a database.
 */

/**
 * Set once a person's workspace is seen to have launched, holding their user
 * id, so the middleware stops asking. It only ever skips the setup redirect,
 * which is the person's own convenience: nothing is authorised by it.
 *
 * It names the person, not the workspace, so it outlived the workspace it was
 * about: an owner whose workspace was deleted to start again kept a year-old
 * "finished" cookie, and the new workspace's setup was skipped straight to the
 * dashboard the moment LinkedIn connected. Creating a workspace clears it now
 * (`/onboarding/submit`), and the name carries a version so every cookie set
 * before that is ignored.
 */
export const SETUP_DONE_COOKIE = "le_setup_done_2";

export type WizardStepKey =
  | "business"
  | "linkedin"
  | "hours"
  | "voice"
  | "cta"
  | "strategy"
  | "prospects"
  | "launch";

export interface WizardStep {
  key: WizardStepKey;
  /** The screen's heading. */
  title: string;
  /** One line for the step list: what this step settles. */
  settles: string;
}

/*
 * The business comes before LinkedIn although connecting feels like the first
 * thing: a LinkedIn account belongs to a workspace, and the workspace is what
 * the business step creates. It also starts Sage, so the strategies are being
 * written while the person connects LinkedIn and sets their hours rather than
 * after, and the strategy step is usually ready by the time they reach it.
 */
export const WIZARD_STEPS: readonly WizardStep[] = [
  { key: "business", title: "Your business", settles: "What you sell, so Sage can write your strategies" },
  { key: "linkedin", title: "Connect LinkedIn", settles: "The account every message is sent from" },
  { key: "hours", title: "Your hours", settles: "When it sends, and when prospects can book a call" },
  { key: "voice", title: "How you sound", settles: "Your name and the voice everything is written in" },
  { key: "cta", title: "What you are asking for", settles: "A call, a link or a conversation" },
  { key: "strategy", title: "Approve a strategy", settles: "Who to go after, and why they would care" },
  { key: "prospects", title: "Build your list", settles: "Real people, each with a note written for them" },
  { key: "launch", title: "Review and launch", settles: "Who answers replies, then your first campaign goes live" },
];

/** What is actually stored, read for one person in one workspace. */
export interface WizardFacts {
  hasWorkspace: boolean;
  /** This person's own LinkedIn account is connected and working. */
  linkedInActive: boolean;
  /** Steps whose answers this person has seen and confirmed on this screen. */
  confirmed: { hours: boolean; voice: boolean; cta: boolean };
  /**
   * When prospects can book this person is saved. Part of the hours step: the
   * slot finder offers nothing but these (rule 6), and a confirmation without
   * them left a customer booked into defaults they never saw.
   */
  hasMeetingHours: boolean;
  hasApprovedStrategy: boolean;
  hasCampaign: boolean;
  hasLaunchedCampaign: boolean;
  /**
   * This person chose to open the app before launching. The steps are still
   * there to finish; the app simply stops being closed to them.
   */
  deferred?: boolean;
}

export function stepDone(key: WizardStepKey, facts: WizardFacts): boolean {
  switch (key) {
    case "business":
      return facts.hasWorkspace;
    case "linkedin":
      return facts.linkedInActive;
    case "hours":
      return facts.confirmed.hours && facts.hasMeetingHours;
    case "voice":
      return facts.confirmed.voice;
    case "cta":
      return facts.confirmed.cta;
    case "strategy":
      return facts.hasApprovedStrategy;
    case "prospects":
      return facts.hasCampaign;
    case "launch":
      return facts.hasLaunchedCampaign;
  }
}

/**
 * The step this person is on: the first one not done, in order, or null when
 * setup is finished.
 *
 * In order, not "any undone step". A workspace whose LinkedIn account dropped
 * after its strategy was approved is back on the LinkedIn step, because nothing
 * after it can work without it — and a list that let somebody approve and
 * launch past a missing account is the checklist this replaced.
 */
export function currentStep(facts: WizardFacts): WizardStepKey | null {
  // A launched campaign is the end of setup however it got there: a workspace
  // that launched before this existed is never sent back through it.
  if (facts.hasLaunchedCampaign) return null;
  return WIZARD_STEPS.find((step) => !stepDone(step.key, facts))?.key ?? null;
}

/**
 * Whether somebody on this step may open the app before launching.
 *
 * From the strategy step on: by then the account is connected and the hours,
 * voice and ask are settled, so what is left is finding people and launching,
 * and those are the steps that fail for reasons nobody on the screen can fix
 * — a search LinkedIn refuses, a list that comes back empty. A first customer
 * on Sales Navigator sat for four days on "building your campaign" with no way
 * into the product they had set up, because the only way out was a launch the
 * search had made impossible.
 */
export function canDefer(step: WizardStepKey | null): boolean {
  return step !== null && stepIndex(step) >= stepIndex("strategy");
}

/** Setup is not finished, but this person has chosen to work in the app meanwhile. */
export function setupDeferred(facts: WizardFacts): boolean {
  return Boolean(facts.deferred) && !facts.hasLaunchedCampaign;
}

export function stepIndex(key: WizardStepKey): number {
  return WIZARD_STEPS.findIndex((step) => step.key === key);
}

/**
 * Which step to show for a requested one.
 *
 * Back is always allowed — changing an earlier answer is a click, not a
 * restart. Forward past the current step is not: the step after a missing one
 * is a screen whose inputs do not exist yet.
 */
export function stepToShow(requested: string | null | undefined, facts: WizardFacts): WizardStepKey | null {
  const current = currentStep(facts);
  if (!current) return null;
  const asked = WIZARD_STEPS.find((step) => step.key === requested)?.key;
  if (!asked) return current;
  return stepIndex(asked) <= stepIndex(current) ? asked : current;
}

/** "Step 3 of 8", for the step on screen. */
export function stepPosition(key: WizardStepKey): { n: number; of: number } {
  return { n: stepIndex(key) + 1, of: WIZARD_STEPS.length };
}

/**
 * Which app screens open before setup is finished.
 *
 * Support, because somebody stuck on a step must be able to say so; and a
 * campaign's own page, because the last step links to it to read every name
 * and every message before launching. Nothing else: the rest of the app is
 * built on the steps not finished yet, and opening it early is how somebody
 * ends up tuning an agent for a campaign that does not exist.
 */
export function openDuringSetup(path: string): boolean {
  const bare = path.split(/[?#]/)[0] ?? "";
  // A campaign's own page, never the screen that makes a new one: "new" fits
  // the same pattern and opened the campaign builder to somebody still setting up.
  return bare === "/app/support" || (/^\/app\/campaigns\/[^/]+$/.test(bare) && bare !== "/app/campaigns/new");
}

/**
 * Whether a request is one the setup redirect applies to: an app page being
 * loaded. A POST is a form or a server action somebody on an onboarding screen
 * submitted (the Sage retry posts under /app), and refusing it would make the
 * button that fixes a stuck step the one thing that cannot run.
 */
export function gatesSetup(method: string, pathname: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname !== "/app" && !pathname.startsWith("/app/")) return false;
  return !openDuringSetup(pathname);
}

/**
 * Where the app sends somebody whose setup is not finished.
 *
 * The provider's sign-in returns to the profile page with `connected` or
 * `error` on it; those are carried across so the LinkedIn step can say what
 * happened, and everything else is dropped.
 */
export function setupRedirect(path: string): string {
  // Only the profile page is where the provider's sign-in comes back to. An
  // error on any other page is that page's own, and carried to the LinkedIn
  // step it read as a failed sign-in to somebody whose account was fine.
  if (!path.startsWith("/app/profile")) return "/onboarding";
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1).split("#")[0] ?? "" : "";
  const params = new URLSearchParams(query);
  const kept = new URLSearchParams();
  for (const key of ["connected", "error"]) {
    const value = params.get(key);
    if (value) kept.set(key, value);
  }
  if (kept.size) kept.set("step", "linkedin");
  const rest = kept.toString();
  return rest ? `/onboarding?${rest}` : "/onboarding";
}

/**
 * Where a Sage retry posted from onboarding lands.
 *
 * The retry answers with the strategy page and a sentence, and the strategy
 * page is behind the setup redirect: the answer was dropped on the way back
 * and the person saw the same stuck step with no word of what happened. So a
 * retry from onboarding comes back to onboarding, as a code the page words.
 */
export function retryBackToOnboarding(path: string): string {
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1).split("#")[0] ?? "" : "";
  const error = new URLSearchParams(query).get("error");
  if (!error) return "/onboarding";
  const code = error.startsWith("Only an owner or admin")
    ? "sage-admin-only"
    : error.startsWith("Tell Sage what you sell")
      ? "sage-needs-source"
      : "sage-not-started";
  return `/onboarding?step=strategy&error=${code}`;
}

/** The notice the list step shows when a press found its own search still running. */
export const ALREADY_RUNNING_NOTICE = "already-running";

/** As long as the list step waits on a search before saying it has not finished (`STALLED_MS`). */
const ALREADY_RUNNING_WINDOW_MS = 10 * 60 * 1000;

/**
 * Whether "that search is already running" is still true enough to say, and
 * to keep the page refreshing for.
 *
 * The notice rides in the address, so refreshing the page keeps it there for
 * as long as the tab is open. Dated by the press that produced it and good for
 * the window a search is given to finish; after that it is gone, and the page
 * stops asking. An undated notice, from a link written before it was dated, is
 * never shown: there is nothing to bound it by, and a wait with no end is the
 * thing being prevented.
 */
export function alreadyRunningNotice(
  notice: string | null | undefined,
  since: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (notice !== ALREADY_RUNNING_NOTICE) return false;
  const at = Number(since);
  if (!Number.isFinite(at) || at <= 0) return false;
  return now - at >= -60_000 && now - at < ALREADY_RUNNING_WINDOW_MS;
}
