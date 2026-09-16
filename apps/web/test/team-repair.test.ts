import { describe, expect, it } from "vitest";
import { cannotSend, describeRepair } from "../src/app/app/team/repair";

/**
 * What asking the provider told us, said on the screen.
 *
 * The first version of the automatic repair called the worker and threw the
 * answer away. It asked, was told "there are accounts here but none of them is
 * yours", and rendered an unchanged page — so a rep looking at "reauth
 * required" saw exactly what they had seen before pressing anything. Repairing
 * silently and failing silently are indistinguishable from the outside, which
 * is the defect this product keeps finding in itself.
 */
describe("describeRepair", () => {
  it("says nothing when there is nothing to say", () => {
    expect(describeRepair({ ok: true, data: { found: 1, mine: 1, bound: 0, changed: false } })).toBeNull();
  });

  it("reports a repaired account", () => {
    const notice = describeRepair({ ok: true, data: { changed: true } });

    expect(notice?.tone).toBe("accent");
    expect(notice?.title).toMatch(/reconnected/i);
  });

  it("names an account the provider holds but has not labelled as this rep's", () => {
    // The real case: connected from inside the provider's dashboard, so it is
    // healthy on their side and belongs to nobody on ours.
    const notice = describeRepair({ ok: true, data: { found: 2, mine: 0 } });

    expect(notice?.tone).toBe("danger");
    expect(notice?.title).toMatch(/2 accounts/);
    expect(notice?.title).toMatch(/none of them is labelled as yours/i);
    // And a way out, not just a diagnosis.
    expect(notice?.fix).toMatch(/connect linkedin/i);
  });

  it("says how the provider's accounts are labelled, which is the whole diagnosis", () => {
    // "a uuid that does not match" and "a person's name" are different
    // problems. A name means the account was created in the provider's own
    // dashboard and carries no reference to anybody here, which is the case
    // that kept a real deployment stuck for two days.
    const notice = describeRepair({
      ok: true,
      data: { found: 1, mine: 0, referenceShape: ["text with spaces"] },
    });

    expect(notice?.body).toMatch(/labelled: text with spaces/);
  });

  it("does not offer to attach an unlabelled account", () => {
    // An account labelled with nobody could belong to anybody. Attaching it to
    // whoever asks is how one company's campaign goes out from another
    // company's LinkedIn, so the page explains rather than offering a button.
    const notice = describeRepair({ ok: true, data: { found: 1, mine: 0 } });

    expect(notice?.body).toMatch(/could belong to anybody/i);
  });

  it("distinguishes a provider with nothing from a provider it could not reach", () => {
    const nothing = describeRepair({ ok: true, data: { found: 0, mine: 0 } });
    const unreachable = describeRepair({ ok: false, error: "The background service is not responding." });

    expect(nothing?.title).toMatch(/has no account for you/i);
    expect(unreachable?.title).toMatch(/could not check/i);
    // Two different things to do about them, so never the same sentence.
    expect(nothing?.title).not.toBe(unreachable?.title);
  });
});

/**
 * Whether the Team page offers a way back in.
 *
 * It did not. A `reauth_required` account rendered the connected card — usage
 * bars, Sales Navigator, working hours — because the page only cleared its
 * connected state for `connecting`. The banner across the app said "Reconnect"
 * and linked to a page with nothing on it to press, which is the worst kind of
 * defect this product has: it points somebody at a dead end at the exact
 * moment they are trying to act.
 */
describe("cannotSend", () => {
  it("is false for a working account", () => {
    expect(cannotSend("active")).toBe(false);
  });

  it("is true for an account that needs signing in again", () => {
    // The state the deployment actually sat in, with no control on the page.
    expect(cannotSend("reauth_required")).toBe(true);
    expect(cannotSend("disconnected")).toBe(true);
  });

  it("is true while a connection is half-finished", () => {
    expect(cannotSend("connecting")).toBe(true);
  });

  it("is false when LinkedIn has paused a properly connected account", () => {
    // Signing in again does not lift a LinkedIn restriction. Offering it costs
    // the rep a sign-in and changes nothing, and it hides the real reason.
    expect(cannotSend("warning")).toBe(false);
    expect(cannotSend("restricted")).toBe(false);
  });

  it("says nothing about a rep who has never connected at all", () => {
    // No row is a different screen entirely, not a broken account.
    expect(cannotSend(null)).toBe(false);
    expect(cannotSend(undefined)).toBe(false);
  });
});
