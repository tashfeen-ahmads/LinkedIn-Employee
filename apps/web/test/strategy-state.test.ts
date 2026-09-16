import { describe, expect, it } from "vitest";
import { hasToldUsWhatTheySell, minutesSince, readStrategyState } from "../src/lib/strategy-state";
import type { Db } from "@le/db";

/**
 * The twenty-one minutes nobody could see.
 *
 * Onboarding's only output is written by an agent, several minutes after the
 * form is submitted. Reading the absence of that row as "this person has not
 * told us what they sell" showed a real tester a checklist asking for what they
 * had just given, with a button that would have queued the whole thing again —
 * and would have shown a failed run exactly the same thing, permanently.
 */
function dbReturning(row: unknown): Db {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: row }),
  };
  return { from: () => chain } as unknown as Db;
}

const WORKSPACE = "11111111-1111-4111-8111-111111111111";

describe("readStrategyState", () => {
  it("is ready as soon as the profile exists, whatever the events say", async () => {
    // The strongest evidence there is, and it survives a pruned events table.
    const state = await readStrategyState(dbReturning({ name: "strategy.failed", payload: {}, created_at: "x" }), WORKSPACE, true);

    expect(state.phase).toBe("ready");
  });

  it("is running while the agent has been asked but has not answered", async () => {
    const at = new Date().toISOString();
    const state = await readStrategyState(
      dbReturning({ name: "strategy.queued", payload: {}, created_at: at }),
      WORKSPACE,
      false,
    );

    // This is the state that used to render as "you have not done onboarding".
    expect(state).toEqual({ phase: "running", since: at });
  });

  it("carries the reason a run failed, so it is not silently a run still going", async () => {
    const state = await readStrategyState(
      dbReturning({ name: "strategy.failed", payload: { reason: "could not fetch the site" }, created_at: "2026-09-16T03:00:00Z" }),
      WORKSPACE,
      false,
    );

    expect(state).toMatchObject({ phase: "failed", reason: "could not fetch the site" });
  });

  it("never reports a failure with no reason at all", async () => {
    const state = await readStrategyState(
      dbReturning({ name: "strategy.failed", payload: {}, created_at: "2026-09-16T03:00:00Z" }),
      WORKSPACE,
      false,
    );

    expect(state.phase).toBe("failed");
    expect(state.phase === "failed" && state.reason).toBeTruthy();
  });

  it("is absent when nobody has ever asked", async () => {
    // The one case where "you have not told us what you sell" is true.
    expect((await readStrategyState(dbReturning(null), WORKSPACE, false)).phase).toBe("absent");
  });
});

describe("minutesSince", () => {
  it("counts whole minutes and never goes backwards", () => {
    const now = Date.parse("2026-09-16T12:00:00Z");
    expect(minutesSince("2026-09-16T11:49:00Z", now)).toBe(11);
    expect(minutesSince("2026-09-16T11:59:59Z", now)).toBe(0);
    // A clock that disagrees with the server's must not print "-3 minutes ago".
    expect(minutesSince("2026-09-16T12:05:00Z", now)).toBe(0);
  });
});

describe("hasToldUsWhatTheySell", () => {
  it("is true the moment the form is submitted, not when the agent finishes", () => {
    // The bug, stated as a test: the person's part and the agent's part are
    // different pieces of work, and only one of them is theirs to do.
    expect(hasToldUsWhatTheySell({ phase: "running", since: new Date().toISOString() })).toBe(true);
  });

  it("stays true when the run failed, because they still told us", () => {
    // They need the banner and a retry, not a checklist row implying they left
    // a form blank.
    expect(hasToldUsWhatTheySell({ phase: "failed", reason: "boom", at: "2026-09-16T03:00:00Z" })).toBe(true);
  });

  it("is false only when nobody ever asked the agent anything", () => {
    expect(hasToldUsWhatTheySell({ phase: "absent" })).toBe(false);
  });

  it("is true once the profile exists", () => {
    expect(hasToldUsWhatTheySell({ phase: "ready" })).toBe(true);
  });
});
