import Link from "next/link";
import type { Entitlement } from "@le/billing";
import { PLANS, TRIAL_DAYS, chargesOnChoosing } from "@/lib/plans";

/**
 * The plan, said once at the top of every app page whenever it changes what
 * the workspace can do or will soon (rule 67).
 *
 * A trial shows how far through it is, the date it ends and what happens
 * then, so day fifteen is never a surprise. A stop says what stopped, that
 * nothing was deleted, and the one button that starts it again. A free-plan
 * workspace and a healthy paid one see nothing.
 */
export function PlanBanner({
  entitlement,
  trialEndsAt,
  periodEnd,
  ending,
  unpaid = false,
}: {
  entitlement: Entitlement;
  trialEndsAt: string | null;
  /** The paid period's end, for a plan set to cancel. */
  periodEnd: string | null;
  ending: boolean;
  /** An unpaid invoice ended it: paying that is the way back, not a new plan. */
  unpaid?: boolean;
}) {
  const cheapest = Math.min(...PLANS.map((p) => p.monthly));
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null;

  if (entitlement.reason === "trial_active" && entitlement.trialDaysLeft !== null) {
    const left = entitlement.trialDaysLeft;
    const used = Math.min(TRIAL_DAYS, Math.max(0, TRIAL_DAYS - left));
    const soon = left <= 3;
    return (
      <div className={`plan-banner${soon ? " is-soon" : ""}`} role="status">
        <div className="plan-banner-text">
          <p className="plan-banner-title">
            {left === 0 ? "Your free trial ends today" : `${left} day${left === 1 ? "" : "s"} left in your free trial`}
          </p>
          <p className="plan-banner-note">
            You have every Autopilot feature until {date(trialEndsAt) ?? "the trial ends"}. Choose a plan to keep your
            campaigns sending after that.{" "}
            {chargesOnChoosing(trialEndsAt) ? "Billing starts the day you choose." : "No charge until the trial ends."}
          </p>
          <div
            className="plan-banner-meter"
            role="meter"
            aria-label="Trial used"
            aria-valuemin={0}
            aria-valuemax={TRIAL_DAYS}
            aria-valuenow={used}
          >
            <span style={{ width: `${(used / TRIAL_DAYS) * 100}%` }} />
          </div>
        </div>
        <div className="plan-banner-action">
          <Link className="btn small" href="/app/profile/billing">
            Choose a plan
          </Link>
          <span className="tiny subtle">From ${cheapest} a month</span>
        </div>
      </div>
    );
  }

  const stopped: Partial<Record<Entitlement["reason"], { title: string; note: string; action: string }>> = {
    trial_expired: {
      title: "Your free trial has ended",
      note: "Campaigns are paused until you choose a plan. Your prospects, conversations and settings are all kept.",
      action: "Choose a plan",
    },
    subscription_canceled: {
      title: "Your plan has ended",
      note: "Campaigns are paused and your conversations stay readable. Choose a plan to start sending again.",
      action: "Choose a plan",
    },
    payment_failed: {
      title: "Your last payment did not go through",
      note: "Campaigns keep running for now. Update your card so they are not paused.",
      action: "Update payment",
    },
    seat_limit_exceeded: {
      title: "More people than your plan covers",
      note: "Campaigns are paused until the plan's seats match your team. Add seats in billing, or remove someone.",
      action: "Open billing",
    },
    no_plan: {
      title: "We could not confirm your plan",
      note: "Campaigns are paused. Open billing, or tell us from Support and we will sort it out.",
      action: "Open billing",
    },
  };
  if (unpaid && stopped.subscription_canceled) {
    stopped.subscription_canceled = {
      title: "Your plan is paused for an unpaid invoice",
      note: "Campaigns are paused and your conversations stay readable. Pay the open invoice in billing to start sending again.",
      action: "Open billing",
    };
  }
  const stop = stopped[entitlement.reason];
  if (stop) {
    return (
      <div className={`plan-banner ${entitlement.canSend ? "is-soon" : "is-stopped"}`} role="status">
        <div className="plan-banner-text">
          <p className="plan-banner-title">{stop.title}</p>
          <p className="plan-banner-note">{stop.note}</p>
        </div>
        <div className="plan-banner-action">
          <Link className="btn small" href="/app/profile/billing">
            {stop.action}
          </Link>
        </div>
      </div>
    );
  }

  if (entitlement.reason === "active_subscription" && ending && periodEnd) {
    return (
      <div className="plan-banner" role="status">
        <div className="plan-banner-text">
          <p className="plan-banner-title">Your plan ends on {date(periodEnd)}</p>
          <p className="plan-banner-note">Campaigns pause then. You can keep it from billing any time before.</p>
        </div>
        <div className="plan-banner-action">
          <Link className="btn small secondary" href="/app/profile/billing">
            Keep my plan
          </Link>
        </div>
      </div>
    );
  }
  return null;
}
