import { describe, expect, it } from "vitest";
import { mayPublish, POST_MAX_CHARS } from "../src/posts.js";

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
});
