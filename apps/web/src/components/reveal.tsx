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
  if (reduced) return <>{children}</>;

  const Tag = motion[as];
  return (
    <Tag
      initial={{ opacity: 0.001, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: EASE }}
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
  hidden: { opacity: 0.001, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

/**
 * A group whose children arrive one after another. The stagger is what makes a
 * grid read as a sequence rather than a slab appearing at once — it is doing
 * work, not decoration.
 */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: "-60px" }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={item}>
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
  if (reduced) return <path d={d} className={className} />;

  return (
    <motion.path
      d={d}
      className={className}
      initial={{ pathLength: 0, opacity: 0.001 }}
      whileInView={{ pathLength: 1, opacity: 1 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.9, ease: "easeInOut" }}
    />
  );
}
