"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { WINDOW_DAYS, planToday, type CapTable } from "@/lib/limit-plan";

/**
 * The limit calculator. The ramp itself is not computed here: `caps` is
 * `dailyInviteCap` evaluated on the server for every day of the warm-up, so
 * the number shown is the number the sender enforces. Nothing typed here
 * leaves the browser.
 *
 * The week is the last seven days, as the sender counts it: one box per day,
 * because what comes back tomorrow is exactly what the oldest day held, and a
 * single "this week" total cannot say when that is.
 */

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Oldest first; the last box is today. Twenty in the week, the old default total. */
const DEFAULT_SENT = ["0", "5", "5", "5", "5", "0", "0"];

/** Labels before the weekday is known (the server render) and after. */
function dayLabels(weekday: number | undefined): { short: string; long: string }[] {
  return Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const ago = WINDOW_DAYS - 1 - i;
    if (ago === 0) return { short: "Today", long: "Today" };
    if (weekday === undefined) return { short: `${ago}d ago`, long: `${ago} ${ago === 1 ? "day" : "days"} ago` };
    const day = (((weekday - ago) % 7) + 7) % 7;
    return { short: SHORT[day] ?? "", long: `${LONG[day] ?? ""}, ${ago} ${ago === 1 ? "day" : "days"} ago` };
  });
}
export function LimitCalculator({
  caps,
  neverSentCap,
  weeklyCeiling,
  workingDays,
}: {
  caps: CapTable;
  neverSentCap: number;
  weeklyCeiling: number;
  /** The working weekdays the sender uses by default, `Date.getDay()` numbering. */
  workingDays: readonly number[];
}) {
  const [neverSent, setNeverSent] = useState(false);
  const [days, setDays] = useState("7");
  const [sent, setSent] = useState<string[]>(DEFAULT_SENT);
  // The reader's weekday exists only in the browser; reading it during render
  // would make the server's line and the browser's disagree on hydration.
  const [weekday, setWeekday] = useState<number | undefined>(undefined);
  useEffect(() => {
    setWeekday(new Date().getDay());
  }, []);
  const labels = dayLabels(weekday);

  const plan = useMemo(
    () =>
      planToday({
        caps,
        neverSentCap,
        weeklyCeiling,
        days: neverSent ? null : Number(days || 0),
        sentByDay: sent.map((v) => Number(v || 0)),
        weekday,
        workingDays,
      }),
    [caps, neverSentCap, weeklyCeiling, neverSent, days, sent, weekday, workingDays],
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
        <fieldset className="field tool-days7" aria-describedby="tool-sent-hint">
          <legend>Invitations sent on each of the last seven days</legend>
          <span className="hint" id="tool-sent-hint">
            From any tool or by hand, today so far in the last box. Each day stops counting once it is seven days old.
          </span>
          <div className="tool-days7-grid">
            {labels.map((label, i) => (
              <label key={i} className={`tool-days7-day${i === WINDOW_DAYS - 1 ? " is-today" : ""}`} htmlFor={`tool-sent-${i}`}>
                <span aria-hidden="true">{label.short}</span>
                <input
                  id={`tool-sent-${i}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={1000}
                  value={sent[i] ?? ""}
                  aria-label={`Invitations sent ${label.long === "Today" ? "today" : `on ${label.long}`}`}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSent((prev) => prev.map((v, j) => (j === i ? value : v)));
                  }}
                />
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <label className="tool-check small" htmlFor="tool-never">
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
            <dt>Left in the last 7 days</dt>
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
      <p className="tool-tie small">
        Nora runs this ramp and the rolling seven-day ceiling for every account from its first send, and
        spreads each day&rsquo;s invitations across your working hours.{" "}
        <Link href="/how-it-works">See how it works</Link>
      </p>
    </form>
  );
}
