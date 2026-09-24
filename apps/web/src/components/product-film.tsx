"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

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
      initial={{ opacity: 0.001, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
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
      agent: "Strategy Agent",
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
      agent: "Targeting Agent",
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
                  {row.title} — {row.why}
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
      agent: "Invite writer",
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
            A note carrying a link is dropped, not trimmed — LinkedIn penalises links in
            invitations. You read every note before anything is sent.
          </Line>
        </div>
      ),
    },
    {
      id: "pacing",
      label: "Sending",
      agent: "The limiter",
      caption: "Then it goes slowly, on purpose. This is the part that keeps the account alive.",
      body: (
        <div className="film-rows">
          {[
            { k: "Today", v: "8 of 14 invitations" },
            { k: "Gap between sends", v: "2–11 minutes, randomised" },
            { k: "Week", v: "never above 100" },
            { k: "Warm-up", v: "starts at 10 a day, five weeks to full" },
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
      agent: "Reply Agent",
      caption: "It answers what it can answer — and stops on anything that should be yours.",
      body: (
        <div className="film-rows">
          <Line index={0} still={still} className="film-note">
            <span className="tiny subtle">Dana replied</span>
            <p className="small">Interesting — what does this actually cost?</p>
          </Line>
          <Line index={1} still={still} className="film-note film-note-draft">
            <span className="tiny subtle">Drafted, not sent</span>
            <p className="small">
              Happy to go through it properly. Can I put fifteen minutes in the diary this week?
            </p>
          </Line>
          <Line index={2} still={still} className="film-chips">
            <span className="pill warning tiny">Held for you — pricing</span>
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
  // Stops the timer while the reader is deliberately looking at one scene, and
  // while the tab is in the background — a film that advanced four times
  // behind somebody's back returns to a scene that means nothing.
  const [held, setHeld] = useState(false);

  const next = useCallback(() => setActive((i) => (i + 1) % all.length), [all.length]);

  useEffect(() => {
    if (!mounted || still || held) return;
    const timer = window.setTimeout(next, SCENE_MS);
    return () => window.clearTimeout(timer);
  }, [active, held, mounted, next, still]);

  useEffect(() => {
    if (still) return;
    const onVisibility = () => setHeld(document.hidden);
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
          <span className="tiny subtle">{scene.agent}</span>
        </figcaption>

        {/* Height is held by the tallest scene rather than animated, so the page
            below does not jump every five seconds. */}
        <div className="film-stage">
          <AnimatePresence mode="wait">
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

      {/* Controllable, not decorative. A film that cannot be stopped is one a
          reader fights; these are real buttons, reachable by keyboard, and the
          labels say what each scene is rather than "slide 3". */}
      <div className="film-rail" role="tablist" aria-label="What the product does">
        {all.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={`film-tab${i === active ? " is-active" : ""}`}
            onClick={() => {
              setActive(i);
              setHeld(true);
            }}
            onMouseEnter={() => setHeld(true)}
            onMouseLeave={() => setHeld(false)}
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
          >
            <span className="film-tab-label">{s.label}</span>
            <span className="film-tab-track" aria-hidden="true">
              <span
                className="film-tab-fill"
                style={{
                  animationDuration: `${SCENE_MS}ms`,
                  animationPlayState: i === active && !held ? "running" : "paused",
                  width: i < active ? "100%" : undefined,
                }}
              />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
