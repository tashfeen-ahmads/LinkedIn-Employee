import { lookup } from "node:dns/promises";
import { checkFeedUrl, isPrivateIp, normalizeFeedUrl, parseIcsBusy } from "@le/calendar";
import type { WorkerContext } from "../context.js";
import { decryptJson, encryptJson } from "../crypto.js";

/** How far ahead we care about. Slots are never offered beyond two weeks. */
const WINDOW_DAYS = 45;
const MAX_BYTES = 5_000_000;

export interface FeedResult {
  ok: boolean;
  events?: number;
  error?: string;
}

/**
 * Attaches a published calendar feed to a rep.
 *
 * Validated and fetched once, here, rather than accepted and discovered to be
 * broken by a nightly job nobody reads. A rep who pastes the wrong link finds
 * out while they are still looking at the page.
 */
export async function connectCalendarFeed(
  ctx: WorkerContext,
  input: { workspaceId: string; userId: string; url: string },
): Promise<FeedResult> {
  if (!ctx.env.CREDENTIALS_KEY) {
    return { ok: false, error: "This deployment cannot store calendar addresses securely yet." };
  }

  const verdict = checkFeedUrl(input.url);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const url = normalizeFeedUrl(input.url);
  const host = new URL(url).hostname;

  // Fetched before it is stored. A feed that cannot be read is not a feed, and
  // storing it would put the rep in the state this whole design exists to avoid
  // -- believing their calendar is being watched when it is not.
  const fetched = await fetchIcs(url);
  if (!fetched.ok) return { ok: false, error: fetched.error };

  const { data: feed, error } = await ctx.db
    .from("calendar_feeds")
    .upsert(
      {
        workspace_id: input.workspaceId,
        user_id: input.userId,
        url_encrypted: encryptJson(url, ctx.env.CREDENTIALS_KEY),
        url_host: host,
        status: "ok",
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,user_id" },
    )
    .select("id")
    .single();
  if (error || !feed) return { ok: false, error: "That calendar could not be saved." };

  const events = await storeBusy(ctx, {
    feedId: feed.id,
    workspaceId: input.workspaceId,
    userId: input.userId,
    ics: fetched.body,
    timezone: await repTimezone(ctx, input.userId),
  });

  return { ok: true, events };
}

/**
 * Re-reads every connected feed. Run nightly.
 *
 * A failure marks the feed and keeps the intervals from the last good fetch.
 * Deleting them would turn a rotated URL or a bad afternoon at Google into a
 * calendar that suddenly looks completely free, which is the worse of the two
 * failures by a distance: the rep gets double-booked rather than under-booked.
 */
export async function syncCalendarFeeds(ctx: WorkerContext): Promise<void> {
  if (!ctx.env.CREDENTIALS_KEY) return;

  const { data: feeds } = await ctx.db
    .from("calendar_feeds")
    .select("id, workspace_id, user_id, url_encrypted, url_host");

  for (const feed of feeds ?? []) {
    let url: string;
    try {
      url = decryptJson<string>(feed.url_encrypted, ctx.env.CREDENTIALS_KEY);
    } catch {
      await markFailing(ctx, feed.id, "The stored address could not be read.");
      continue;
    }

    const fetched = await fetchIcs(url);
    if (!fetched.ok) {
      await markFailing(ctx, feed.id, fetched.error);
      continue;
    }

    const events = await storeBusy(ctx, {
      feedId: feed.id,
      workspaceId: feed.workspace_id,
      userId: feed.user_id,
      ics: fetched.body,
      timezone: await repTimezone(ctx, feed.user_id),
    });

    await ctx.db
      .from("calendar_feeds")
      .update({
        status: "ok",
        last_error: null,
        last_synced_at: new Date().toISOString(),
        event_count: events,
        updated_at: new Date().toISOString(),
      })
      .eq("id", feed.id);
  }
}

export async function disconnectCalendarFeed(
  ctx: WorkerContext,
  input: { workspaceId: string; userId: string },
): Promise<void> {
  // The busy rows cascade with the feed, so removing it genuinely stops this
  // product acting on a calendar the rep has withdrawn.
  await ctx.db
    .from("calendar_feeds")
    .delete()
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId);
}

async function markFailing(ctx: WorkerContext, feedId: string, error: string): Promise<void> {
  console.error("calendar feed sync failed", { feedId, error });
  await ctx.db
    .from("calendar_feeds")
    .update({ status: "failing", last_error: error, updated_at: new Date().toISOString() })
    .eq("id", feedId);
}

async function repTimezone(ctx: WorkerContext, userId: string): Promise<string> {
  const { data } = await ctx.db.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  return data?.timezone || "UTC";
}

/** Parses, replaces the stored window, and returns how many blocks it found. */
async function storeBusy(
  ctx: WorkerContext,
  input: { feedId: string; workspaceId: string; userId: string; ics: string; timezone: string },
): Promise<number> {
  const from = new Date(Date.now() - 86_400_000);
  const to = new Date(Date.now() + WINDOW_DAYS * 86_400_000);
  const busy = parseIcsBusy(input.ics, { from, to, fallbackTimezone: input.timezone });

  await ctx.db.from("calendar_feed_busy").delete().eq("feed_id", input.feedId);
  if (busy.length > 0) {
    await ctx.db.from("calendar_feed_busy").insert(
      busy.map((interval) => ({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        feed_id: input.feedId,
        starts_at: interval.start,
        ends_at: interval.end,
      })),
    );
  }
  return busy.length;
}

type Fetched = { ok: true; body: string } | { ok: false; error: string };

/**
 * A GET that cannot be aimed at this network.
 *
 * Every hop is checked, not just the first. DNS is resolved and the resulting
 * address vetted, because a hostname the caller controls can point anywhere;
 * redirects are followed by hand for the same reason, since a 302 to
 * `http://169.254.169.254/` would otherwise undo every check made before it.
 */
async function fetchIcs(startUrl: string, depth = 0): Promise<Fetched> {
  if (depth > 3) return { ok: false, error: "That address redirects too many times." };

  const verdict = checkFeedUrl(startUrl);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  const url = new URL(normalizeFeedUrl(startUrl));
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
      return { ok: false, error: "That address points inside a private network." };
    }
  } catch {
    return { ok: false, error: `No server answers at ${url.hostname}.` };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.1" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: "That calendar did not respond." };
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) return { ok: false, error: "That calendar redirected to nowhere." };
    return fetchIcs(new URL(location, url).toString(), depth + 1);
  }

  if (!response.ok) {
    // 401 and 404 are the two that actually happen: a rotated secret address,
    // or a calendar whose sharing was turned off. Both need the rep to fetch a
    // new link, and both are worth saying rather than "sync failed".
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return { ok: false, error: "That calendar is no longer shared at this address. Copy the secret address again." };
    }
    return { ok: false, error: `That calendar answered ${response.status}.` };
  }

  const body = await response.text();
  if (body.length > MAX_BYTES) return { ok: false, error: "That calendar is too large to read." };
  if (!body.includes("BEGIN:VCALENDAR")) {
    // Almost always an HTML page: the rep copied the browser URL rather than
    // the secret iCal address, which is an easy mistake and a clear fix.
    return { ok: false, error: "That address is not a calendar feed. Look for the secret address in iCal format, ending .ics." };
  }
  return { ok: true, body };
}
