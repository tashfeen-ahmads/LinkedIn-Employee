/**
 * The campaign builder's steps, and where each one is stored.
 *
 * Four steps, in the order somebody actually decides them: who it is for,
 * what it asks for, who writes and answers for it, then a last read and the
 * launch. A step after the current one cannot be opened, because a builder
 * that lets somebody launch before choosing a list launches nothing.
 *
 * Which step somebody is on is read from rows, never from which button was
 * pressed (rule 65's rule for setup, applied here). Step 1 is done when the
 * draft exists. Steps 2 and 3 have defaults — every campaign has a goal and a
 * reply mode the moment it is created — so a value being present proves
 * nothing, and the record that a person looked is a stamp the step writes into
 * the campaign's own rules (`rules.builder.goal`, `rules.builder.agent`).
 */
export const BUILDER_STEPS = [
  { key: "details", title: "Details & list" },
  { key: "goal", title: "Goal" },
  { key: "agent", title: "Agent & replies" },
  { key: "review", title: "Review & launch" },
] as const;

export type BuilderStep = (typeof BUILDER_STEPS)[number]["key"];

export function isBuilderStep(value: unknown): value is BuilderStep {
  return BUILDER_STEPS.some((step) => step.key === value);
}

/** The address of one step of one draft. */
export function builderHref(campaignId: string, step: BuilderStep): string {
  return `/app/campaigns/new?campaign=${encodeURIComponent(campaignId)}&step=${step}`;
}

/** Which of the builder's own steps a campaign's rules say were saved. */
export function readStamps(rules: unknown): { goal: boolean; agent: boolean } {
  const builder =
    rules && typeof rules === "object" ? (rules as Record<string, unknown>).builder : null;
  const stamps = builder && typeof builder === "object" ? (builder as Record<string, unknown>) : {};
  return { goal: typeof stamps.goal === "string", agent: typeof stamps.agent === "string" };
}

/** The first step not yet stored: where somebody is, whatever address they opened. */
export function currentBuilderStep(hasDraft: boolean, stamps: { goal: boolean; agent: boolean }): BuilderStep {
  if (!hasDraft) return "details";
  if (!stamps.goal) return "goal";
  if (!stamps.agent) return "agent";
  return "review";
}

/** Whether a step may be opened yet: itself or any step before the current one. */
export function stepOpen(step: BuilderStep, current: BuilderStep): boolean {
  const index = (key: BuilderStep) => BUILDER_STEPS.findIndex((s) => s.key === key);
  return index(step) <= index(current);
}

/** An error or a notice on an address that may already carry a query. */
export function say(path: string, message: string, kind: "error" | "notice"): string {
  return `${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(message)}`;
}
