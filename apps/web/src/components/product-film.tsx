"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { LINKEDIN_LIMITS } from "@le/shared";

/**
 * The product, moving, directly under the hero.
 *
 * Every competitor in this category puts an auto-playing film here, and they
 * are right to: a person learns what a product *is* by watching it work. A
 * still panel asks them to read a claim instead, and they do not — they read
 * the headline, fail to picture the thing, and leave. Ours was a still panel.
 *
 * Built as animated markup rather than a recorded screen capture, which is a
 * decision and not a shortcut. A recording of this product would be a 20MB
 * file to host, blurry on a retina display, unreadable on a phone, silent to a
 * screen reader, and — the part that actually matters — **wrong within a
 * month**. Every screen in here is the product's own markup and its own
 * tokens, so it is sharp at any size, it is text, it restyles itself in dark
 * mode, and a change to the design system reaches it. A film that goes stale
 * on the landing page is worse than no film, because it advertises a product
 * that no longer exists.
 *
 * The five scenes are the five things this product actually does, in order,
 * and each one is the real artefact rather than a picture of it: the customer
 * profiles the Strategy Agent writes, the fit scores the Targeting Agent
 * produces, the note written from one person's own details, the pacing the
 * limiter enforces, and the reply the gate refuses to send.
 *
 * Scene four is the one nobody else shows. A competitor's film ends at "and
 * then it sends hundreds of them", because volume is the thing they are
 * selling; ours stops on the cap, because restraint is the thing we are
 * selling, and a buyer who has had an account restricted knows the difference
 * immediately.
 *
 * Two rules, both from the repo's own motion policy. It animates *from* a
 * visible resting state, never from zero opacity waiting on a timer, so a
 * thumbnail, a shared link and a reader with JavaScript off all get a whole
 * page. And anybody who has asked their system for reduced motion gets the
 * scenes as a static list instead — not a frozen first frame, which would hide
 * four fifths of the argument from exactly the people least able to chase it.
 */

const SCENE_MS = 5200;

/*
 * The pacing scene's numbers, from the constants the limiter obeys. The film
 * said "2–11 minutes" while the safety section said "2–9" and the constants
 * said 2 and 9: three readings of one rule on one page.
 */
const GAP_MIN = Math.round(LINKEDIN_LIMITS.minGapMs / 60_000);
const GAP_MAX = Math.round(LINKEDIN_LIMITS.maxGapMs / 60_000);
const WARMUP_WEEKS = Math.round(LINKEDIN_LIMITS.warmupDays / 7);

interface Scene {
  id: string;
  label: string;
  agent: string;
  caption: string;
  body: React.ReactNode;
}

