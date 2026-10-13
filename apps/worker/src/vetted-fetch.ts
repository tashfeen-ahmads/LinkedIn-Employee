import { lookup } from "node:dns/promises";
import { checkFeedUrl, isPrivateIp, normalizeFeedUrl } from "@le/calendar";

/**
 * A GET that cannot be aimed at this network (rule 19).
 *
 * Every address a user types and the worker then fetches goes through here: a
 * calendar feed, and the company website the Strategy Agent reads. The worker
 * holds the service-role key and answers its own internal API on localhost, so
 * a URL pointed at `127.0.0.1:4000` or `169.254.169.254` reaches things no
 * browser could, with our credentials.
 *
 * Every hop is checked, not just the first. DNS is resolved and the resulting
 * address vetted, because a hostname the caller controls can point anywhere;
 * redirects are followed by hand for the same reason, since a 302 to
 * `http://169.254.169.254/` would otherwise undo every check made before it.
 *
 * The refusals are returned as kinds rather than sentences, because the two
 * callers say them to different people: a rep pasting a calendar address needs
 * to be told what to fix, and a strategy run simply reads one page fewer.
 */
export type VettedFetch =
  | { ok: true; response: Response; url: URL }
  | {
      ok: false;
      kind: "refused" | "private" | "unresolved" | "no_response" | "too_many_redirects" | "no_location";
      /** Present for `refused`: why the address itself was not acceptable. */
      reason?: string;
      host?: string;
    };

const MAX_REDIRECTS = 3;

export async function fetchVetted(
  startUrl: string,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
  depth = 0,
): Promise<VettedFetch> {
  if (depth > MAX_REDIRECTS) return { ok: false, kind: "too_many_redirects" };

  const verdict = checkFeedUrl(startUrl);
  if (!verdict.ok) return { ok: false, kind: "refused", reason: verdict.reason };

  const url = new URL(normalizeFeedUrl(startUrl));
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
      return { ok: false, kind: "private", host: url.hostname };
    }
  } catch {
    return { ok: false, kind: "unresolved", host: url.hostname };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      // Never "follow": the runtime would take the next hop without asking
      // any of the questions above.
      redirect: "manual",
      headers: init.headers,
      signal: AbortSignal.timeout(init.timeoutMs ?? 15_000),
    });
  } catch {
    return { ok: false, kind: "no_response", host: url.hostname };
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) return { ok: false, kind: "no_location" };
    return fetchVetted(new URL(location, url).toString(), init, depth + 1);
  }

  return { ok: true, response, url };
}
