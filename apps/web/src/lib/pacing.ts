import { LINKEDIN_LIMITS, PACING_STALE_MS, inviteRoom, zonedParts } from "@le/shared";
import {
  checkAction,
  dailyInviteCap,
  invitePaceMs,
  toUsage,
  workingDayMs,
  workingMsLeftToday,
  type AccountRecord,
} from "@le/linkedin";
import { countersForToday } from "./account-day";

/**
 * What the sending loop is doing, said on the screen that started it.
 *
 * A campaign launched into a worker that is not running and a campaign waiting
 * out the gap between two invitations look identical: status "running", nobody
 * invited, a page that has not changed. The loop wakes every five minutes and
 * spaces invitations two to eleven minutes apart on purpose — two sends back to
 * back from one account is how accounts get restricted — so a quarter of an
 * hour of nothing is the correct behaviour, and indistinguishable from the
 * product being broken. The first live launch was spent on that question.
 *
 * Every answer below comes from the same limiter the loop consults, on the same
 * row. A second reading of the rule, written for the screen, would drift from
 * the one that actually decides, and the screen's is the one somebody believes.
 */
export interface PacingState {
  tone: "accent" | "danger" | "muted";
  title: string;
  body: string;
  /**
   * The same fault for whoever runs the deployment: the queue's address, the
   * build, where to look. Rendered for platform admins only (rule 54). The
   * person reading the campaign page is normally the business owner, and a
   * host name and a commit hash are our plumbing on their screen and a repair
   * they have no access to perform.
   */
  operator?: string;
}

