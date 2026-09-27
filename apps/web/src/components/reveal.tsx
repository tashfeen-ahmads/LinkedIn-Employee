"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/*
 * Motion, on two rules.
 *
 * Everything animates *from* a visible resting state, never from zero opacity
 * waiting on an observer — if the script never runs, the page is still whole,
 * which is what a shared link, a thumbnail and a fast scroller all get.
 *
 * And anyone who has asked their system for reduced motion gets none of it.
 *
 * The first rule was written down here and then broken on the line below it.
 * `opacity: 0.001` is not a visible resting state, it is zero with a decimal
 * point in it — and it is the value framer renders into the *server's* HTML,
 * so the markup left this building invisible and stayed invisible until a
 * client-side observer fired. Which meant a landing page that is blank to a
 * crawler, blank in a link preview, blank on a connection slow enough that
 * somebody scrolls before hydration, and blank for ever if any script on the
 * page throws. Every section below the hero, on the one page that has to sell
 * this product.
 *
 * So nothing fades from nothing. A reveal is a **rise**: the element is fully
 * opaque in the server's markup and ten pixels low, and the animation brings
 * it home. With JavaScript the movement is the same to look at; without it the
 * page is whole and ten pixels out, which nobody can see.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

export function Reveal({
  children,
  delay = 0,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  as?: "div" | "li" | "section";
}) {
  const reduced = useReducedMotion();

  /*
   * Reduced motion turns the animation off, never the element.
   *
   * `useReducedMotion()` returns null on the server and true on a
   * reduced-motion client, and this used to return a bare fragment in that
   * case — so the server sent a wrapper the client did not render, React
   * called it a hydration mismatch and regenerated the entire tree on the
   * client. Which is the exact failure the note above this file exists to
   * prevent: a landing page that is whole in the markup and then thrown away
   * and rebuilt, for every visitor who has asked their system to calm down.
   *
   * The cure is not a second branch on `reduced`: framer writes `initial` into
   * the server's inline style, so gating `initial` on it mismatches the
   * *attribute* instead of the element, which React reports as "won't be
   * patched up" and leaves the page rendered from the wrong values. Both sides
   * send identical markup and reduced motion only takes the duration to zero —
   * the element still arrives, it simply does not travel.
   */
  const Tag = motion[as];
  return (
    <Tag
      initial={{ y: 10 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={reduced ? { duration: 0 } : { duration: 0.5, delay, ease: EASE }}
    >
      {children}
    </Tag>
  );
}

const container: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};

const item: Variants = {
  hidden: { y: 12 },
  shown: { y: 0, transition: { duration: 0.45, ease: EASE } },
};

/**
 * A group whose children arrive one after another. The stagger is what makes a
 * grid read as a sequence rather than a slab appearing at once — it is doing
 * work, not decoration.
 */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();

  // Same markup either way — see `Reveal`. Only the stagger's timing goes.
  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "-60px" }}
      transition={reduced ? { duration: 0, staggerChildren: 0, delayChildren: 0 } : undefined}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={item}
      transition={reduced ? { duration: 0 } : undefined}
    >
      {children}
    </motion.div>
  );
}

/**
 * A line that draws itself as it comes into view, used on the diagrams to show
 * direction of flow. Purely an SVG path length trick.
 */
export function DrawPath({ d, className }: { d: string; className?: string }) {
  const reduced = useReducedMotion();

  // `motion.path` with no animation props is a plain path, so the element is
  // the same on both sides and only the drawing stops.
  return (
    <motion.path
      d={d}
      className={className}
      /*
       * The one place a zero start is right, and it is `pathLength` rather
       * than opacity: without the script the path renders at its full length,
       * which is the finished drawing rather than a blank.
       */
      initial={{ pathLength: 0 }}
      whileInView={{ pathLength: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={reduced ? { duration: 0 } : { duration: 0.9, ease: "easeInOut" }}
    />
  );
}
