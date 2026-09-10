"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { LINKEDIN_LIMITS, RATE_TARGETS } from "@le/shared";

/*
 * What a month looks like at a given volume.
 *
 * The interesting thing about this widget is what it will not let you do. The
 * daily slider stops at the cap the sender enforces, and the weekly ceiling
 * clamps the total underneath it — so someone dragging for a bigger number
 * runs into the product's actual safety limit rather than reading about it.
 * A constraint you can feel is worth more than a paragraph explaining one.
 */

const WORKING_DAYS_PER_WEEK = 5;
const WEEKS = 4;

function forecast(seats: number, perDay: number, acceptance: number, reply: number) {
  const weeklyPerSeat = Math.min(perDay * WORKING_DAYS_PER_WEEK, LINKEDIN_LIMITS.invitesPerWeek);
  const invited = weeklyPerSeat * WEEKS * seats;
  const accepted = Math.round(invited * acceptance);
  const replied = Math.round(accepted * reply);
  // Of those who reply, the share that turns into a booked meeting. Held
  // deliberately low: this is a forecast to argue with, not a promise.
  const meetings = Math.round(replied * 0.35);
  return { invited, accepted, replied, meetings, weeklyPerSeat, cappedByWeek: perDay * WORKING_DAYS_PER_WEEK > LINKEDIN_LIMITS.invitesPerWeek };
}

const STAGES = ["invited", "accepted", "replied", "meetings"] as const;
const LABELS: Record<(typeof STAGES)[number], string> = {
  invited: "Invitations",
  accepted: "Connections",
  replied: "Replies",
  meetings: "Meetings",
};

export function Forecast() {
  const [seats, setSeats] = useState(3);
  const [perDay, setPerDay] = useState(20);
  const [acceptance, setAcceptance] = useState(Math.round(RATE_TARGETS.acceptance * 100));
  const [reply, setReply] = useState(Math.round(RATE_TARGETS.reply * 100));
  const reduced = useReducedMotion();

  const result = useMemo(
    () => forecast(seats, perDay, acceptance / 100, reply / 100),
    [seats, perDay, acceptance, reply],
  );

  const peak = Math.max(result.invited, 1);

  return (
    <div className="forecast card raised">
      <div className="forecast-controls stack-4">
        <Slider
          id="seats"
          label="Reps sending"
          value={seats}
          min={1}
          max={10}
          onChange={setSeats}
          display={`${seats}`}
        />
        <Slider
          id="perday"
          label="Invitations per rep, per day"
          value={perDay}
          min={5}
          max={LINKEDIN_LIMITS.invitesPerDayMax}
          onChange={setPerDay}
          display={`${perDay}`}
          note={`The slider stops at ${LINKEDIN_LIMITS.invitesPerDayMax} because the product does.`}
        />
        <Slider
          id="acceptance"
          label="Acceptance rate"
          value={acceptance}
          min={10}
          max={60}
          onChange={setAcceptance}
          display={`${acceptance}%`}
          note={acceptance < 15 ? "Below 15% LinkedIn reads an account as a spammer." : undefined}
          warn={acceptance < 15}
        />
        <Slider
          id="reply"
          label="Reply rate, of those who connect"
          value={reply}
          min={5}
          max={40}
          onChange={setReply}
          display={`${reply}%`}
        />
      </div>

      <div className="forecast-output stack-4">
        <div className="stack-1">
          <span className="eyebrow">In a month</span>
          <p className="small muted">
            {seats} {seats === 1 ? "rep" : "reps"} · {result.weeklyPerSeat} invitations each per week
          </p>
        </div>

        <ul className="forecast-bars">
          {STAGES.map((stage) => {
            const value = result[stage];
            // A floor, so the outcome bar is still a mark at 19 against 1,200.
            const width = value === 0 ? 0 : Math.max(4, (value / peak) * 100);
            return (
              <li key={stage}>
                <div className="between" style={{ gap: "var(--space-2)" }}>
                  <span className="small">{LABELS[stage]}</span>
                  <span className="mono">{value.toLocaleString()}</span>
                </div>
                <div className="forecast-track">
                  <motion.div
                    className={`forecast-fill${stage === "meetings" ? " is-outcome" : ""}`}
                    animate={{ width: `${width}%` }}
                    initial={false}
                    transition={reduced ? { duration: 0 } : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        {result.cappedByWeek ? (
          <p className="tiny warn-text" style={{ marginTop: "var(--space-2)" }}>
            Held at {LINKEDIN_LIMITS.invitesPerWeek} a week per rep — the weekly ceiling caught this
            before the daily one did.
          </p>
        ) : null}

        <p className="tiny subtle">
          A forecast to argue with, not a promise. It assumes about a third of replies become a
          meeting, and no published result of ours sits behind it.
        </p>
      </div>
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  onChange,
  display,
  note,
  warn,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  display: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div className="slider stack-2">
      <div className="between" style={{ gap: "var(--space-2)" }}>
        <label htmlFor={id} className="small">
          {label}
        </label>
        <output htmlFor={id} className="mono slider-value">
          {display}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {note ? <p className={`tiny ${warn ? "warn-text" : "subtle"}`}>{note}</p> : null}
    </div>
  );
}
