/**
 * Whether an error in the browser means "this page belongs to an older build".
 *
 * A page holds the ids of the server actions and script chunks of the build
 * that served it. Every deploy replaces both, so a form opened before a deploy
 * and submitted after it asks the server for an action that no longer exists —
 * and with no error boundary Next.js shows "Application error: a client-side
 * exception has occurred" and nothing else. That is how a new customer's first
 * press of "Build my profiles" ended: the onboarding form is long enough that a
 * deploy can land while somebody fills it in, and the request never reached
 * the server at all.
 *
 * Reloading is the whole cure — the new page carries the new ids — so this is
 * what decides whether to do that rather than show an error.
 */
export function isStaleBuild(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.name} ${error.message}` : typeof error === "string" ? error : "";
  return /Server Action|older or newer deployment|ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(
    text,
  );
}

/** Reloaded this recently already: a second reload would loop rather than help. */
export const STALE_RELOAD_KEY = "nora:stale-build-reload";
export const STALE_RELOAD_WINDOW_MS = 60_000;

export function mayReloadAgain(lastReloadAt: string | null, now: number): boolean {
  const last = Number(lastReloadAt);
  return !Number.isFinite(last) || last <= 0 || now - last > STALE_RELOAD_WINDOW_MS;
}
