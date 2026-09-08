import "server-only";

/**
 * Calls into the worker's internal API. Every one of these endpoints acts on a
 * named workspace, so the call is authenticated with a shared secret and the
 * workspace always comes from the caller's session — never from a form field.
 */
export async function callWorker<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const base = process.env.WORKER_URL ?? "http://localhost:4000";
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error("INTERNAL_API_SECRET is not set; refusing to call the worker");
    return null;
  }

  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`worker ${path} responded ${response.status}`);
      return null;
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch (error) {
    console.error(`worker ${path} failed`, error);
    return null;
  }
}
