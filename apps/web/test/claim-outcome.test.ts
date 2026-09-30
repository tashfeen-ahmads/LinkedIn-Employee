import { describe, expect, it } from "vitest";
import { describeClaim } from "../src/app/app/profile/claim";

/**
 * What the page says after the hosted LinkedIn flow sends the rep back.
 *
 * The page called the worker's claim route, threw the answer away, and
 * redirected with the green "LinkedIn is connected." every time. So the three
 * outcomes below — bound, refused, unreachable — rendered one identical,
 * reassuring sentence, and a rep whose account was still `connecting` was told
 * it was connected and then found "reauth required" on the next screen they
 * opened.
 *
 * That is the report this cost three days: not a connection that failed, but a
 * connection that failed and said it had worked. Repairing silently and
 * failing silently are indistinguishable from the outside; so are succeeding
 * and failing, once the only thing on screen is the success message.
 */
describe("describeClaim", () => {
  it("reports a connection that was actually made", () => {
    const said = describeClaim({ ok: true, data: { claimed: true } });
    expect(said.tone).toBe("notice");
    expect(said.message).toMatch(/connected/i);
  });

  it("does not call a refusal a connection", () => {
    const said = describeClaim({
      ok: true,
      data: { claimed: false, reason: "no connection was started here" },
    });
    expect(said.tone).toBe("error");
    expect(said.message).toMatch(/not connected/i);
    // The worker's own reason survives: it names which check declined, and
    // rewriting it here would be a second reading of one fault.
    expect(said.message).toMatch(/no connection was started here/);
  });

  it("does not call an unreachable worker a connection", () => {
    const said = describeClaim({ ok: false, error: "the background service could not be reached" });
    expect(said.tone).toBe("error");
    expect(said.message).toMatch(/not connected/i);
    expect(said.message).toMatch(/could not be reached/);
  });

  it("still says something when the worker answered with nothing useful", () => {
    // `claimed` absent is the shape a route change could produce, and it must
    // fall to "not connected" rather than to the optimistic branch.
    for (const data of [null, undefined, {}, { claimed: undefined }]) {
      const said = describeClaim({ ok: true, data: data as never });
      expect(said.tone, JSON.stringify(data)).toBe("error");
      expect(said.message).toBeTruthy();
    }
  });

  it("names no vendor and no environment variable, whatever the worker sent", () => {
    /*
     * The message is passed through, so this side has to hold the line too
     * (rule 54). The worker's customer-facing sentence is already written for
     * the rep — but if a future change hands back a raw provider error, the
     * banner on `/app/profile` is where it would appear.
     */
    const said = describeClaim({ ok: false, error: "we could not reach LinkedIn just now" });
    expect(said.message.toLowerCase()).not.toContain("unipile");
    expect(said.message).not.toMatch(/[A-Z][A-Z0-9]{3,}_[A-Z0-9_]+/);
  });
});
