"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import type { PointerEvent, ReactNode } from "react";
import { LEAD, NORA, TEAM } from "@/lib/team";
import { TeamAvatar } from "./team-avatar";

/*
 * NORA and her four, drawn as what they are: one assistant at the centre and
 * a hand-off line underneath her.
 *
 * Motion on reveal.tsx's two rules, because they were learned the hard way:
 *
 *  - Nothing starts invisible. Every entrance is a *rise* from a visible,
 *    slightly tilted resting state, so the server's markup is whole — a
 *    crawler, a link preview and a page whose scripts never ran all see the
 *    team. Framer writes `initial` into the server's inline style, so it is
 *    identical on both sides and only the travel is lost without JavaScript.
 *  - Reduced motion takes the duration to zero and never changes the markup;
 *    a second branch on `useReducedMotion()` mismatches at hydration, because
 *    it is null on the server and true on the client.
 *
 * The orbit, the float and the hand-off packet are CSS animations rather than
 * framer loops: they need no JavaScript to run, cost nothing on the main
 * thread, and the global `prefers-reduced-motion` rule already stops them.
 * Framer is spent where it earns its weight — the pointer-driven tilt, which
 * is springs, and the staggered entrance.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

/** A card that leans toward the pointer, with a soft light following it. */
function TiltCard({
  className,
  children,
  max = 7,
}: {
  className: string;
  children: ReactNode;
  max?: number;
}) {
  const reduced = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const sx = useSpring(px, { stiffness: 220, damping: 22, mass: 0.6 });
  const sy = useSpring(py, { stiffness: 220, damping: 22, mass: 0.6 });
  const rotateY = useTransform(sx, [0, 1], [-max, max]);
  const rotateX = useTransform(sy, [0, 1], [max, -max]);
  const gx = useTransform(sx, (v) => `${Math.round(v * 100)}%`);
  const gy = useTransform(sy, (v) => `${Math.round(v * 100)}%`);
  const glare = useMotionTemplate`radial-gradient(22rem circle at ${gx} ${gy}, var(--crew-glare), transparent 62%)`;

  function move(event: PointerEvent<HTMLDivElement>) {
    // A mouse only. On a touch screen a tilt follows the finger that is trying
    // to scroll the page, which reads as the page fighting back.
    if (reduced || event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - box.left) / box.width);
    py.set((event.clientY - box.top) / box.height);
  }
  function leave() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <motion.div
      className={`crew-tilt ${className}`}
      style={{ rotateX, rotateY }}
      onPointerMove={move}
      onPointerLeave={leave}
    >
      <motion.span className="crew-glare" style={{ backgroundImage: glare }} aria-hidden="true" />
      {children}
    </motion.div>
  );
}

/** The orbit: NORA's core, and the four of them going round it in 3D. */
function Orbit() {
  return (
    <div className="crew-orbit" aria-hidden="true">
      <div className="crew-orbit-plane">
        <div className="crew-orbit-ring" />
        <div className="crew-orbit-ring is-inner" />
        <span className="crew-core-halo" />
        <div className="crew-orbit-spin">
          {TEAM.map((member, index) => (
            <span key={member.key} className={`crew-orbit-anchor at-${index}`}>
              <span className={`crew-orbit-dot crew-${member.key}`}>{member.name.charAt(0)}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="crew-core">
        <TeamAvatar member="lead" size="lg" />
      </div>
    </div>
  );
}

export function TeamStage() {
  const reduced = useReducedMotion();

  // The whole scene leans a little with the pointer, and the layers move by
  // different amounts — the orbit furthest, the cards least — which is what
  // makes it read as depth rather than as one tilted picture.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 70, damping: 18 });
  const sy = useSpring(py, { stiffness: 70, damping: 18 });
  const sceneY = useTransform(sx, [-0.5, 0.5], [-3, 3]);
  const sceneX = useTransform(sy, [-0.5, 0.5], [2.5, -2.5]);
  const orbitX = useTransform(sx, [-0.5, 0.5], [-14, 14]);
  const orbitY = useTransform(sy, [-0.5, 0.5], [-10, 10]);

  function move(event: PointerEvent<HTMLDivElement>) {
    if (reduced || event.pointerType !== "mouse") return;
    const box = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - box.left) / box.width - 0.5);
    py.set((event.clientY - box.top) / box.height - 0.5);
  }
  function leave() {
    px.set(0);
    py.set(0);
  }

  const enter = (delay: number) =>
    reduced ? { duration: 0 } : { duration: 0.7, delay, ease: EASE };

  return (
    <div className="crew-stage" onPointerMove={move} onPointerLeave={leave}>
      <motion.div className="crew-scene" style={{ rotateX: sceneX, rotateY: sceneY }}>
        <div className="crew-top">
          {/* Entrance on the outside, parallax on the inside: one element
              cannot be both animated to a `y` and bound to a derived one. */}
          <motion.div
            className="crew-orbit-wrap"
            initial={{ scale: 0.9, y: 12 }}
            whileInView={{ scale: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={enter(0)}
          >
            <motion.div style={{ x: orbitX, y: orbitY }}>
              <Orbit />
            </motion.div>
          </motion.div>

          <motion.div
            className="crew-lead-wrap"
            initial={{ y: 18, x: 12 }}
            whileInView={{ y: 0, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={enter(0.08)}
          >
            <TiltCard className="card raised crew-lead-card" max={4}>
              <div className="crew-head">
                <TeamAvatar member="lead" size="md" />
                <div className="crew-who">
                  <h3>{NORA}</h3>
                  <span className="small muted">{LEAD.role}</span>
                </div>
                <span className="pill accent">Team lead</span>
              </div>
              <p className="crew-line-text">{LEAD.line}</p>
              <ul className="crew-does small muted">
                {LEAD.does.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </TiltCard>
          </motion.div>
        </div>

        {/*
          The org chart's trunk and bar, and the packet that travels along it.
          Drawn in CSS and hidden below the width where the four sit in one
          row: on a phone the hand-off is said in words between the cards
          instead, because a bar joining cards that are stacked joins nothing.
        */}
        <div className="crew-trunk" aria-hidden="true" />

        <div className="crew-team-wrap">
          <span className="crew-bar" aria-hidden="true">
            <span className="crew-packet" />
          </span>
          <ol className="crew-team" aria-label={`${NORA}'s team, in the order work passes between them`}>
            {TEAM.map((member, index) => {
              const next = TEAM[index + 1];
              return (
                <motion.li
                  key={member.key}
                  className="crew-step"
                  initial={{ y: 14, rotateX: 14, scale: 0.98 }}
                  whileInView={{ y: 0, rotateX: 0, scale: 1 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={enter(0.12 + index * 0.09)}
                >
                  <TiltCard className={`card crew-card crew-${member.key}`}>
                    <div className="crew-head">
                      <TeamAvatar member={member.key} />
                      <div className="crew-who">
                        <h3>{member.name}</h3>
                        <span className="small muted">{member.role}</span>
                      </div>
                      <span className="crew-n mono" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <p className="crew-line-text">{member.line}</p>
                    <ul className="crew-does small muted">
                      {member.does.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <p className="crew-handoff tiny">
                      <span className="crew-handoff-arrow" aria-hidden="true">
                        &rarr;
                      </span>
                      {next ? `Hands to ${next.name}` : "Hands the meeting to you"}
                    </p>
                  </TiltCard>
                </motion.li>
              );
            })}
          </ol>
        </div>
      </motion.div>
    </div>
  );
}
