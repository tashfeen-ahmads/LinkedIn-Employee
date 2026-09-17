/**
 * What the last press of "Find more" did, in words.
 *
 * The search runs in the worker, so this page never learns how the job it
 * started went. Without a sentence here, a run that stopped early, a run still
 * in flight, and a run that added thirty people all leave the page looking
 * exactly as it did before the press — which is the report this product has had
 * more than once, and it was an accurate description.
 */
export interface SearchEvent {
  name: string;
  payload: unknown;
  created_at: string;
}

export interface SearchNotice {
  tone: "accent" | "danger" | "muted";
  title: string;
  body: string;
}

function payloadOf(event: SearchEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

function count(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * A run older than this is history rather than news.
 *
 * A stop report from last week sitting above the button reads as the state of
 * the button, and would have someone deciding not to press it because of
 * something that was true before the list they are looking at was built.
 */
const RECENT_MS = 6 * 60 * 60 * 1000;

export function describeSearch(
  event: SearchEvent | null | undefined,
  now: number = Date.now(),
): SearchNotice | null {
  if (!event) return null;
  if (now - new Date(event.created_at).getTime() > RECENT_MS) return null;

  const payload = payloadOf(event);

  if (event.name === "targeting.queued") {
    return {
      tone: "muted",
      title: "Searching LinkedIn now.",
      body: "It takes about a minute. Reload this page and the new names appear at the bottom of the list.",
    };
  }

  if (event.name === "campaign.extended") {
    const added = count(payload.added) ?? 0;
    const searched = count(payload.searched) ?? 0;
    const known = count(payload.alreadyKnown) ?? 0;
    const exhausted = payload.exhausted === true;
    // Both halves matter. "Added 12" alone makes a page of 50 look like a bad
    // search; saying 38 were already on the list makes it the deduplication
    // working, which is the whole reason nobody gets contacted twice.
    const body = [
      added === 0
        ? `LinkedIn returned ${searched} ${searched === 1 ? "person" : "people"} and every one of them was already on your list.`
        : `Read ${searched} ${searched === 1 ? "profile" : "profiles"}, of which ${known} ${known === 1 ? "was" : "were"} already on your list.`,
      exhausted
        ? "That was the last page LinkedIn will return for this customer profile."
        : "Press Find more again for the next page.",
    ].join(" ");

    return {
      tone: added > 0 ? "accent" : "muted",
      title:
        added > 0
          ? `Added ${added} ${added === 1 ? "person" : "people"}.`
          : "Nobody new on that page.",
      body,
    };
  }

  const reason = typeof payload.reason === "string" ? payload.reason : "The search stopped early.";
  return { tone: "danger", title: "The last search stopped early.", body: reason };
}
