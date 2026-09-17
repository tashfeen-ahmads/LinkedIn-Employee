import { describe, expect, it } from "vitest";
import { describePacing } from "../src/lib/pacing";
import type { AccountRecord } from "@le/linkedin";

/**
 * What a launched campaign says about itself.
 *
 * Every state below used to render the same page: status "running", nobody
 * invited, nothing changed. A worker that is not running, working hours that
 * ended an hour ago, and a campaign correctly waiting out the gap between two
 * invitations were one screen with one meaning — "it did not work" — and the
 * first live launch was spent on the difference.
 */

const NOW = new Date("2026-09-17T16:30:00Z"); // A Thursday.

function account(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: "a1",
    workspace_id: "w1",
    user_id: "u1",
    provider_account_id: "acct",
    status: "active",
    connected_at: "2026-09-01T09:00:00Z",
    first_action_at: null,
    invites_today: 0,
    invites_this_week: 0,
    messages_today: 0,
    counters_reset_on: "2026-09-17",
    last_action_at: null,
    working_hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
    ...overrides,
  };
}

const live = {
  status: "running",
  queued: 5,
  account: account(),
  timezone: "UTC",
  lastBeatAt: "2026-09-17T16:28:00Z",
  now: NOW,
};

describe("describePacing", () => {
  it("says a campaign is sending, and how slowly", () => {
    const state = describePacing(live);
    expect(state?.tone).toBe("accent");
    // The number whose absence makes a working campaign look broken: somebody
    // opens LinkedIn a minute after Launch, finds nothing, and concludes the
    // product does not work.
    expect(state?.body).toMatch(/minutes apart/);
    expect(state?.title).toContain("5 people");
  });

  it("says when the loop that sends the messages is not running", () => {
    const state = describePacing({ ...live, lastBeatAt: "2026-09-17T15:00:00Z" });
    expect(state?.tone).toBe("danger");
    // Named as a deployment problem, because nothing the rep does to the
    // campaign will fix it and everything they try will look like it failed.
    expect(state?.body).toMatch(/deployment/);
  });

  it("treats a loop that has never reported in as not running", () => {
    expect(describePacing({ ...live, lastBeatAt: null })?.tone).toBe("danger");
  });

  it("puts a dead loop ahead of every other explanation", () => {
    // Outside working hours AND no heartbeat. "Waiting for your sending hours"
    // is a reassuring sentence about a system that will never send.
    const state = describePacing({
      ...live,
      lastBeatAt: null,
      now: new Date("2026-09-17T23:00:00Z"),
    });
    expect(state?.title).toMatch(/not running/);
  });

  it("names the working hours when the clock is outside them", () => {
    const state = describePacing({ ...live, now: new Date("2026-09-17T19:30:00Z"), lastBeatAt: "2026-09-17T19:28:00Z" });
    expect(state?.title).toMatch(/sending hours/);
    expect(state?.body).toContain("08:00");
    expect(state?.body).toContain("18:00");
    expect(state?.tone).not.toBe("danger");
  });

  it("evaluates those hours in the rep's zone, not the server's", () => {
    // 16:30 UTC is 21:30 in Karachi: inside the working day for one rep and
    // hours past it for another, from the same row.
    const state = describePacing({ ...live, timezone: "Asia/Karachi" });
    expect(state?.title).toMatch(/sending hours/);
  });

  it("says the allowance is spent rather than that something failed", () => {
    const state = describePacing({ ...live, account: account({ invites_today: 10 }) });
    expect(state?.title).toMatch(/allowance/);
    expect(state?.body).toMatch(/not raisable/);
  });

  it("counts down the gap between two invitations", () => {
    const state = describePacing({
      ...live,
      account: account({ last_action_at: "2026-09-17T16:29:00Z" }),
    });
    // Still sending — this is the limiter pacing itself, not a stoppage.
    expect(state?.tone).toBe("accent");
    expect(state?.body).toMatch(/next invitation/i);
  });

  it("sends nobody from an account that is not connected", () => {
    const state = describePacing({ ...live, account: account({ status: "reauth_required" }) });
    expect(state?.tone).toBe("danger");
    expect(state?.body).toMatch(/Team page/);
  });

  it("says nothing at all about a campaign nobody has launched", () => {
    // A draft is not sending because nobody asked it to, and a banner
    // explaining the rate limiter on a draft is noise over the review.
    expect(describePacing({ ...live, status: "draft" })).toBeNull();
  });

  it("does not claim to be sending when there is nobody left to invite", () => {
    const state = describePacing({ ...live, queued: 0 });
    expect(state?.title).toMatch(/has been invited/);
  });
});
