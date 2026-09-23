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
      <p>{error ?? notice}</p>
    </div>
  );
}

/** What every page's `searchParams` needs to accept for the banner to arrive. */
export type NoticeParams = Promise<{ error?: string; notice?: string }>;
