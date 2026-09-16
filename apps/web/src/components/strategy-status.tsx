import Link from "next/link";
import { minutesSince, type StrategyState } from "@/lib/strategy-state";

/**
 * What the Strategy Agent is doing, said on the screen someone is watching.
 *
 * Onboarding hands off to an agent that takes minutes, and until this existed
 * the handoff was invisible: the form submitted, the page went quiet, and the
 * only thing that changed was a checklist row still asking for what had just
 * been given. A run that failed looked identical and stayed that way.
 */
export function StrategyStatus({ state }: { state: StrategyState }) {
  if (state.phase === "ready" || state.phase === "absent") return null;

  if (state.phase === "failed") {
    return (
      <div className="notice danger" role="status">
        <p>
          <strong>The Strategy Agent could not finish.</strong> Nothing else can start until it
          does — your customer profiles are what everything downstream is built from.
        </p>
        <p className="small">{state.reason}</p>
        <p className="small">
          <Link href="/onboarding" className="btn small">
            Try again
          </Link>
        </p>
      </div>
    );
  }

  const minutes = minutesSince(state.since);
  return (
    <div className="notice accent" role="status">
      <p>
        <strong>The Strategy Agent is working.</strong> It is reading your site and writing your
        business profile and three to five customer profiles. This usually takes a few minutes.
      </p>
      <p className="small muted">
        {minutes < 1 ? "Started just now." : `Started ${minutes} minute${minutes === 1 ? "" : "s"} ago.`}{" "}
        Refresh this page to check. Nothing is searched for and nothing is sent until you have read
        a profile and approved it.
      </p>
      {minutes >= 15 ? (
        <p className="small">
          That is longer than usual. If it is still going in another few minutes, run it again from{" "}
          <Link href="/onboarding">onboarding</Link>.
        </p>
      ) : null}
    </div>
  );
}