export function describePacing(input: {
  status: string;
  queued: number;
  account: AccountRecord | null;
  timezone: string;
  /** When the pacing loop last ran, from `worker_heartbeats`. */
  lastBeatAt: string | null;
  /** The worker's boot stamp: when it started, and what it could see. */
  boot?: { beat_at: string; detail: unknown } | null;
  /**
   * This campaign's own daily cap, so the pace quoted here is the pace the
   * loop will actually keep. The loop's budget is the lowest of the account
   * ramp, the week and this; quoting only the ramp would state a faster pace
   * than the campaign is allowed and turn a correct wait into a broken screen.
   */
  dailyCap?: number;
  /**
   * Invitations this campaign has already sent today, in the rep's own day.
   * The loop takes them off the campaign's cap before it divides the day, so
   * the screen has to as well or it quotes a faster pace than the loop keeps.
   */
  sentToday?: number;
  /**
   * Invitations already queued and not yet sent, as the pacing loop's last run
   * recorded them (`queuedFromLoop`): on the whole account, every campaign on
   * it, and this campaign's own. The loop nets them off today's allowance
   * before it places anything (`inviteRoom`), so the screen has to as well — a
   * second campaign on an account whose day the first had already queued was
   * promised "up to 10 more today" and sent none.
   */
  queuedOnAccount?: number;
  queuedOnCampaign?: number;
  /**
   * The operator's kill switch, as the pacing loop's own stamp reports it
   * (`detail.paused`). While it holds, the loop keeps beating and enqueues
   * nothing, so a fresh beat is not evidence of sending (rule 59).
   */
  outreachPaused?: boolean;
  now?: Date;
}): PacingState | null {
  const now = input.now ?? new Date();
  if (input.status !== "running") return null;

  // First, and above everything else the limiter might say: a rule that
  // declines is only meaningful if something is there to obey it.
  const beat = input.lastBeatAt ? new Date(input.lastBeatAt).getTime() : null;
  if (beat === null || now.getTime() - beat > PACING_STALE_MS) {
    return { tone: "danger", ...notSending(input.boot ?? null, beat, now) };
  }

  // Said as a pause and nothing more: customers are told sending is paused,
  // never the operator's reason (rule 59).
  if (input.outreachPaused) {
    return {
      tone: "muted",
      title: "Sending is paused for now.",
      body: "Nothing is going out from any campaign at the moment. Everybody queued stays queued, and sending resumes on its own when the pause is lifted.",
    };
  }

  if (!input.account || input.account.status !== "active") {
    return {
      tone: "danger",
      title: "Sending is stopped: the LinkedIn account is not connected.",
      body: "Reconnect it on your Profile page. Nothing is sent from an account that is paused, restricted, or needs reauthorising.",
    };
  }

  if (input.queued === 0) {
    return {
      tone: "muted",
      title: "Everyone on this list has been invited.",
      body: "Use Find more to add people, or wait for the invitations already out to be accepted.",
    };
  }

  /*
   * LinkedIn's own hold, ahead of every rule this product enforces.
   *
   * The limiter below only knows the caps we chose. When LinkedIn itself is
   * refusing invitations the limiter is perfectly happy, so this screen said
   * "Sending. 7 people still to invite. The next invitation goes out in about
   * four minutes" — which was false, four minutes later and for the next two
   * hours. A reassuring sentence about a system that will not send is the
   * thing rule 21 exists to stop, and this is the same disease one layer down:
   * the true reason was in the heartbeat detail on another screen, and the
   * campaign page, which is where somebody actually goes to ask, was the one
   * place it was not said.
   *
   * Read off the same two columns the send path re-checks immediately before
   * the call, so the screen and the send cannot disagree about whether this
   * account is held.
   */
  const heldUntil = input.account.invites_paused_until
    ? Date.parse(input.account.invites_paused_until)
    : NaN;
  if (Number.isFinite(heldUntil) && heldUntil > now.getTime()) {
    return {
      tone: "muted",
      title: "LinkedIn is holding invitations from this account.",
      body: `${input.account.invites_paused_reason ?? "LinkedIn is refusing invitations for now"}. Sending resumes on its own ${inWords(heldUntil - now.getTime())}. Nothing is lost: everybody still queued stays queued, and this is LinkedIn slowing the account down rather than anything wrong with the campaign.`,
    };
  }

  // Rolled over to the rep's today first, as the worker does before it asks.
  // Read as it stood, the row said "allowance used up" every morning until the
  // first send of the day, about an account about to send at full allowance.
  const usage = toUsage(countersForToday(input.account, input.timezone, now), input.timezone);
  const decision = checkAction("invite", usage, now);

  if (!decision.allowed) {
    switch (decision.reason) {
      case "outside_working_hours":
        return {
          tone: "muted",
          title: "Waiting for your sending hours.",
          body: `Invitations only go out between ${hour(usage.workingHours.start)} and ${hour(usage.workingHours.end)} on working days, in ${usage.timezone}. Sending resumes ${inWords(decision.retryAfterMs)}. Change the hours on your Profile page.`,
        };
      case "daily_invite_cap":
      case "weekly_invite_cap":
        return {
          tone: "muted",
          title: "Today's invitation allowance is used up.",
          body:
            decision.reason === "weekly_invite_cap"
              ? `This account has sent ${usage.invitesThisWeek} invitations in the last seven days, and the ceiling is ${LINKEDIN_LIMITS.invitesPerWeek}. LinkedIn counts a rolling seven days, so sending resumes as the oldest of those drop out of it.`
              : `${usage.invitesToday} of ${dailyInviteCap(usage.firstActionAt, now)} sent. Sending resumes tomorrow. The daily cap is what keeps the account out of trouble, and it is not raisable.`,
        };
      case "too_soon":
        return {
          tone: "accent",
          title: `Sending. ${input.queued} ${input.queued === 1 ? "person" : "people"} still to invite.`,
          // The limiter's floor, or the day's pace if that is wider. On its own
          // the floor promised three minutes while the pace put the next one
          // three quarters of an hour out, and the screen's number is the one
          // somebody believes.
          body: `The next invitation goes out ${inWords(Math.max(decision.retryAfterMs, paceMs(input, usage, now) ?? 0))}.`,
        };
      default:
        return {
          tone: "muted",
          title: "Sending is paused.",
          body: "The rate limiter is holding this account. It resumes on its own.",
        };
    }
  }

  // The campaign's own cap is a real cap now, so "up to N more today" is the
  // lower of the two — the account's allowance is shared with every other
  // campaign on it, and this one may not take all of it.
  // And the week's ceiling, which the loop's budget includes (`paceMs` below
  // honours it too): 97 of 100 this week is three more today, whatever the
  // day's ramp says. And net of what is already queued, by this campaign and
  // by every other one on the account, through the loop's own arithmetic.
  const room = roomToday(input, usage, now);
  const left = room.moreToday;
  const pace = paceMs(input, usage, now);
  const opening = `${hour(usage.workingHours.start)} ${nextSendingDay(now, usage.workingHours.days, usage.timezone)}`;

  /*
   * Nothing more today, said as such. The loop leaves for tomorrow whatever
   * does not fit before close (rule 61), so "up to 6 more today" at twenty to
   * six, or on an account whose day another campaign has already queued, is a
   * promise the loop will not keep, and the one somebody believes.
   */
  if (left === 0) {
    const others = Math.max(0, (input.queuedOnAccount ?? 0) - (input.queuedOnCampaign ?? 0));
    return {
      tone: "muted",
      title: `${input.queued} ${input.queued === 1 ? "person" : "people"} still to invite, from ${opening}.`,
      body:
        others > 0 && room.accountCap <= 0
          ? `Today's invitations on this account are already queued (${others} from other campaigns on it), so this campaign's next ones go out from ${opening}, spread across the day. One account shares one daily allowance however many campaigns send from it.`
          : `Today's allowance for this campaign is spoken for, so the next invitations go out from ${opening}, spread across the day.`,
    };
  }
  const windowLeft = workingMsLeftToday(now, usage.workingHours, usage.timezone);
  if (windowLeft < (pace ?? LINKEDIN_LIMITS.minGapMs)) {
    return {
      tone: "muted",
      title: `${input.queued} ${input.queued === 1 ? "person" : "people"} still to invite, from ${opening}.`,
      body: `Less than one invitation's gap is left in today's sending hours, so the rest go out from ${opening} (${usage.timezone}), spread across the day rather than squeezed into the last minutes of this one.`,
    };
  }
  return {
    tone: "accent",
    title: `Sending. ${input.queued} ${input.queued === 1 ? "person" : "people"} still to invite.`,
    /*
     * The number people actually need, because the absence of it is what makes
     * a working campaign look like a broken one: they open LinkedIn expecting
     * five invitations and find none, a minute after pressing Launch.
     *
     * And the day's pace rather than the floor, now that the allowance is
     * spread across the working day instead of sent consecutively. "Two to
     * nine minutes apart" was the honest sentence when the loop fired them one
     * after another; said about a day that now places them three quarters of
     * an hour apart, it is the screen telling somebody to expect a burst and
     * then not delivering one.
     */
    body: pace
      ? `Invitations go out about ${Math.round(pace / 60_000)} minutes apart, spread across the rest of your sending hours so the account never sends in a burst, up to ${left} more today. A campaign just launched sends its first within seconds, unless this account sent one in the last ${Math.round(pace / 60_000)} minutes.`
      : `Invitations go out ${Math.round(LINKEDIN_LIMITS.minGapMs / 60_000)} to ${Math.round(LINKEDIN_LIMITS.maxGapMs / 60_000)} minutes apart, never two together, up to ${left} more today. A campaign just launched sends its first within seconds, unless this account sent one in the last few minutes.`,
  };
}

