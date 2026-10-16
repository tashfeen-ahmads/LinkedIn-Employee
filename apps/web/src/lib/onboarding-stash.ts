/**
 * What onboarding left on the workspace, read in one place.
 *
 * `workspaces.onboarding` is a jsonb column with three readers — the worker,
 * when it creates a rep's LinkedIn account row; the profile screen, before
 * that row exists; and the retry for a Strategy Agent run that never finished
 * — and a jsonb column can hold anything. Each reader casting it for itself is
 * how one of them comes to believe a key the others never wrote.
 *
 * Pure, so the shape can be tested without a database.
 */
export interface WorkingHours {
  start: number;
  end: number;
  days: number[];
}

/** What the Strategy Agent was asked to read: the same three fields the form asks for. */
export interface StrategySource {
  websiteUrl?: string;
  linkedinCompanyUrl?: string;
  description?: string;
}

/** What campaigns ask for, chosen on the onboarding CTA step (rule 65). */
export interface StashedCta {
  kind: "meeting" | "link" | "reply";
  label: string | null;
  url: string | null;
}

/**
 * When a person confirmed each onboarding step that has no row of its own to
 * prove it. The hours, the voice and the CTA all have defaults, so a value
 * being present says nothing about whether anybody looked at it; the stamp is
 * the record that they did. Keyed by user, because hours and voice are a
 * rep's own and a teammate joining later has not confirmed anything.
 */
export interface StepConfirmations {
  hours?: string;
  voice?: string;
  cta?: string;
}

export interface OnboardingStash {
  workingHours: WorkingHours | null;
  hasSalesNavigator: boolean | null;
  /** A paid plan (Premium or Sales Navigator): no monthly note limit. */
  hasPremium: boolean | null;
  autonomy: "autonomous" | "supervised" | null;
  /** Empty for a workspace set up before the source was kept. */
  source: StrategySource;
  cta: StashedCta | null;
  confirmed: Record<string, StepConfirmations>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hours(value: unknown): WorkingHours | null {
  if (!value || typeof value !== "object") return null;
  const h = value as Partial<WorkingHours>;
  if (typeof h.start !== "number" || typeof h.end !== "number" || !Array.isArray(h.days)) return null;
  return { start: h.start, end: h.end, days: h.days.filter((d): d is number => typeof d === "number") };
}

export function readOnboardingStash(value: unknown): OnboardingStash {
  const raw = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const source = (raw.source && typeof raw.source === "object" ? raw.source : {}) as Record<string, unknown>;
  return {
    workingHours: hours(raw.workingHours),
    hasSalesNavigator: typeof raw.hasSalesNavigator === "boolean" ? raw.hasSalesNavigator : null,
    hasPremium: typeof raw.hasPremium === "boolean" ? raw.hasPremium : null,
    autonomy: raw.autonomy === "autonomous" || raw.autonomy === "supervised" ? raw.autonomy : null,
    source: compact({
      websiteUrl: text(source.websiteUrl),
      linkedinCompanyUrl: text(source.linkedinCompanyUrl),
      description: text(source.description),
    }),
    cta: stashedCta(raw.cta),
    confirmed: confirmations(raw.confirmed),
  };
}

function stashedCta(value: unknown): StashedCta | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (c.kind !== "meeting" && c.kind !== "link" && c.kind !== "reply") return null;
  return { kind: c.kind, label: text(c.label) ?? null, url: text(c.url) ?? null };
}

function confirmations(value: unknown): Record<string, StepConfirmations> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, StepConfirmations> = {};
  for (const [userId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const stamp: StepConfirmations = {};
    for (const key of ["hours", "voice", "cta"] as const) {
      const at = text(e[key]);
      if (at) stamp[key] = at;
    }
    out[userId] = stamp;
  }
  return out;
}

/** The stash's confirmations with one more step stamped for one person, every other kept. */
export function withConfirmation(
  current: Record<string, StepConfirmations>,
  userId: string,
  step: keyof StepConfirmations,
  at: string,
): Record<string, StepConfirmations> {
  return { ...current, [userId]: { ...(current[userId] ?? {}), [step]: at } };
}

function compact(source: StrategySource): StrategySource {
  const out: StrategySource = {};
  if (source.websiteUrl) out.websiteUrl = source.websiteUrl;
  if (source.linkedinCompanyUrl) out.linkedinCompanyUrl = source.linkedinCompanyUrl;
  if (source.description) out.description = source.description;
  return out;
}

/**
 * Whether there is anything to read. The agent refuses to invent a business
 * from nothing, so an empty source is not a run worth queueing — it is a form
 * somebody has to fill in.
 */
export function hasStrategySource(source: StrategySource): boolean {
  return Boolean(source.websiteUrl || source.linkedinCompanyUrl || source.description);
}

/** The three fields as a form posted them, trimmed; absent ones left out. */
export function sourceFromForm(form: { get(name: string): unknown }): StrategySource {
  return compact({
    websiteUrl: text(form.get("websiteUrl")),
    linkedinCompanyUrl: text(form.get("linkedinCompanyUrl")),
    description: text(form.get("description")),
  });
}

/**
 * What a retry should send the agent: what the person just typed if they typed
 * anything, otherwise what onboarding kept. Never a mix — a website from one
 * answer and a description from another describe two different businesses as
 * soon as either was a correction of the other.
 */
export function chooseStrategySource(typed: StrategySource, stash: StrategySource): StrategySource | null {
  if (hasStrategySource(typed)) return typed;
  if (hasStrategySource(stash)) return stash;
  return null;
}

/**
 * The stash with some keys replaced and every other kept.
 *
 * Merged, never rewritten: one row holds the sending window, the search tier,
 * the autonomy answer and the source, and each screen only ever changes one of
 * them. A wholesale write from any of them drops the rest.
 */
export function mergeStash(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = (current && typeof current === "object" && !Array.isArray(current) ? current : {}) as Record<
    string,
    unknown
  >;
  return { ...base, ...patch };
}

/**
 * A LinkedIn account patch, in the stash's own words.
 *
 * The profile screen writes `has_sales_navigator` and `working_hours` to the
 * account row; before that row exists they belong in the stash, under the
 * names the worker reads when it creates the row. A key absent from the patch
 * stays absent here, so a save that did not touch the hours cannot clear the
 * ones onboarding chose.
 */
export function stashedAccountAnswers(patch: {
  has_sales_navigator?: unknown;
  has_premium?: unknown;
  working_hours?: unknown;
}): Partial<Pick<OnboardingStash, "workingHours" | "hasSalesNavigator" | "hasPremium">> {
  const out: Partial<Pick<OnboardingStash, "workingHours" | "hasSalesNavigator" | "hasPremium">> = {};
  if (typeof patch.has_sales_navigator === "boolean") out.hasSalesNavigator = patch.has_sales_navigator;
  if (typeof patch.has_premium === "boolean") out.hasPremium = patch.has_premium;
  const h = hours(patch.working_hours);
  if (h) out.workingHours = h;
  return out;
}
