"use client";

import { useEffect, useState } from "react";
import { isStaleBuild, mayReloadAgain, STALE_RELOAD_KEY } from "@/lib/stale-build";

/**
 * What somebody sees instead of "Application error: a client-side exception".
 *
 * A page left open across a deploy is the common case, and reloading fixes it,
 * so that happens by itself — once, because a reload that does not help would
 * otherwise loop. Anything else says what to do in words and offers the two
 * buttons that might help.
 */
export function ErrorRecovery({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!isStaleBuild(error)) return;
    let allowed = true;
    try {
      allowed = mayReloadAgain(window.sessionStorage.getItem(STALE_RELOAD_KEY), Date.now());
      if (allowed) window.sessionStorage.setItem(STALE_RELOAD_KEY, String(Date.now()));
    } catch {
      // Storage refused (a private window): reload anyway, at worst once more.
    }
    if (allowed) {
      setReloading(true);
      window.location.reload();
    }
  }, [error]);

  return (
    <div className="notice warning" role="alert" style={{ maxWidth: "36rem", margin: "4rem auto" }}>
      {reloading ? (
        <p>
          <strong>NORA was just updated.</strong> Reloading the page — your answers are kept, so press
          the button again once it opens.
        </p>
      ) : (
        <>
          <p>
            <strong>Something went wrong on this page.</strong> Nothing you entered was sent. Try again,
            or reload the page. If it keeps happening, tell us from the Support page.
          </p>
          <div className="cluster">
            <button className="btn" type="button" onClick={() => reset()}>
              Try again
            </button>
            <button className="btn secondary" type="button" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </>
      )}
    </div>
  );
}