/**
 * Why nothing is being sent, as specifically as the evidence allows.
 *
 * "The sending loop is not running" is true in three quite different
 * situations, and they need three different people to do three different
 * things. The pacing stamp cannot tell them apart — it is written by a loop
 * that needs the queue in order to run at all, so a dead queue and a dead
 * process erase it identically. The boot stamp can: the worker writes it
 * straight to the database as it starts, before any of that is relied on.
 */
function notSending(
  boot: { beat_at: string; detail: unknown } | null,
  beat: number | null,
  now: Date,
): { title: string; body: string; operator?: string } {
  const detail = boot?.detail && typeof boot.detail === "object" ? (boot.detail as Record<string, unknown>) : {};
  const startedAgo = boot ? minutesAgo(now.getTime() - new Date(boot.beat_at).getTime()) : null;

  if (boot && detail.queueReachable === false) {
    // The specific afternoon this cost: process up, platform reporting the
    // service healthy, and every queued job unconsumed.
    return {
      title: "The worker is running, but it cannot reach its job queue.",
      body: `It started ${startedAgo}. Nothing queued will be sent until that is fixed. This is a problem with the deployment, not with your campaign, and it is ours to fix.`,
      operator: `Queue unreachable from the worker at ${typeof detail.redisHost === "string" ? detail.redisHost : "its configured address"}${typeof detail.commit === "string" ? ` (build ${detail.commit.slice(0, 7)})` : ""}. Check REDIS_URL on the worker.`,
    };
  }

  if (boot && beat === null) {
    // Booted, saw the queue, and the loop still never ran. Not a config
    // problem, so it must not be reported as one.
    return {
      title: "The worker started but its sending loop has not run.",
      body: `It started ${startedAgo}, but no run has been recorded. This is a problem with the deployment, not with your campaign, and it is ours to fix.`,
      operator: `Booted${typeof detail.commit === "string" ? ` on build ${detail.commit.slice(0, 7)}` : ""} and reached the queue, but no PACING_LOOP stamp. Check the worker's logs.`,
    };
  }

  if (!boot) {
    return {
      title: "The worker is not running.",
      body: "It has not reported starting, so nothing this campaign has queued will be sent. Either the process is down or the build carrying this check has not deployed yet. This is a problem with the deployment, not with your campaign.",
    };
  }

  return {
    title: "The sending loop has stopped.",
    body: `It last ran ${minutesAgo(now.getTime() - beat!)} and should run every five minutes. Nothing will go out until it is back. This is a problem with the deployment, not with your campaign.`,
  };
}

