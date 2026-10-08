"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/*
 * One campaign, day by day, and which agent is acting on each of them.
 *
 * Actors are told apart by their label and by the shape of their node, never
 * by hue: the three colours this wanted originally failed a colourblind check
 * badly enough that a reader with deuteranopia could not have separated two of
 * them. So there is one accent, and a human step is marked by a ring rather
 * than a different colour.
 */

type Actor = "Reese" | "The prospect" | "You";

interface Beat {
  day: number;
  actor: Actor;
  title: string;
  detail: string;
  /** A step that cannot happen without a person. */
  human?: boolean;
  quote?: string;
}

const BEATS: Beat[] = [
  {
    day: 0,
    actor: "You",
    human: true,
    title: "You approve the list and the copy",
    detail:
      "Sage has written your customer strategies, Scout has found and checked the people, and Quinn has written a connection note for each of them and two follow-ups. Nothing has been sent. You read all of it and launch.",
  },
  {
    day: 0,
    actor: "Reese",
    title: "The first invitations go out",
    detail:
      "Ten on day one, spread across your working hours with two to nine minutes between each. Never at the same minute twice, because a scheduler is the easiest thing in the world to spot.",
    quote: "Hi Dmitri — we work with RevOps leads on the lane-level reporting problem. Worth a look?",
  },
  {
    day: 3,
    actor: "The prospect",
    title: "Dmitri accepts",
    detail:
      "Noticed by the hourly connection check, because LinkedIn sends no acceptance event. That check is also what starts the clock on the first message.",
  },
  {
    day: 3,
    actor: "Reese",
    title: "The first message, within the hour",
    detail:
      "Twenty to ninety minutes after the acceptance is noticed, inside working hours, under the daily message cap — while he still remembers accepting. If he had replied first, this would never have been sent — a reply ends the sequence whatever it says.",
    quote: "Thanks for connecting. Most teams we talk to are stitching lane costs together in a spreadsheet — is that you too?",
  },
  {
    day: 6,
    actor: "The prospect",
    title: "He replies, and asks the price",
    detail: "Which is the moment most tools get wrong.",
    quote: "Interesting — what does this actually cost for a team of six?",
  },
  {
    day: 6,
    actor: "Reese",
    title: "Classified, drafted, and held",
    detail:
      "The reply is classified before anything is written. Pricing goes to a person unless you have told it otherwise, so the draft is written and then parked in your inbox rather than sent. The sequence stops here either way.",
  },
  {
    day: 6,
    actor: "You",
    human: true,
    title: "You edit one line and send",
    detail:
      "The draft offers times your calendar says you are genuinely free — the agent never invents a slot. You change the price framing and approve. One click.",
    quote: "Happy to go through it properly — it depends on lanes rather than seats. Thursday 2pm or Friday 10am?",
  },
  {
    day: 7,
    actor: "Reese",
    title: "He takes Thursday. It books itself",
    detail:
      "The acceptance is matched against the exact slots that were offered, then written into your calendar with the whole conversation attached. If the calendar write fails, it does not pretend otherwise: it asks you to book it by hand.",
  },
];

const LAST_DAY = BEATS[BEATS.length - 1]!.day;

export function AgentTimeline() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const beat = BEATS[active]!;

  return (
    <div className="timeline card raised">
      <div className="between">
        <div className="stack-1">
          <span className="eyebrow">One campaign, {LAST_DAY} days</span>
          <p className="small muted">Step through it. Every beat names who acted.</p>
        </div>
        <div className="cluster">
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setActive((i) => Math.max(0, i - 1))}
            disabled={active === 0}
          >
            ← Back
          </button>
          <button
            type="button"
            className="btn secondary small"
            onClick={() => setActive((i) => Math.min(BEATS.length - 1, i + 1))}
            disabled={active === BEATS.length - 1}
          >
            Next →
          </button>
        </div>
      </div>

      {/*
        A list of steps, not a tablist. It had `role="tablist"` with none of
        what that role promises — no arrow keys, no roving focus, no panels
        named by the tabs — so a screen reader announced a widget that did not
        behave like one. Plain buttons in an ordered list, with the current one
        marked `aria-current="step"`, are what this actually is.

        The rail is an `li` hidden from assistive technology rather than a
        `div`: a `div` is not a valid child of an `ol`, and keeping it inside
        the list means it still scrolls with the dots on a narrow screen.
        Absolutely positioned, so it takes no slot in the row.
      */}
      <ol className="timeline-track" aria-label="Campaign steps">
        <li className="timeline-rail" aria-hidden="true">
          <motion.div
            className="timeline-rail-fill"
            initial={false}
            animate={{ width: `${(active / (BEATS.length - 1)) * 100}%` }}
            transition={reduced ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          />
        </li>
        {BEATS.map((item, index) => (
          <li key={`${item.day}-${item.title}`} className="timeline-node">
            <button
              type="button"
              aria-current={index === active ? "step" : undefined}
              aria-label={`Day ${item.day}: ${item.title}`}
              className={`timeline-dot${index === active ? " is-active" : ""}${
                item.human ? " is-human" : ""
              }${index < active ? " is-past" : ""}`}
              onClick={() => setActive(index)}
            />
            <span className="timeline-day mono" aria-hidden="true">
              d{item.day}
            </span>
          </li>
        ))}
      </ol>

      <div className="timeline-panel" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={reduced ? false : { opacity: 0.001, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0.001, y: -8 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="stack-3"
          >
            <div className="cluster">
              <span className={`pill ${beat.human ? "accent" : "plain"}`}>{beat.actor}</span>
              <span className="tiny subtle mono">Day {beat.day}</span>
              {beat.human ? <span className="tiny subtle">· needs a person</span> : null}
            </div>

            <h3>{beat.title}</h3>
            <p className="muted small prose">{beat.detail}</p>

            {beat.quote ? (
              <blockquote className="timeline-quote small">{beat.quote}</blockquote>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
