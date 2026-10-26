/**
 * What is left of today's invitations, net of what is already on its way.
 *
 * The pacing loop budgets a campaign from three ceilings — the account's
 * ramp, the rolling week and the campaign's own cap — each net of what has
 * been sent today **and** what is already queued and due before the rep's
 * midnight (`inviteRoom` in the pacing loop). The campaign screen used to net
 * only what had been sent, so a second campaign on an account whose day was
 * already queued by the first was told "up to 10 more today" and sent none.
 *
 * Pure, so the loop and the screen can read the same arithmetic (rule 21).
 * The fields mirror the loop's own: `accountCap`, `weeklyLeft`,
 * `campaignLeft`, each of which may be negative, exactly as the loop computes
 * them before it clamps.
 */
export interface InviteRoomInput {
  /** Today's ramp allowance for the account (`dailyInviteCap`). */
  dayAllowance: number;
  /** Invitations the account has sent today, in the rep's day. */
  accountSentToday: number;
  /** Invitations queued on the account, every campaign, due before midnight. */
  accountInFlightToday: number;
  /** The rolling seven-day ceiling. */
  weekCeiling: number;
  /** Invitations the account sent in the last seven days. */
  accountSentThisWeek: number;
  /** Everything queued on the account, whenever it is due. */
  accountInFlight: number;
  /** The campaign's own daily cap. Infinity when it has none. */
  campaignCap: number;
  /** Invitations this campaign sent today. */
  campaignSentToday: number;
  /** This campaign's queued invitations due before midnight. */
  campaignInFlightToday: number;
}

export interface InviteRoom {
  accountCap: number;
  weeklyLeft: number;
  campaignLeft: number;
  /** What the loop may still place for this campaign today, clamped at zero. */
  budget: number;
  /**
   * What this campaign can still send today: its own queued invitations, which
   * go today, plus whatever the loop may still place.
   */
  moreToday: number;
}

export function inviteRoom(input: InviteRoomInput): InviteRoom {
  const n = (value: number) => (Number.isFinite(value) ? value : 0);
  const accountCap = n(input.dayAllowance) - n(input.accountSentToday) - n(input.accountInFlightToday);
  const weeklyLeft = n(input.weekCeiling) - n(input.accountSentThisWeek) - n(input.accountInFlight);
  const campaignLeft =
    input.campaignCap === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : n(input.campaignCap) - n(input.campaignSentToday) - n(input.campaignInFlightToday);
  const budget = Math.max(0, Math.min(accountCap, weeklyLeft, campaignLeft));
  // Its own queued invitations still go today, but never more than its cap
  // and the account's day allow.
  const own = Math.max(0, n(input.campaignInFlightToday));
  return { accountCap, weeklyLeft, campaignLeft, budget, moreToday: budget + own };
}

/**
 * What the pacing loop's last run recorded about invitations already queued,
 * read from its own stamp (`worker_heartbeats` `PACING_LOOP`, `detail`).
 *
 * The queue lives in Redis and only the worker can read it, but the loop says
 * what it placed and what was already waiting, campaign by campaign, on every
 * run (rule 21). That is the only view of the queue a screen has. A structured
 * `inFlight` map on the stamp, keyed by account id, is read first when present;
 * otherwise the loop's own sentences are read. Anything that cannot be read
 * counts as nothing queued, which is what the screen assumed before.
 *
 * `null` when the stamp says nothing about this account at all.
 */
export interface QueuedFromLoop {
  /** Invitations queued on the account across its campaigns. */
  account: number;
  /** This campaign's own. */
  campaign: number;
}

export function queuedFromLoop(
  detail: unknown,
  campaignId: string,
  accountId: string | null,
  /** Every campaign that sends from the same account, this one included. */
  accountCampaignIds: readonly string[],
): QueuedFromLoop | null {
  if (!detail || typeof detail !== "object") return null;
  const raw = detail as { inFlight?: unknown; decisions?: unknown };

  // A structured count, if the loop ever writes one, wins over prose.
  if (accountId && raw.inFlight && typeof raw.inFlight === "object") {
    const entry = (raw.inFlight as Record<string, unknown>)[accountId];
    if (entry && typeof entry === "object") {
      const e = entry as { account?: unknown; campaigns?: unknown };
      const account = typeof e.account === "number" && e.account >= 0 ? e.account : null;
      const campaigns = e.campaigns && typeof e.campaigns === "object" ? (e.campaigns as Record<string, unknown>) : {};
      const own = typeof campaigns[campaignId] === "number" ? (campaigns[campaignId] as number) : 0;
      if (account !== null) return { account, campaign: Math.min(own, account) };
    }
  }

  if (!Array.isArray(raw.decisions)) return null;
  const onAccount = new Set(accountCampaignIds);
  onAccount.add(campaignId);
  let found = false;
  let total = 0;
  let own = 0;
  let stated: number | null = null;
  for (const item of raw.decisions) {
    if (!item || typeof item !== "object") continue;
    const { campaign, reason } = item as { campaign?: unknown; reason?: unknown };
    if (typeof campaign !== "string" || typeof reason !== "string" || !onAccount.has(campaign)) continue;
    found = true;
    const read = readDecision(reason);
    total += read.inFlight;
    if (campaign === campaignId) own += read.inFlight;
    if (read.accountQueued !== null) stated = Math.max(stated ?? 0, read.accountQueued);
  }
  if (!found) return null;
  return { account: Math.max(total, stated ?? 0), campaign: own };
}

/**
 * One of the loop's sentences about invitations, as numbers.
 *
 * "queued 3 invitation(s), re-queued 1 stranded, 2 already waiting" is three
 * plus one plus two on their way; "no allowance left today (…; 7 already
 * queued on the account)" states the account's whole count. A sentence about
 * warm-ups or holds carries no invitation counts and reads as none.
 */
export function readDecision(reason: string): { inFlight: number; accountQueued: number | null } {
  const num = (pattern: RegExp) => {
    const match = pattern.exec(reason);
    return match ? Number(match[1]) : 0;
  };
  const inFlight =
    num(/(?:^|[\s,])queued (\d+) invitation/) + num(/re-queued (\d+) stranded/) + num(/(\d+) already waiting/);
  const stated = /(\d+) already queued on the account/.exec(reason);
  return { inFlight, accountQueued: stated ? Number(stated[1]) : null };
}
