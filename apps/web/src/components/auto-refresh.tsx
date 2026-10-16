"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the page every few seconds while something it is waiting on runs.
 *
 * Onboarding hands off twice to an agent that takes a minute or two — Sage
 * writing the strategies, and the search building the list — and a screen that
 * said "refresh to check" left a new customer looking at a page that never
 * changed. Only rendered while waiting, so a finished page makes no requests.
 */
export function AutoRefresh({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      // Not while the tab is hidden: nobody is watching, and a backgrounded
      // tab refreshing every few seconds for an hour is load for nothing.
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}
