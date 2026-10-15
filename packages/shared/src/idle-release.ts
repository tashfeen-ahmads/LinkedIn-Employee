/**
 * An idle LinkedIn account is handed back, and the rep is told how to return.
 *
 * Every connected account is paid for every month whether it sends or not, so
 * an account that has done nothing for a fortnight is released: disconnected
 * at the provider and marked here (rule 63). Reconnecting is the ordinary
 * Connect button, and every screen that would otherwise say "disconnected"
 * says why and what to press instead, because a rep who comes back to a dead
 * account with no explanation reads it as the product breaking.
 */
export const IDLE_RELEASE_DAYS = 14;

/**
 * `status_detail` on a released row. The marker the screens read, so it is
 * one definition: two spellings of it and the banner falls back to the
 * generic sentence.
 */
export const IDLE_RELEASE_DETAIL = `Disconnected after ${IDLE_RELEASE_DAYS} days with no running campaign and no activity. Reconnect it to start campaigns again.`;

/** What the rep reads, in their words, wherever the account is shown. */
export const IDLE_RELEASE_TAGLINE = `Your LinkedIn account was disconnected after ${IDLE_RELEASE_DAYS} days without a running campaign. Please reconnect it on your Profile (Settings) to start your campaigns.`;

export function isIdleReleased(account: { status?: string | null; status_detail?: string | null } | null | undefined): boolean {
  return account?.status === "disconnected" && account.status_detail === IDLE_RELEASE_DETAIL;
}

export interface IdleActivity {
  /** Campaigns on this account with status `running`. */
  runningCampaigns: number;
  connectedAt: string | null;
  lastActionAt: string | null;
  /** The newest create, update or launch of any campaign on this account. */
  lastCampaignTouch: string | null;
  /** The newest message in any conversation on this account. */
  lastMessageAt: string | null;
  /** The rep's newest sign-in or session refresh. Undefined when it could not be read. */
  lastSeenAt: string | null | undefined;
}

/**
 * Whether an account has been idle long enough to release.
 *
 * Pure, and every signal must be old: a running campaign, a send, a reply, a
 * campaign being built, a connection made or the rep signing in within the
 * window each keep it. A signal that could not be read keeps it too — an
 * account released because a lookup failed is a rep's live conversations cut
 * off for nothing (rule 17).
 */
export function isIdleForRelease(activity: IdleActivity, now: Date): boolean {
  if (activity.runningCampaigns > 0) return false;
  if (activity.lastSeenAt === undefined) return false;
  const cutoff = now.getTime() - IDLE_RELEASE_DAYS * 86_400_000;
  const signals = [
    activity.connectedAt,
    activity.lastActionAt,
    activity.lastCampaignTouch,
    activity.lastMessageAt,
    activity.lastSeenAt,
  ];
  return signals.every((at) => {
    if (!at) return true;
    const t = Date.parse(at);
    return Number.isFinite(t) && t < cutoff;
  });
}
