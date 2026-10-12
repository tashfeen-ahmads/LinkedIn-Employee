"use client";

import { useMemo, useState } from "react";
import { planToday, type CapTable } from "@/lib/limit-plan";

/**
 * The limit calculator. The ramp itself is not computed here: `caps` is
 * `dailyInviteCap` evaluated on the server for every day of the warm-up, so
 * the number shown is the number the sender enforces. Nothing typed here
 * leaves the browser.
 */
export function LimitCalculator({
  caps,
  neverSentCap,
  weeklyCeiling,
}: {
  caps: CapTable;
  neverSentCap: number;
  weeklyCeiling: number;
}) {
  const [neverSent, setNeverSent] = useState(false);
  const [days, setDays] = useState("7");
  const [sent, setSent] = useState("20");

  const plan = useMemo(
    () =>
      planToday({
        caps,
        neverSentCap,
        weeklyCeiling,
        days: neverSent ? null : Number(days || 0),
        sentThisWeek: Number(sent || 0),
      }),
    [caps, neverSentCap, weeklyCeiling, neverSent, days, sent],
  );

  return (
    <form className="card raised stack-4 tool-panel" onSubmit={(event) => event.preventDefault()}>
      <div className="tool-inputs">
        <label className="field" htmlFor="tool-days">
          <span>Days since your account&rsquo;s first automated send</span>
          <span className="hint" id="tool-days-hint">
            0 if the first one went out today.
          </span>
          <input
            id="tool-days"
            type="number"
            inputMode="numeric"
            min={0}
            max={3650}
            value={neverSent ? "" : days}
            disabled={neverSent}
            aria-describedby="tool-days-hint"
            onChange={(event) => setDays(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="tool-sent">
          <span>Invitations already sent this week</span>
          <span className="hint" id="tool-sent-hint">
            From any tool or by hand. Unsure? Count the last seven days.
          </span>
          <input
            id="tool-sent"
            type="number"
            inputMode="numeric"
            min={0}
            max={1000}
            value={sent}
            aria-describedby="tool-sent-hint"
            onChange={(event) => setSent(event.target.value)}
          />
        </label>
      </div>
      <label className="cluster small" htmlFor="tool-never">
        <input
          id="tool-never"
          type="checkbox"
          checked={neverSent}
          onChange={(event) => setNeverSent(event.target.checked)}
        />
        This account has never sent an automated invitation
      </label>

      <noscript>
        <p className="small muted">
          The calculator needs JavaScript. The full ramp is in the table further down this page.
        </p>
      </noscript>

      <div className="stack-3" aria-live="polite">
        <dl className="tool-figures">
          <div>
            <dt>Send today</dt>
            <dd>{plan.today}</dd>
          </div>
          <div>
            <dt>Today&rsquo;s daily cap</dt>
            <dd>{plan.dailyCap}</dd>
          </div>
          <div>
            <dt>Left this week</dt>
            <dd>
              {plan.weeklyLeft}
              <span className="muted"> of {weeklyCeiling}</span>
            </dd>
          </div>
        </dl>
        <p className="small muted">
          {plan.rampDay === null
            ? "Warm-up finished: this account is at the full daily allowance."
            : `Day ${plan.rampDay} of a ${plan.rampLength}-day warm-up.`}
        </p>
        <p className="small">
          <strong>Plan:</strong> {plan.line}
        </p>
      </div>
    </form>
  );
}
