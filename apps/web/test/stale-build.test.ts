import { describe, expect, it } from "vitest";
import { isStaleBuild, mayReloadAgain, STALE_RELOAD_WINDOW_MS } from "../src/lib/stale-build";

/**
 * A page opened before a deploy and submitted after it.
 *
 * A new customer pressed "Build my profiles" and got Next.js's bare
 * "Application error: a client-side exception" — the request never reached the
 * server, because the page was asking for a server action the new build no
 * longer had. Reloading cures it; this decides when to.
 */
describe("isStaleBuild", () => {
  it("recognises a server action from an older build", () => {
    expect(
      isStaleBuild(
        new Error(
          'Failed to find Server Action "7f3a". This request might be from an older or newer deployment.',
        ),
      ),
    ).toBe(true);
  });

  it("recognises a script chunk that no longer exists", () => {
    const err = new Error("Loading chunk 482 failed.");
    err.name = "ChunkLoadError";
    expect(isStaleBuild(err)).toBe(true);
  });

  it("does not reload over an ordinary error", () => {
    expect(isStaleBuild(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isStaleBuild(undefined)).toBe(false);
  });
});

describe("mayReloadAgain", () => {
  it("reloads once and not in a loop", () => {
    const now = 1_000_000;
    expect(mayReloadAgain(null, now)).toBe(true);
    expect(mayReloadAgain(String(now - 5_000), now)).toBe(false);
    expect(mayReloadAgain(String(now - STALE_RELOAD_WINDOW_MS - 1), now)).toBe(true);
  });
});
