"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * What a server action leaves behind, said and then got out of the way.
 *
 * An action that redirects has no other channel back to the page it came from,
 * so the message travels in the query string and is rendered here.
 *
 * A confirmation that never leaves is its own problem. It stays in the URL, so
 * a refresh re-announces a save from ten minutes ago, and every screenshot and
 * shared link carries it. So a success clears itself: shown, then removed from
 * the history without a navigation.
 *
 * An error does **not** auto-dismiss. A confirmation is a courtesy and a
 * failure is information somebody has to act on — hiding it after four seconds
 * is how "it just did nothing" happens.
 *
 * `role="status"` rather than `role="alert"` for a success, so a screen reader
 * announces it in turn; an error is assertive, because it changes what the
 * person should do next.
 */
export function PageNotice({
  error,
  notice,
  dismissAfterMs = 4000,
}: {
  error?: string;
  notice?: string;
  dismissAfterMs?: number;
}) {
  const [hidden, setHidden] = useState(false);
  /*
   * The words arrive a tick after the region does.
   *
   * A live region that is mounted with its text already inside is, in most
   * screen readers, never announced: they watch a region for *changes*, and a
   * region that appears fully formed has not changed. So the region renders
   * empty on the server and on first paint, and the message is put into it
   * after mount — which is a change, and is read out.
   */
  const message = error ?? notice ?? "";
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    setSpoken("");
    if (!message) return;
    const frame = requestAnimationFrame(() => setSpoken(message));
    return () => cancelAnimationFrame(frame);
  }, [message]);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    // Errors stay until the person navigates away themselves.
    if (!notice || error) return;
    setHidden(false);
    const timer = setTimeout(() => {
      setHidden(true);
      // Taken out of the URL as well, or a refresh re-announces it. `replace`
      // rather than `push`, so Back does not walk through old confirmations.
      const next = new URLSearchParams(search.toString());
      next.delete("notice");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, dismissAfterMs);
    return () => clearTimeout(timer);
  }, [notice, error, dismissAfterMs, pathname, router, search]);

  if (!error && !notice) return null;
  if (hidden && !error) return null;

  return (
    <div
      className={`notice ${error ? "danger" : "accent"} ${error ? "" : "notice-transient"}`}
      role={error ? "alert" : "status"}
    >
      {/* What is seen is rendered at once, so the server render and a page
          with no script still show it. What is *read* is the screen-reader
          copy, filled in after mount (above) so it is announced — one sentence
          for each audience, and nothing read twice. */}
      <p aria-hidden="true">{message}</p>
      <span className="sr-only">{spoken}</span>
    </div>
  );
}

/** What every page's `searchParams` needs to accept for the banner to arrive. */
export type NoticeParams = Promise<{ error?: string; notice?: string }>;
