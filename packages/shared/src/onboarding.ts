/**
 * What a workspace still has to do before it can send anything.
 *
 * One definition, read by two things that must never disagree: the checklist
 * on the dashboard and the nudge email that arrives when someone stalls. A
 * nudge that asks for something the app says is already done is worse than no
 * nudge — it tells the reader the product is not paying attention.
 *
 * The order is the order they have to happen in. You cannot approve a profile
 * the Strategy Agent has not written, and a campaign cannot send from an
 * account nobody connected.
 */

export interface OnboardingState {
  hasBusinessProfile: boolean;
  hasApprovedProfile: boolean;
  hasLinkedInAccount: boolean;
  hasCampaign: boolean;
  hasLaunchedCampaign: boolean;
  hasCalendar: boolean;
  hasKnowledge: boolean;
}

export interface OnboardingStep {
  key: keyof OnboardingState;
  /** What the person does, in their words rather than the schema's. */
  label: string;
  /** Why it matters, shown under the label. One sentence. */
  why: string;
  /**
   * The same step named as a thing that exists rather than a thing to do.
   * "Tell us what you sell" is an instruction; an email listing what someone
   * has already finished needs "your business profile" instead.
   */
  done: string;
  href: string;
  /** The line a nudge email leads with when this is the step they are stuck on. */
  nudge: string;
  /** False for steps that improve the product rather than unblock it. */
  required: boolean;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    key: "hasBusinessProfile",
    label: "Tell us what you sell",
    done: "your business profile",
    why: "The Strategy Agent reads your site and writes your customer profiles from it.",
    href: "/onboarding",
    nudge: "Everything else waits on this one — it takes about a minute and the agent does the writing.",
    required: true,
  },
  {
    key: "hasApprovedProfile",
    label: "Approve a customer profile",
    done: "an approved customer profile",
    why: "Nothing is searched for until you have read one and said yes.",
    href: "/app/strategy",
    nudge:
      "Your profiles are written and waiting. Nothing gets searched for until you have read one — that is deliberate, but it does mean nothing happens until you do.",
    required: true,
  },
  {
    key: "hasLinkedInAccount",
    label: "Connect your LinkedIn account",
    done: "your LinkedIn account",
    why: "You sign in on LinkedIn's own page; we never see your password.",
    href: "/app/team",
    nudge:
      "You sign in on LinkedIn's own hosted page and we never see the password. Until it is connected, campaigns can be built but nothing can leave.",
    required: true,
  },
  {
    key: "hasCampaign",
    label: "Build your first campaign",
    done: "your first campaign",
    why: "The Targeting Agent finds the people and writes the messages.",
    href: "/app/strategy",
    nudge: "One click on an approved profile and the Targeting Agent builds the list and the copy for you.",
    required: true,
  },
  {
    key: "hasLaunchedCampaign",
    label: "Review it, then launch",
    done: "a launched campaign",
    why: "Read every message and every name before anything sends. Ten invitations on day one.",
    href: "/app/campaigns",
    nudge:
      "Your campaign is built and sitting in draft. Read the four messages, cut anyone you would not message yourself, and launch — it starts at ten invitations a day.",
    required: true,
  },
  {
    key: "hasCalendar",
    label: "Connect your calendar",
    done: "your calendar",
    why: "Without it the agent offers to send times rather than proposing any. It never invents a slot.",
    href: "/app/team",
    nudge:
      "The agent will not invent a time — without a calendar it can only offer to send some, which costs you a round trip on every booking.",
    required: false,
  },
  {
    key: "hasKnowledge",
    label: "Add a page of product facts",
    done: "a page of product facts",
    why: "The only things the agent may state. Without it, every product question comes to you.",
    href: "/app/knowledge",
    nudge:
      "Right now every product question a prospect asks lands in your inbox, because the agent may only state facts you have given it. One page on pricing changes that.",
    required: false,
  },
];

/** The steps still outstanding, in the order they have to happen. */
export function remainingSteps(state: OnboardingState): OnboardingStep[] {
  return ONBOARDING_STEPS.filter((step) => !state[step.key]);
}

/**
 * The one step to ask about. Required steps come first and in order, because
 * asking someone to connect a calendar while they have no campaign is noise.
 */
export function nextStep(state: OnboardingState): OnboardingStep | null {
  const outstanding = remainingSteps(state);
  return outstanding.find((step) => step.required) ?? outstanding[0] ?? null;
}

/** Whether this workspace can actually send. Everything required is done. */
export function isReadyToSend(state: OnboardingState): boolean {
  return ONBOARDING_STEPS.filter((step) => step.required).every((step) => state[step.key]);
}

/** How far along, for a progress bar. Optional steps count; they are real work. */
export function onboardingProgress(state: OnboardingState): { done: number; total: number } {
  const done = ONBOARDING_STEPS.filter((step) => state[step.key]).length;
  return { done, total: ONBOARDING_STEPS.length };
}
