/**
 * What the strategy page says about the last prospect search, if anything.
 *
 * It read the newest of `targeting.queued` and `targeting.stopped` and nothing
 * else — so a search that worked, whose last word is `campaign.created`, left
 * its own `targeting.queued` as the newest row for ever, and the page announced
 * "the background worker took the job and did not finish it" above a campaign
 * that search had just built. Every successful run reported itself as a
 * failure, permanently. It also printed the event's payload as JSON to the
 * customer: build ids and internal fields on somebody else's dashboard
 * (rule 54).
 *
 * The campaign screen had already got this right (`describeSearch` in
 * `campaigns/[id]/search-state.ts`), and this follows it: completion events
 * count, an old report is history rather than news, and a stop says only the
 * reason it was given. Pure, so it can be tested without a database.
 */
export interface SearchEvent {
  name: string;
  payload: unknown;
  created_at: string;
}

export interface LastSearchNotice {
  tone: "muted" | "warning";
  title: string;
  body: string;
  /** When the event was recorded, so the page can date it. */
  at: string;
}

/** Every event that ends — or starts — a search. The page queries exactly these. */
export const SEARCH_EVENTS = ["targeting.queued", "targeting.stopped", "campaign.created", "campaign.extended"];

/** The same window the campaign screen uses: older than this is history. */
export const RECENT_MS = 6 * 60 * 60 * 1000;

/**
 * How long a search may go unanswered before that is worth saying. The agent
 * takes about a minute; a run past ten has not finished.
 */
export const STALLED_MS = 10 * 60 * 1000;

export function describeLastSearch(
  event: SearchEvent | null | undefined,
  now: number = Date.now(),
): LastSearchNotice | null {
  if (!event) return null;
  const at = new Date(event.created_at).getTime();
  if (!Number.isFinite(at) || now - at > RECENT_MS) return null;

  // Finished. What it built is on the campaigns page, and an approval or a
  // Find more already said it had started; nothing here needs saying.
  if (event.name === "campaign.created" || event.name === "campaign.extended") return null;

  if (event.name === "targeting.queued") {
    if (now - at < STALLED_MS) {
      return {
        tone: "muted",
        title: "Searching LinkedIn now.",
        body: "It takes about a minute. The list appears under Campaigns when it is done.",
        at: event.created_at,
      };
    }
    return {
      tone: "warning",
      title: "The last prospect search has not reported back.",
      body: "It was started more than ten minutes ago and has not finished. Press Find prospects on the strategy to run it again — if it stops again, tell us from Support and we will look into it.",
      at: event.created_at,
    };
  }

  if (event.name === "targeting.stopped") {
    const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
    const reason = typeof payload.reason === "string" && payload.reason.trim() ? payload.reason : "No reason was recorded.";
    return { tone: "warning", title: "The last prospect search stopped early.", body: reason, at: event.created_at };
  }

  return null;
}
