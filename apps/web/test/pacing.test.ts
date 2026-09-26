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

  it("quotes the day's pace, not the two-minute floor", () => {
    /*
     * Rule 21, one layer down. The loop spreads a day's allowance across the
     * working day; `checkAction` knows only the gap between two actions. Read
     * off the limiter alone this screen promised the next invitation in three
     * minutes while the loop had placed it three quarters of an hour out — and
     * the screen's number is the one somebody believes, so what they conclude
     * forty minutes later is that the product does not work.
     */
    const state = describePacing({
      ...live,
      // Ten in the morning, a day to six: eight hours for ten invitations.
      now: new Date("2026-09-17T10:00:00Z"),
      queued: 10,
      dailyCap: 10,
      lastBeatAt: "2026-09-17T09:58:00Z",
      account: account({ first_action_at: "2026-07-01T09:00:00Z" }),
    });

    expect(state?.body).toMatch(/about \d+ minutes apart/);
    expect(state?.body).toContain("spread across the rest of your sending hours");
    // Tens of minutes, not the old two-to-nine.
    const quoted = Number(/about (\d+) minutes apart/.exec(state?.body ?? "")?.[1]);
    expect(quoted).toBeGreaterThan(20);
  });

  it("paces a nearly-finished campaign by what is left on it", () => {
    // Two people left is not a tenth of the day each. A pace computed from the
    // allowance rather than the list would quote a wait nobody will sit
    // through, which is the same lie in the other direction.
    const wide = describePacing({
      ...live,
      now: new Date("2026-09-17T10:00:00Z"),
      queued: 2,
      dailyCap: 10,
      lastBeatAt: "2026-09-17T09:58:00Z",
      account: account({ first_action_at: "2026-07-01T09:00:00Z" }),
    });
    const narrow = describePacing({
      ...live,
      now: new Date("2026-09-17T10:00:00Z"),
      queued: 10,
      dailyCap: 10,
      lastBeatAt: "2026-09-17T09:58:00Z",
      account: account({ first_action_at: "2026-07-01T09:00:00Z" }),
    });
    const read = (body: string | undefined) =>
      Number(/about (\d+) minutes apart/.exec(body ?? "")?.[1]);
    expect(read(wide?.body)).toBeGreaterThan(read(narrow?.body));
  });

  it("falls back to the old sentence once the sending hours are over", () => {
    // No window to spread across, so there is no pace to quote — and inventing
    // one from a day that has ended is a number about nothing.
    const state = describePacing({
      ...live,
      // Half past six, a day ending at six.
      now: new Date("2026-09-17T18:30:00Z"),
      lastBeatAt: "2026-09-17T18:28:00Z",
    });
    // The limiter takes this one: it is outside working hours, which is its own
    // sentence and the right one.
    expect(state?.title).toContain("Waiting for your sending hours");
  });

  it("says when LinkedIn itself is holding the account", () => {
    /*
     * The limiter only knows the caps this product chose, so it is perfectly
     * happy while LinkedIn refuses every invitation. This screen said
     * "Sending. The next invitation goes out in about four minutes" — false
     * four minutes later and for the next two hours. A reassuring sentence
     * about a system that will not send is the thing rule 21 exists to stop.
     */
    const state = describePacing({
      ...live,
      account: account({
        invites_paused_until: "2026-09-17T18:30:00Z",
        invites_paused_reason: "LinkedIn is temporarily refusing invitations from this account",
      }),
    });
    expect(state?.title).toContain("LinkedIn is holding");
    expect(state?.body).toContain("refusing invitations");
    // Said as a wait, not a loss: everybody queued stays queued.
    expect(state?.body).toMatch(/resumes on its own/);
    expect(state?.body).not.toMatch(/minutes apart/);
  });

  it("goes back to the ordinary rules once the hold has expired", () => {
    // A stale timestamp is not a hold. Reading it as one would silence a
    // healthy campaign for ever.
    const state = describePacing({
      ...live,
      account: account({
        invites_paused_until: "2026-09-17T15:00:00Z",
        invites_paused_reason: "LinkedIn is temporarily refusing invitations from this account",
      }),
    });
    expect(state?.tone).toBe("accent");
    expect(state?.body).toMatch(/minutes apart/);
  });

  it("reports a dead loop ahead of a provider hold", () => {
    // Rule 21: a dead loop is reported ahead of every gentler explanation.
    // "LinkedIn is holding this account" is a sentence about a system that
    // would otherwise be sending, and this one would not be.
    const state = describePacing({
      ...live,
      lastBeatAt: "2026-09-17T15:00:00Z",
      account: account({
        invites_paused_until: "2026-09-17T18:30:00Z",
        invites_paused_reason: "LinkedIn is temporarily refusing invitations from this account",
      }),
    });
    expect(state?.tone).toBe("danger");
    expect(state?.title).not.toContain("LinkedIn is holding");
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

  /**
   * "Nothing is being sent" is true in three quite different situations, and
   * each needs a different person to do a different thing. The pacing stamp
   * cannot tell them apart: it is written by a loop that needs the queue in
   * order to run, so a dead queue and a dead process erase it identically.
   */
  it("says the queue is unreachable rather than blaming the worker", () => {
    const state = describePacing({
      ...live,
      lastBeatAt: null,
      boot: {
        beat_at: "2026-09-17T16:20:00Z",
        detail: { queueReachable: false, redisHost: "red-abc:6379", commit: "abc1234" },
      },
    });

    expect(state?.tone).toBe("danger");
    expect(state?.title).toMatch(/cannot reach its job queue/);
    // The address, so somebody can check the one they configured against the
    // one it actually tried.
    expect(state?.body).toContain("red-abc:6379");
  });

  it("does not blame the queue when the worker reached it and still never ran", () => {
    const state = describePacing({
      ...live,
      lastBeatAt: null,
      boot: { beat_at: "2026-09-17T16:20:00Z", detail: { queueReachable: true, commit: "abc1234def" } },
    });

    expect(state?.title).toMatch(/sending loop has not run/);
    // Which build is actually running, from the process rather than from a
    // dashboard reporting on it — those disagreed for most of an afternoon.
    expect(state?.body).toContain("abc1234");
    // Not the queue's fault, and it must not be reported as one: sending
    // somebody to check REDIS_URL when the queue answered is a wasted hour
    // and it is the hour this whole mechanism exists to stop.
    expect(state?.body).not.toMatch(/cannot reach|unreachable/i);
    expect(state?.body).toMatch(/logs/);
  });

  it("does not claim the process is down when it has simply never said", () => {
    // No boot stamp is also what a deployment looks like before the build
    // carrying the stamp has shipped, and sending somebody to restart a
    // healthy worker is its own wasted hour.
    const state = describePacing({ ...live, lastBeatAt: null, boot: null });
    expect(state?.body).toMatch(/has not deployed yet/);
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
