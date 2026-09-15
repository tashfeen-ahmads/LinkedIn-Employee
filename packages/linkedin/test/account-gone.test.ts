import { describe, expect, it } from "vitest";
import { UnipileError, isAccountGone } from "../src/unipile.js";

/**
 * Telling apart the one provider failure a rep can fix themselves.
 *
 * A connected account the provider has dropped and a provider having a bad
 * afternoon both arrive here as a thrown error, and they need opposite things
 * done about them. The first should stop the account claiming to be connected,
 * so the Team page offers Connect and means it. The second should not: making
 * someone re-do a hosted LinkedIn login because an upstream returned 503 is a
 * worse outcome than waiting, and it resets nothing that was broken.
 */
describe("isAccountGone", () => {
  it("recognises the provider saying it has no such account", () => {
    const err = new UnipileError(
      "Unipile POST /api/v1/linkedin/search failed with 404: Account not found",
      404,
      JSON.stringify({ title: "Resource not found.", detail: "The requested resource were not found. Account not found", type: "errors/resource_not_found" }),
    );

    expect(isAccountGone(err)).toBe(true);
  });

  it("does not read every 404 as a missing account", () => {
    // This API answers a route it does not have with a 404 too, and that is a
    // deployment problem — disconnecting the rep's LinkedIn over it would be
    // an unrelated account taken away for an unrelated reason.
    const err = new UnipileError("failed with 404", 404, JSON.stringify({ title: "Resource not found." }));

    expect(isAccountGone(err)).toBe(false);
  });

  it("does not read an outage as a missing account", () => {
    expect(isAccountGone(new UnipileError("failed with 503", 503, "upstream unavailable"))).toBe(false);
    expect(isAccountGone(new UnipileError("failed with 401", 401, "Account not found"))).toBe(false);
  });

  it("says no to anything that is not this provider's error at all", () => {
    expect(isAccountGone(new Error("Account not found"))).toBe(false);
    expect(isAccountGone(null)).toBe(false);
    expect(isAccountGone("404 Account not found")).toBe(false);
  });
});
