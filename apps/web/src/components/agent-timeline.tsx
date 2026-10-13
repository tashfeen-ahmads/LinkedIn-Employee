"use client";

import { useEffect, useRef, useState } from "react";
import { LINKEDIN_LIMITS } from "@le/shared";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/*
 * One campaign, day by day, and which agent is acting on each of them.
 *
 * Actors are told apart by their label and by the shape of their node, never
 * by hue: the three colors this wanted originally failed a colorblind check
 * badly enough that a reader with deuteranopia could not have separated two of
 * them. So there is one accent, and a human step is marked by a square rather
 * than a different color.
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

const GAP_FLOOR = Math.round(LINKEDIN_LIMITS.minGapMs / 60_000);
const FIRST_MIN = Math.round(LINKEDIN_LIMITS.acceptFollowUpMinMs / 60_000);
const FIRST_MAX = Math.round(LINKEDIN_LIMITS.acceptFollowUpMaxMs / 60_000);

const BEATS: Beat[] = [
  {
    day: 0,
    actor: "You",
    human: true,
    title: "You approve the list and the copy",
    detail:
      "Sage has written your customer strategies, Scout has found and checked the people, and Quinn has written a connection note for each of them and two follow-ups. Nothing has been sent. You read it and launch.",
  },
  {
    day: 0,
    actor: "Reese",
    title: "The first invitations go out",
    detail: `${LINKEDIN_LIMITS.invitesPerDayStart} on the first day, spread across your working hours and never closer than ${GAP_FLOOR} minutes apart. Every gap is randomized, so nothing lands on a fixed schedule.`,
    quote: "Hi Dmitri, saw you run RevOps at Halstead. Curious how you report on lanes today.",
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
    title: "The first message, a couple of hours later",
    detail: `${FIRST_MIN} to ${FIRST_MAX} minutes after the acceptance is noticed, inside working hours, while he still remembers accepting. If he had replied first, this would never have been sent: a reply ends the sequence whatever it says.`,
    quote: "Thanks for connecting. Most teams we talk to are stitching lane costs together in a spreadsheet. Is that you too?",
  },
  {
    day: 6,
    actor: "The prospect",
    title: "He replies, and asks the price",
    detail: "Which is the moment most tools get wrong.",
    quote: "Interesting. What does this actually cost for a team of six?",
  },
  {
    day: 6,
    actor: "Reese",
    title: "Classified, drafted, and held",
    detail:
      "The reply is classified before anything is written. Pricing waits for a person unless you have told it otherwise, so the draft is written and then parked in your inbox rather than sent.",
  },
  {
    day: 6,
    actor: "You",
    human: true,
    title: "You edit one line and send",
    detail:
      "The draft offers times you have open; the agent never invents a slot. You change the price framing and approve. One click.",
    quote: "Happy to go through it properly. It depends on lanes rather than seats. Thursday at 2 p.m. or Friday at 10 a.m.?",
  },
  {
    day: 7,
    actor: "Reese",
    title: "He takes Thursday, and it books itself",
    detail:
      "His answer is matched against the exact times that were offered, then booked onto your Meetings page with who he is and why he matched. If the booking fails, it does not pretend otherwise: it asks you to book it by hand.",
  },
];

/** The beats grouped by day, so each day is labelled once however much happens on it. */
const DAYS = BEATS.reduce<Array<{ day: number; beats: number[] }>>((groups, beat, index) => {
  const last = groups[groups.length - 1];
  if (last && last.day === beat.day) last.beats.push(index);
  else groups.push({ day: beat.day, beats: [index] });
  return groups;
}, []);

const LAST_DAY = BEATS[BEATS.length - 1]!.day;

export function AgentTimeline() {
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  const beat = BEATS[active]!;

  /*
   * The days are uneven (two beats on one, three on another), so the rail is
   * measured from the dots themselves rather than assumed to be evenly
   * spaced. Until that measurement lands the stylesheet's own inset holds, and
   * the fill falls back to the beat's share of the list.
   */
  const trackRef = useRef<HTMLOListElement>(null);
  const [rail, setRail] = useState<{ left: number; width: number; centers: number[] } | null>(null);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const box = track.getBoundingClientRect();
      const centers = Array.from(track.querySelectorAll<HTMLElement>(".timeline-dot")).map((dot) => {
        const r = dot.getBoundingClientRect();
        return r.left + r.width / 2 - box.left;
      });
      if (centers.length < 2) return;
      setRail({ left: centers[0]!, width: centers[centers.length - 1]! - centers[0]!, centers });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);
  const fill = rail
    ? rail.width > 0
      ? ((rail.centers[active] ?? rail.left) - rail.left) / rail.width
      : 0
    : active / (BEATS.length - 1);

  return (
    <div className="timeline card raised">
      <div className="between">
        <p className="timeline-title">One campaign over {LAST_DAY} days</p>
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
        what that role promises (no arrow keys, no roving focus, no panels
        named by the tabs), so a screen reader announced a widget that did not
        behave like one. Plain buttons in an ordered list, with the current one
        marked `aria-current="step"`, are what this actually is.

        Grouped by day, with the day said once per group. One label per dot
        read "d0 d0 d3 d3 d6 d6 d6 d7", which looked like a bug, and eight
        labelled nodes did not fit a phone: two of them sat off the screen.
      */}
      <ol className="timeline-track" aria-label="Campaign steps" ref={trackRef}>
        <li
          className="timeline-rail"
          aria-hidden="true"
          style={rail ? { left: rail.left, width: rail.width, right: "auto" } : undefined}
        >
          <motion.div
            className="timeline-rail-fill"
            initial={false}
            animate={{ scaleX: fill }}
            transition={reduced ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          />
        </li>
        {DAYS.map((group) => (
          <li key={group.day} className="timeline-day-group">
            <ol className="timeline-dots">
              {group.beats.map((index) => {
                const item = BEATS[index]!;
                return (
                  <li key={index}>
                    <button
                      type="button"
                      aria-current={index === active ? "step" : undefined}
                      aria-label={`Day ${item.day}: ${item.title}`}
                      className={`timeline-dot${index === active ? " is-active" : ""}${
                        item.human ? " is-human" : ""
                      }${index < active ? " is-past" : ""}`}
                      onClick={() => setActive(index)}
                    />
                  </li>
                );
              })}
            </ol>
            <span className="timeline-day" aria-hidden="true">
              Day {group.day}
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
              <span className="small subtle">Day {beat.day}</span>
              {beat.human ? <span className="small subtle">Needs you</span> : null}
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
