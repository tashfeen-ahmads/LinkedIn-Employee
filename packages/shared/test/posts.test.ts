import { describe, expect, it } from "vitest";
import { POST_MAX_CHARS } from "../src/constants.js";
import { mayPublish } from "../src/posts.js";

/**
 * The gate between a draft and a real person's public profile.
 *
 * A post is not a message. It goes to everyone who follows the rep, it stays
 * on their profile, and it is what a prospect reads when they look the sender
 * up. The reply gate can be turned to autopilot because an unanswered pricing
 * question costs a lead; nothing is lost by a post waiting for Monday, and
 * everything is lost by one going out unread.
 */
const now = new Date("2026-10-05T12:00:00Z");
const approved = {
  body: "A short, real post.",
  status: "approved",
  approved_at: "2026-10-04T09:00:00Z",
  scheduled_for: null,
  published_at: null,
};

describe("mayPublish", () => {
  it("lets an approved, due post through", () => {
    expect(mayPublish(approved, now)).toEqual({ send: true });
  });

  it("refuses anything nobody approved", () => {
    for (const status of ["draft", "approved"]) {
      // Both halves: the status alone is not the approval, and neither is the
      // timestamp alone. One without the other is a row half-written by a
      // failed update, and it must not publish.
      expect(mayPublish({ ...approved, status, approved_at: null }, now).send).toBe(false);
    }
    expect(mayPublish({ ...approved, status: "draft" }, now).send).toBe(false);
  });

  it("never publishes the same post twice", () => {
    /*
     * LinkedIn has no idempotency key here, so a second attempt is a second
     * post on a real profile minutes after the first.
     */
    expect(mayPublish({ ...approved, published_at: "2026-10-04T10:00:00Z" }, now).send).toBe(false);
    expect(mayPublish({ ...approved, status: "published" }, now).send).toBe(false);
  });

  it("holds a scheduled post, and says it is waiting rather than broken", () => {
    const later = mayPublish({ ...approved, scheduled_for: "2026-10-06T09:00:00Z" }, now);
    expect(later.send).toBe(false);
    // The distinction the sweep depends on: retry a post that is merely early,
    // never retry one that will never become sendable.
    expect(later.send === false && later.retry).toBe(true);
  });

  it("publishes once the scheduled time has passed", () => {
    expect(mayPublish({ ...approved, scheduled_for: "2026-10-05T11:00:00Z" }, now).send).toBe(true);
  });

  it("refuses an empty body, which the approval trigger does not catch", () => {
    // Editing clears approval, but nothing stops somebody approving a blank.
    for (const body of ["", "   ", "\n\n"]) {
      expect(mayPublish({ ...approved, body }, now).send).toBe(false);
    }
  });

  it("drops an over-length post rather than truncating it", () => {
    const tooLong = { ...approved, body: "x".repeat(POST_MAX_CHARS + 1) };
    const verdict = mayPublish(tooLong, now);
    expect(verdict.send).toBe(false);
    // Never retried: it will be exactly as long next time.
    expect(verdict.send === false && verdict.retry).toBe(false);
    expect(mayPublish({ ...approved, body: "x".repeat(POST_MAX_CHARS) }, now).send).toBe(true);
  });

  it("does not retry a post that has already failed", () => {
    const verdict = mayPublish({ ...approved, status: "failed" }, now);
    expect(verdict.send).toBe(false);
    expect(verdict.send === false && verdict.retry).toBe(false);
  });

  /*
   * When a post lands is part of whether it worked.
   *
   * `now` is 12:00 UTC on Monday 5 October 2026: 13:00 in London, 05:00 in
   * Los Angeles. The second is the case this gate exists for — a post appearing
   * on a real professional's profile at five in the morning their time reads as
   * a machine posting for them, on the one account this product exists to
   * protect.
   */
  describe("posting hours", () => {
    const hours = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };

    it("holds an unscheduled post until the rep's day has started", () => {
      const verdict = mayPublish(approved, now, { hours, timezone: "America/Los_Angeles" });
      expect(verdict.send).toBe(false);
      // Retryable, and the most ordinary hold there is. Written off as a
      // failure, a post approved in the evening would never go out.
      expect(verdict.send === false && verdict.retry).toBe(true);
    });

    it("sends inside the window", () => {
      // 13:00 in London, inside a nine-to-five.
      expect(mayPublish(approved, now, { hours, timezone: "Europe/London" })).toEqual({ send: true });
    });

    it("holds on a day the rep does not work", () => {
      const saturday = new Date("2026-10-10T12:00:00Z");
      expect(mayPublish(approved, saturday, { hours, timezone: "Europe/London" }).send).toBe(false);
    });

    it("sends a post whose time the rep chose, whatever hour that is", () => {
      /*
       * The asymmetry is the point. "Publish it when you can" means inside
       * working hours; "publish it at this time" is an instruction, and a
       * window that overrode it would be a scheduler that ignores its schedule
       * — somebody deliberately timing a post for 6am would find it never went.
       */
      const outside = { ...approved, scheduled_for: "2026-10-05T11:00:00Z" };
      expect(mayPublish(outside, now, { hours, timezone: "America/Los_Angeles" })).toEqual({
        send: true,
      });
    });

    it("still refuses an unapproved post inside the window", () => {
      // The window decides *when*, never *whether*. A gate that let approval
      // through because the hour was right would be the whole table pointless.
      expect(
        mayPublish({ ...approved, approved_at: null, status: "draft" }, now, {
          hours,
          timezone: "Europe/London",
        }).send,
      ).toBe(false);
    });

    it("sends whenever no window is given", () => {
      // The row-only verdict, which is what the sweep asks for before it has
      // read an account. It must not hold a post for a window it was not told.
      expect(mayPublish(approved, now)).toEqual({ send: true });
    });
  });
});
