import { LINKEDIN_LIMITS, PACING_STALE_MS } from "@le/shared";
import { checkAction, dailyInviteCap, toUsage, type AccountRecord } from "@le/linkedin";

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
}

export function describePacing(input: {
  status: string;
  queued: number;
  account: AccountRecord | null;
  timezone: string;
  /** When the pacing loop last ran, from `worker_heartbeats`. */
  lastBeatAt: string | null;
  now?: Date;
}): PacingState | null {
  const now = input.now ?? new Date();
  if (input.status !== "running") return null;

  // First, and above everything else the limiter might say: a rule that
  // declines is only meaningful if something is there to obey it.
  const beat = input.lastBeatAt ? new Date(input.lastBeatAt).getTime() : null;
  if (beat === null || now.getTime() - beat > PACING_STALE_MS) {
    return {
      tone: "danger",
      title: "The sending loop is not running.",
      body: beat
        ? `It last ran ${minutesAgo(now.getTime() - beat)}, and it should run every five minutes. Nothing will go out until it is back — this is a problem with the deployment, not with your campaign.`
        : "It has never reported in, so nothing this campaign has queued will be sent. This is a problem with the deployment, not with your campaign.",
    };
  }

  if (!input.account || input.account.status !== "active") {
    return {
      tone: "danger",
      title: "Sending is stopped: the LinkedIn account is not connected.",
      body: "Reconnect it on the Team page. Nothing is sent from an account that is paused, restricted, or needs reauthorising.",
    };
  }

  if (input.queued === 0) {
    return {
      tone: "muted",
      title: "Everyone on this list has been invited.",
      body: "Use Find more to add people, or wait for the invitations already out to be accepted.",
    };
  }

  const usage = toUsage(input.account, input.timezone);
  const decision = checkAction("invite", usage, now);

  if (!decision.allowed) {
    switch (decision.reason) {
      case "outside_working_hours":
        return {
          tone: "muted",
          title: "Waiting for your sending hours.",
          body: `Invitations only go out between ${hour(usage.workingHours.start)} and ${hour(usage.workingHours.end)} on working days, in ${usage.timezone}. Sending resumes ${inWords(decision.retryAfterMs)}. Change the hours on the Team page.`,
        };
      case "daily_invite_cap":
      case "weekly_invite_cap":
        return {
          tone: "muted",
          title: "Today's invitation allowance is used up.",
          body:
            decision.reason === "weekly_invite_cap"
              ? `This account has sent ${usage.invitesThisWeek} invitations this week, and the ceiling is ${LINKEDIN_LIMITS.invitesPerWeek}. Sending resumes when the week rolls over.`
              : `${usage.invitesToday} of ${dailyInviteCap(usage.firstActionAt, now)} sent. Sending resumes tomorrow — the daily cap is what keeps the account out of trouble, and it is not raisable.`,
        };
      case "too_soon":
        return {
          tone: "accent",
          title: `Sending. ${input.queued} ${input.queued === 1 ? "person" : "people"} still to invite.`,
          body: `The next invitation goes out ${inWords(decision.retryAfterMs)}.`,
        };
      default:
        return {
          tone: "muted",
          title: "Sending is paused.",
          body: "The rate limiter is holding this account. It resumes on its own.",
        };
    }
  }

  const left = Math.max(0, dailyInviteCap(usage.firstActionAt, now) - usage.invitesToday);
  return {
    tone: "accent",
    title: `Sending. ${input.queued} ${input.queued === 1 ? "person" : "people"} still to invite.`,
    // The number people actually need, because the absence of it is what makes
    // a working campaign look like a broken one: they open LinkedIn expecting
    // five invitations and find none, a minute after pressing Launch.
    body: `Invitations go out ${Math.round(LINKEDIN_LIMITS.minGapMs / 60_000)}–${Math.round(LINKEDIN_LIMITS.maxGapMs / 60_000)} minutes apart, never two together, up to ${left} more today. The first can take up to a quarter of an hour to appear.`,
  };
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

function hour(value: number): string {
  return `${String(value).padStart(2, "0")}:00`;
}
