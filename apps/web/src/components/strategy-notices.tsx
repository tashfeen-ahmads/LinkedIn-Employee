import Link from "next/link";
import type { LastSearchNotice } from "@/lib/last-search";
import { formatDateTime, isoAttr } from "@/lib/format";

/**
 * What every strategy screen says above its menu: how the last search went,
 * and whether there is an account to search with.
 *
 * The agent runs in the worker, so the page that started it never learns how
 * it went. Pressing "find prospects" and coming back to the same empty list
 * was indistinguishable from pressing nothing at all. Reported whether or not
 * the run failed loudly: the interesting case is the one that succeeded at
 * doing nothing.
 */
export function StrategySearchNotices({
  lastSearch,
  timezone,
  connected,
}: {
  lastSearch: LastSearchNotice | null;
  timezone: string | null;
  connected: boolean;
}) {
  return (
    <>
      {lastSearch ? (
        <div className={lastSearch.tone === "warning" ? "notice warning" : "notice"} role="status">
          <p>
            <strong>{lastSearch.title}</strong> {lastSearch.body}
          </p>
          {/* When, and nothing else. The payload is the worker's record —
              build ids and internal fields — and never the customer's to read
              (rule 54). */}
          <p className="tiny subtle">
            <time dateTime={isoAttr(lastSearch.at)}>{formatDateTime(lastSearch.at, timezone)}</time>
          </p>
        </div>
      ) : null}
      {!connected ? (
        <div className="notice">
          {/* Profile, not Team: the connect button lives on the profile, and
              this sentence used to send people to a page with nothing to press. */}
          <p>
            Connect your LinkedIn account before looking for prospects.{" "}
            <Link href="/app/profile#linkedin-heading">Connect it on your profile</Link>
          </p>
        </div>
      ) : null}
    </>
  );
}
