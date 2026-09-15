import "server-only";

/**
 * Calls into the worker's internal API. Every one of these endpoints acts on a
 * named workspace, so the call is authenticated with a shared secret and the
 * workspace always comes from the caller's session — never from a form field.
 *
 * This used to return `T | null` and catch everything on the way. A caller then
 * had no way to tell "the worker said no" from "the worker returned nothing to
 * say", and the common shape — `if (result?.url) redirect(result.url)` — did
 * precisely nothing when the call failed. No error, no navigation, no change on
 * the page. Four buttons on the team page behaved that way for weeks against
 * routes that did not exist.
 *
 * So the result is a discriminated union: a caller has to look at `ok`, and the
 * failure carries a sentence that can be shown to whoever clicked.
 */
export type WorkerResult<T> =
  | { ok: true; data: T | null }
  | { ok: false; error: string };

export async function callWorker<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<WorkerResult<T>> {
  const base = process.env.WORKER_URL ?? "http://localhost:4000";
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error("INTERNAL_API_SECRET is not set; refusing to call the worker");
    return { ok: false, error: "This deployment is not finished being set up." };
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    // A timeout and a refused connection look the same to whoever clicked, and
    // the distinction is in the log rather than on the screen.
    console.error(`worker ${path} failed`, error);
    return { ok: false, error: "The background service is not responding. Please try again." };
  }

  if (!response.ok) {
    console.error(`worker ${path} responded ${response.status}`);
    // The worker says why when it knows why — a rejected provider key and a
    // provider outage are both 5xx here and need different things done about
    // them. Its sentence beats a status code translated into a shrug.
    const said = await response
      .clone()
      .json()
      .then((body: unknown) => (body as { error?: unknown })?.error)
      .catch(() => undefined);
    return {
      ok: false,
      error: typeof said === "string" && said.trim() ? said : describe(response.status),
    };
  }

  try {
    const text = await response.text();
    return { ok: true, data: text ? (JSON.parse(text) as T) : null };
  } catch (error) {
    console.error(`worker ${path} returned unreadable body`, error);
    return { ok: false, error: "The background service returned something unexpected." };
  }
}

/**
 * Status codes, said in a way that tells the person in front of the screen what
 * to do. A 401 here is never the user's own sign-in — it is this service's
 * shared secret disagreeing with the worker's, which they cannot fix and should
 * not be asked to.
 */
function describe(status: number): string {
  if (status === 401 || status === 403) {
    return "This app could not authenticate with its background service. Its administrator needs to check the shared secret.";
  }
  if (status === 404) return "That is not available on this deployment.";
  if (status === 409) return "That has already been done.";
  if (status >= 500) return "The background service had a problem. Please try again in a moment.";
  return "That request was refused.";
}

/**
 * Server actions report failure by putting it in the URL, because an action
 * that redirects has no other channel back to the page it came from. Every page
 * that uses this reads `searchParams.error` and renders it.
 */
export function errorQuery(path: string, message: string): string {
  return `${path}?error=${encodeURIComponent(message)}`;
}

/**
 * The same channel for something that went right.
 *
 * An action that redirects can only speak through the URL, and a redirect was
 * the only way to say anything at all — so good news was going out as
 * `?error=`, rendered in the red banner. "Reconnected successfully" in the
 * colour reserved for failure teaches people to distrust both.
 */
export function noticeQuery(path: string, message: string): string {
  return `${path}?notice=${encodeURIComponent(message)}`;
}