/**
 * The pace the loop will keep today, from the same function it paces by.
 *
 * Bounded by whichever of the three budgets is smallest, because that is what
 * the loop divides the day among (`spreadGapMs({ remaining: budget, ... })` in
 * the pacing loop).
 *
 * Not by how many people are queued. It was, on the reasoning that a pace for
 * ten is a lie on a campaign with two left — but the loop divides by the
 * allowance precisely so that the rate is the same whether a tick finds ten
 * people or one (rule 48), and two people are placed a tenth of the day apart.
 * Bounded by the list, this screen promised the second of them within the
 * hour while the loop had placed it that afternoon: the same function, read
 * two ways, which is the drift `invitePaceMs` exists to prevent.
 */
function paceMs(
  input: PaceInput,
  usage: ReturnType<typeof toUsage>,
  now: Date,
): number | null {
  // What the loop divides the day among: its budget, net of what is queued.
  const room = roomToday(input, usage, now);
  const remaining = room.budget > 0 ? room.budget : room.moreToday;
  if (remaining <= 0) return null;
  return invitePaceMs({
    remaining,
    windowMs: workingMsLeftToday(now, usage.workingHours, usage.timezone),
    dayMs: workingDayMs(usage.workingHours),
    dayAllowance: dailyInviteCap(usage.firstActionAt, now),
  });
}

type PaceInput = { dailyCap?: number; sentToday?: number; queuedOnAccount?: number; queuedOnCampaign?: number };

/** Today's room, through the same arithmetic the pacing loop budgets by. */
function roomToday(input: PaceInput, usage: ReturnType<typeof toUsage>, now: Date) {
  const queuedOnAccount = Math.max(0, input.queuedOnAccount ?? 0);
  return inviteRoom({
    dayAllowance: dailyInviteCap(usage.firstActionAt, now),
    accountSentToday: usage.invitesToday,
    accountInFlightToday: queuedOnAccount,
    weekCeiling: LINKEDIN_LIMITS.invitesPerWeek,
    accountSentThisWeek: usage.invitesThisWeek,
    accountInFlight: queuedOnAccount,
    campaignCap: input.dailyCap === undefined ? Number.POSITIVE_INFINITY : input.dailyCap,
    campaignSentToday: input.sentToday ?? 0,
    campaignInFlightToday: Math.min(queuedOnAccount, Math.max(0, input.queuedOnCampaign ?? 0)),
  });
}

/**
 * "tomorrow", or the weekday name, of the next day the account sends on.
 * Read in the rep's zone; a zone this runtime cannot read says "next".
 */
function nextSendingDay(now: Date, days: number[], timezone: string): string {
  let weekday: number;
  try {
    weekday = zonedParts(now, timezone).weekday;
  } catch {
    return "on the next sending day";
  }
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let ahead = 1; ahead <= 7; ahead++) {
    const day = (weekday + ahead) % 7;
    if (days.includes(day)) return ahead === 1 ? "tomorrow" : `on ${names[day]}`;
  }
  return "on the next sending day";
}

function minutesAgo(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return `${minutes} minutes ago`;
  return `${Math.round(minutes / 60)} hours ago`;
}

function inWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 1) return "in under a minute";
  if (minutes < 90) return `in about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `in about ${hours} hours`;
  return `in about ${Math.round(hours / 24)} days`;
}

/** An hour of the day as a US reader writes it: "8 AM", "6 PM", "12 PM". */
function hour(value: number): string {
  const h = ((value % 24) + 24) % 24;
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}
