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
  /** The worker's boot stamp: when it started, and what it could see. */
  boot?: { beat_at: string; detail: unknown } | null;
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
): { title: string; body: string } {
  const detail = boot?.detail && typeof boot.detail === "object" ? (boot.detail as Record<string, unknown>) : {};
  const startedAgo = boot ? minutesAgo(now.getTime() - new Date(boot.beat_at).getTime()) : null;

  if (boot && detail.queueReachable === false) {
    // The specific afternoon this cost: process up, platform reporting the
    // service healthy, and every queued job unconsumed.
    return {
      title: "The worker is running, but it cannot reach its job queue.",
      body: `It started ${startedAgo} and could not see the queue at ${typeof detail.redisHost === "string" ? detail.redisHost : "its configured address"}. Nothing queued will be sent until that is fixed — this is a problem with the deployment, not with your campaign.`,
    };
  }

  if (boot && beat === null) {
    // Booted, saw the queue, and the loop still never ran. Not a config
    // problem, so it must not be reported as one.
    return {
      title: "The worker started but its sending loop has not run.",
      body: `It started ${startedAgo}${typeof detail.commit === "string" ? ` on build ${detail.commit.slice(0, 7)}` : ""} and reached its queue, but no run has been recorded. Check the worker's logs — this is a problem with the deployment, not with your campaign.`,
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
    body: `It last ran ${minutesAgo(now.getTime() - beat!)} and should run every five minutes. Nothing will go out until it is back — this is a problem with the deployment, not with your campaign.`,
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