/** A row in the film, animated in sequence. Index drives the stagger. */
function Line({
  children,
  index,
  still,
  className,
}: {
  children: React.ReactNode;
  index: number;
  still: boolean;
  className?: string;
}) {
  if (still) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      // A rise, not a fade from nothing: the row is opaque in the server's
      // markup, so a scene that never hydrates is a scene you can still read.
      initial={{ y: 8 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 + index * 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function scenes(still: boolean): Scene[] {
  return [
    {
      id: "strategy",
      label: "Strategy",
      agent: "Sage · strategist",
      caption: "You give it your website once. It comes back with who to go after.",
      body: (
        <div className="film-rows">
          {[
            { name: "Small B2B agencies", detail: "Founders who grow through partners", priority: "1st" },
            { name: "Referral-led professionals", detail: "Realtors, brokers, planners, CPAs", priority: "2nd" },
            { name: "Networking group leaders", detail: "Chapters, chambers, masterminds", priority: "3rd" },
          ].map((row, i) => (
            <Line key={row.name} index={i} still={still} className="film-row">
              <span className="film-row-main">
                <strong>{row.name}</strong>
                <span className="tiny subtle">{row.detail}</span>
              </span>
              <span className="pill plain tiny">{row.priority}</span>
            </Line>
          ))}
        </div>
      ),
    },
    {
      id: "targeting",
      label: "Targeting",
      agent: "Scout · prospector",
      caption: "It searches LinkedIn, opens every profile, and scores the fit against that strategy.",
      body: (
        <div className="film-rows">
          {[
            { name: "Dana Rizzo", title: "Owner, Rizzo Events", score: 91, why: "Runs a services business on referrals" },
            { name: "Meredith King", title: "Owner, Perfect You LLC", score: 84, why: "Solo practice, local clients" },
            { name: "Khrystyna Banakh", title: "Founder & CEO, Royal Media", score: 78, why: "Partner-led growth" },
          ].map((row, i) => (
            <Line key={row.name} index={i} still={still} className="film-row">
              <span className="film-row-main">
                <strong>{row.name}</strong>
                <span className="tiny subtle">
                  {row.title} · {row.why}
                </span>
              </span>
              <span className="film-score nums">{row.score}</span>
            </Line>
          ))}
          <Line index={3} still={still} className="tiny subtle">
            Anybody this workspace has already contacted is never on this list.
          </Line>
        </div>
      ),
    },
    {
      id: "note",
      label: "The note",
      agent: "Quinn · campaign writer",
      caption: "One connection request, written from that person's own profile. Not a template.",
      body: (
        <div className="film-rows">
          <Line index={0} still={still} className="film-note">
            <span className="tiny subtle">To Dana Rizzo</span>
            <p className="small">
              Hi Dana, Tashfeen here regarding Rizzo Events. Who was the last person to send you a
              client?
            </p>
          </Line>
          <Line index={1} still={still} className="film-chips">
            <span className="tiny subtle">Written from</span>
            <span className="pill plain tiny">her headline</span>
            <span className="pill plain tiny">her company</span>
            <span className="pill plain tiny">her title</span>
          </Line>
          <Line index={2} still={still} className="tiny subtle">
            A note carrying a link is dropped, not trimmed, because LinkedIn penalises links in
            invitations. You read every note before anything is sent.
          </Line>
        </div>
      ),
    },
    {
      id: "pacing",
      label: "Sending",
      agent: "Reese · within the limits",
      caption: "Then it goes slowly, on purpose. This is the part that keeps the account alive.",
      body: (
        <div className="film-rows">
          {[
            { k: "Today", v: "8 of 14 invitations" },
            { k: "Gap between sends", v: `${GAP_MIN} to ${GAP_MAX} minutes at the closest, spread across your hours` },
            { k: "Week", v: `never above ${LINKEDIN_LIMITS.invitesPerWeek}` },
            {
              k: "Warm-up",
              v: `starts at ${LINKEDIN_LIMITS.invitesPerDayStart} a day, ${WARMUP_WEEKS} weeks to full`,
            },
          ].map((row, i) => (
            <Line key={row.k} index={i} still={still} className="film-row">
              <span className="film-row-main">
                <strong>{row.k}</strong>
              </span>
              <span className="tiny subtle">{row.v}</span>
            </Line>
          ))}
          <Line index={4} still={still} className="tiny subtle">
            These are product rules, not settings. An account can be capped lower, never higher.
          </Line>
        </div>
      ),
    },
    {
      id: "reply",
      label: "The reply",
      agent: "Reese · replies",
      caption: "It answers what it can, and stops on anything that should be yours.",
      body: (
        <div className="film-rows">
          <Line index={0} still={still} className="film-note">
            <span className="tiny subtle">Dana replied</span>
            <p className="small">Interesting. What does this actually cost?</p>
          </Line>
          <Line index={1} still={still} className="film-note film-note-draft">
            <span className="tiny subtle">Drafted, not sent</span>
            <p className="small">
              Happy to go through it properly. Can I put fifteen minutes in the diary this week?
            </p>
          </Line>
          <Line index={2} still={still} className="film-chips">
            <span className="pill warning tiny">Held for you: pricing</span>
          </Line>
        </div>
      ),
    },
  ];
}

export function ProductFilm() {
  const reduced = useReducedMotion();

  /*
   * The server cannot know whether this reader asked for reduced motion, and
   * this component renders a different tree when they have — so the first
   * client render has to match what the server sent or React throws the whole
   * subtree away and rebuilds it, which it reports as a hydration failure and
   * a reader sees as the section flickering.
   *
   * So: everyone gets the film on the first paint, and the static list is
   * swapped in after mount for whoever asked for one. A single frame of the
   * film is the cost, and it buys a page that hydrates cleanly for everybody
   * — including the reader whose preference we are honouring, who would
   * otherwise get the flicker as well as the animation.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const still = mounted && Boolean(reduced);

  const all = scenes(still);

  const [active, setActive] = useState(0);
  /*
   * Three reasons the film stands still, kept apart because they end
   * differently.
   *
   * `playing` is the reader's own choice: the Pause button, or picking a
   * scene. Picking one used to set the same flag hovering did, so the scene a
   * reader chose to look at moved on the moment the pointer left the strip or
   * focus moved to the next control, which is a carousel taking its eyes back.
   * Only Play undoes it.
   *
   * `hovering` and `hidden` are transient: a pointer or focus resting on the
   * controls, and the tab being in the background, where a film that advanced
   * four times behind somebody's back returns to a scene that means nothing.
   */
  const [playing, setPlaying] = useState(true);
  const [hovering, setHovering] = useState(false);
  const [hidden, setHidden] = useState(false);
  const running = mounted && !still && playing && !hovering && !hidden;

  // The progress bar is a CSS animation and the advance is a timer. Each time
  // the film starts again both begin from zero, or the bar finishes early and
  // the scene changes under a bar that says it has seconds left.
  const [epoch, setEpoch] = useState(0);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (running && !wasRunning.current) setEpoch((n) => n + 1);
    wasRunning.current = running;
  }, [running]);

  const next = useCallback(() => setActive((i) => (i + 1) % all.length), [all.length]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(next, SCENE_MS);
    return () => window.clearTimeout(timer);
  }, [active, epoch, next, running]);

  useEffect(() => {
    if (still) return;
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [still]);

  // Reduced motion gets the whole argument as a list. A frozen first frame
  // would hide four scenes from the people least able to go looking for them.
  if (still) {
    return (
      <div className="film-static">
        {all.map((scene) => (
          <figure className="card film-card" key={scene.id}>
            <figcaption className="film-head">
              <span className="eyebrow">{scene.label}</span>
              <span className="tiny subtle">{scene.agent}</span>
            </figcaption>
            <p className="small film-caption">{scene.caption}</p>
            {scene.body}
          </figure>
        ))}
      </div>
    );
  }

  // Indexed rather than asserted: `active` is only ever set from this list, but
  // a wrap that ever came back undefined should render the first scene rather
  // than take the page down with it.
  const scene = all[active] ?? all[0]!;

  return (
    <div className="film">
      <figure className="card raised film-card">
        <figcaption className="film-head">
          <span className="eyebrow">{scene.label}</span>
          <span className="cluster">
            <span className="tiny subtle">{scene.agent}</span>
            {/* Autoplay that runs beside other content needs a way to stop it
                (WCAG 2.2.2), and a visible one: hovering the strip pauses it
                too, but nobody can be expected to discover that. */}
            <button
              type="button"
              className="btn secondary small film-toggle"
              aria-label={playing ? "Pause the walkthrough" : "Play the walkthrough"}
              onClick={() => setPlaying((was) => !was)}
            >
              {playing ? "Pause" : "Play"}
            </button>
          </span>
        </figcaption>

        {/* Height is held by the tallest scene rather than animated, so the page
            below does not jump every five seconds. */}
        <div className="film-stage">
          {/*
            `initial={false}`, exactly as the timeline and the gate already do
            it. Without it the first scene mounts at its `initial` opacity,
            which framer writes into the server's HTML, so the film's whole
            body would be invisible until the client hydrates.
          */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={scene.id}
              initial={{ opacity: 0.001 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0.001 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              <p className="small film-caption">{scene.caption}</p>
              {scene.body}
            </motion.div>
          </AnimatePresence>
        </div>
      </figure>

      {/*
        Plain toggle buttons with `aria-pressed`, not tabs. The strip carried
        `role="tab"` without the tab panel, the roving focus or the arrow keys
        that role promises, so a screen reader announced a widget that then
        did not behave like one. A button that says which scene is showing is
        the honest version of what this is.
      */}
      <div
        className="film-rail"
        role="group"
        aria-label="Choose a stage"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovering(false);
        }}
      >
        {all.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={i === active}
            className={`film-tab${i === active ? " is-active" : ""}`}
            onClick={() => {
              setActive(i);
              setPlaying(false);
            }}
          >
            <span className="film-tab-label">{s.label}</span>
            <span className="film-tab-track" aria-hidden="true">
              <span
                key={i === active ? `${s.id}-${epoch}` : s.id}
                className="film-tab-fill"
                style={{
                  animationDuration: `${SCENE_MS}ms`,
                  animationPlayState: i === active && running ? "running" : "paused",
                  transform: i < active ? "scaleX(1)" : undefined,
                }}
              />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
