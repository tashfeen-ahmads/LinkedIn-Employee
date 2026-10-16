"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { WALKTHROUGH, walkthroughHref, walkthroughStop } from "@/lib/walkthrough";

/**
 * The tour card: one stop of the app at a time, over the real page.
 *
 * Driven by `?tour=N` rather than by state of its own, so each stop is an
 * ordinary page load of the screen it describes, Back works, and a link can
 * start the tour anywhere. Not modal: the page under it is the thing being
 * explained, and a card that blocked it would be explaining a screenshot.
 */
export function Walkthrough() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const found = walkthroughStop(params.get("tour"));
  const heading = useRef<HTMLParagraphElement>(null);
  const launched = params.get("launched");

  // The nav item for this stop carries a mark, so "this page" is visible in
  // the rail as well as in the card.
  const stopHref = found?.stop.href ?? null;
  useEffect(() => {
    if (!stopHref) return;
    const link = document.querySelector(`.app .nav a[href="${stopHref}"]`);
    link?.setAttribute("data-tour-here", "");
    heading.current?.focus();
    return () => link?.removeAttribute("data-tour-here");
  }, [stopHref]);

  // Escape ends the tour, as it would close anything floating over a page.
  useEffect(() => {
    if (!stopHref) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.replace(pathname);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stopHref, pathname, router]);

  if (!found) return null;
  const { index, stop } = found;
  const last = index === WALKTHROUGH.length - 1;
  const first = index === 0;

  return (
    <section className="walkthrough" role="region" aria-labelledby="walkthrough-title" aria-live="polite">
      <p className="tiny subtle">
        {index + 1} of {WALKTHROUGH.length}
      </p>
      {first && launched ? (
        <p className="small walkthrough-live">
          <strong>Your first campaign is live.</strong>{" "}
          {launched === "late"
            ? "Sending starts as soon as the sending service answers; nothing is lost."
            : "Inside your sending hours the first invitation goes out within seconds; the rest are spread across them."}{" "}
          Here is a two-minute look round.
        </p>
      ) : null}
      {/* Not an h2: headings belong to the page frame (rule 34), and this card
          floats over a page that already has its own. */}
      <p className="walkthrough-title" id="walkthrough-title" ref={heading} tabIndex={-1}>
        {stop.title}
      </p>
      <p className="small">{stop.body}</p>
      <div className="walkthrough-actions">
        <Link className="small" href={pathname} replace>
          {last ? "Close" : "Skip the tour"}
        </Link>
        <span className="cluster">
          {first ? null : (
            <Link className="btn secondary small" href={walkthroughHref(index - 1)}>
              Back
            </Link>
          )}
          <Link className="btn small" href={last ? "/app" : walkthroughHref(index + 1)}>
            {last ? "Finish" : "Next"}
          </Link>
        </span>
      </div>
    </section>
  );
}
