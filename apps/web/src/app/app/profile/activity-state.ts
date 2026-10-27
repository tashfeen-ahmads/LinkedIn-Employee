/**
 * Whether profiles are viewed before an invitation, as the workspace sees it.
 *
 * The worker reads `campaigns.warm_up`, one campaign at a time (migration
 * 0033), and nothing in the worker changes here. What the LinkedIn activity
 * section adds is one switch for the whole workspace: it is stored as
 * `warmUp` beside the autonomy answer in `workspaces.onboarding`, and written
 * onto every campaign that can still send, exactly as `setAutonomy` writes the
 * reply setting onto every campaign. So a person turns it on once and every
 * campaign follows, and the screen says how many do.
 *
 * A workspace that has never pressed the switch reads from its campaigns:
 * on only when every campaign that can send already views first, because a
 * switch reading "on" while half the campaigns invite cold is the screen
 * telling somebody something the worker is not doing.
 */
export const WARM_UP_CAMPAIGN_STATUSES = ["draft", "running", "paused"] as const;

export interface WarmUpState {
  on: boolean;
  /** Campaigns that can still send and view profiles first. */
  following: number;
  /** Campaigns that can still send. */
  total: number;
  /** The workspace has an answer of its own, rather than one read off its campaigns. */
  stated: boolean;
}

export function readWarmUp(
  onboarding: unknown,
  campaigns: ReadonlyArray<{ status: string; warm_up: boolean | null }> | null | undefined,
): WarmUpState {
  const live = (campaigns ?? []).filter((c) => (WARM_UP_CAMPAIGN_STATUSES as readonly string[]).includes(c.status));
  const following = live.filter((c) => c.warm_up === true).length;
  const raw = onboarding && typeof onboarding === "object" ? (onboarding as { warmUp?: unknown }).warmUp : undefined;
  if (typeof raw === "boolean") return { on: raw, following, total: live.length, stated: true };
  return { on: live.length > 0 && following === live.length, following, total: live.length, stated: false };
}
