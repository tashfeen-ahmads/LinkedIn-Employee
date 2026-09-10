"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * A single entrance, used sparingly.
 *
 * The page is fully readable at rest — this starts from a visible state and
 * settles, rather than parking content at zero opacity waiting on a scroll
 * observer. A shared link, a thumbnail and a reader who scrolls fast all get
 * the same page.
 */
export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;

  return (
    <motion.div
      initial={{ opacity: 0.001, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
