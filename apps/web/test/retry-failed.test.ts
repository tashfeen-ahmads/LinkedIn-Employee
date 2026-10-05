import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { restoreFromFailure } from "../src/lib/retry-failed.js";

/**
 * Retry failed puts each person back where they failed from.
 *
 * It used to put everybody back in the invitation queue. A follow-up that
 * failed belongs to somebody who already accepted, and requeued for an
 * invitation they were closed as "already contacted" by the never-twice check
 * — the one person on the campaign who said yes, written off by the button
 * meant to rescue them.
 */

const NOW = new Date("2026-10-07T13:00:00Z");

describe("restoreFromFailure", () => {
  it("puts a never-invited prospect back in the queue", () => {
    expect(restoreFromFailure({ invited_at: null, accepted_at: null, last_step_sent: 0 }, NOW)).toEqual({
      status: "queued",
      next_action_at: null,
    });
  });

  it("returns somebody who accepted to accepted, with the first message due now", () => {
    expect(
      restoreFromFailure({ invited_at: "2026-10-01T10:00:00Z", accepted_at: "2026-10-02T10:00:00Z", last_step_sent: 0 }, NOW),
    ).toEqual({ status: "accepted", next_action_at: NOW.toISOString() });
  });

  it("returns somebody mid-sequence to the step they had reached", () => {
    expect(
      restoreFromFailure({ invited_at: "2026-10-01T10:00:00Z", accepted_at: "2026-10-02T10:00:00Z", last_step_sent: 2 }, NOW),
    ).toEqual({ status: "messaged_2", next_action_at: NOW.toISOString() });
  });

  it("leaves somebody invited and not yet accepted waiting for acceptance", () => {
    expect(restoreFromFailure({ invited_at: "2026-10-01T10:00:00Z", accepted_at: null, last_step_sent: 0 }, NOW)).toEqual({
      status: "invited",
      next_action_at: null,
    });
  });

  it("is what the Retry failed action actually uses", () => {
    // Rule 39's lesson: the bug lived in the call site. A correct helper that
    // the button never calls fixes nothing.
    const page = readFileSync(join(__dirname, "../src/app/app/campaigns/[id]/page.tsx"), "utf8");
    const action = page.slice(page.indexOf("async function retryFailed"), page.indexOf("async function", page.indexOf("async function retryFailed") + 10));
    expect(action).toContain("restoreFromFailure(");
    expect(action).not.toMatch(/update\(\{ status: "queued"/);
  });
});
