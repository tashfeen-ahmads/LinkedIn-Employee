import { describe, expect, it } from "vitest";
import { MockLinkedInProvider, UnipileError } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { runDiagnostics } from "../src/jobs/diagnostics.js";
import type { WorkerContext } from "../src/context.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

/**
 * The screen that exists so nobody has to reason backwards from silence again.
 *
 * Its whole value is that a stage it cannot verify says so. A check that
 * reports "working" because it could not look is worse than no check: it sends
 * someone off to investigate a stage that was fine, and it is exactly the shape
 * of the bug it was built to catch — a row saying `active` for an account the
 * provider had never heard of.
 */
function harness(options: { account?: Record<string, unknown> | null; env?: Record<string, unknown> } = {}) {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();

  if (options.account !== null) {
    db.seed("linkedin_accounts", [
      {
        id: "acct-row",
        workspace_id: WORKSPACE,
        user_id: USER,
        provider_account_id: "acct_live",
        status: "active",
        ...options.account,
      },
    ]);
  }

  const ctx = {
    db: db.asDb(),
    linkedin,
    email: null,
    env: {
      APP_URL: "http://app.test",
      OPENAI_API_KEY: "key",
      LINKEDIN_PROVIDER: "unipile",
      UNIPILE_WEBHOOK_SECRET: "secret",
      ...options.env,
    } as unknown as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  return { db, ctx, linkedin };
}

const run = (ctx: WorkerContext) => runDiagnostics(ctx, { workspaceId: WORKSPACE, userId: USER });
const check = (report: { checks: Array<{ key: string }> }, key: string) =>
  report.checks.find((c) => c.key === key)!;

describe("system check", () => {
  it("reports the account as blocked when the provider has never heard of it", async () => {
    // The week-long bug, as one row on a screen. The stored row says active;
    // only asking the provider tells the truth.
    const { ctx, linkedin } = harness();
    linkedin.healthError = new UnipileError("failed with 404: Account not found", 404, "Account not found");

    const report = await run(ctx);

    expect(check(report, "account-row").state).toBe("ok");
    expect(check(report, "account-live").state).toBe("blocked");
    expect(check(report, "account-live").detail).toMatch(/no such account/i);
    expect(check(report, "account-live").href).toBe("/app/team");
  });

  it("does not claim the search works when it never ran it", async () => {
    // "Waiting", not "ok". A check that passes because it skipped itself sends
    // someone to look at the wrong stage.
    const { ctx, linkedin } = harness();
    linkedin.healthError = new UnipileError("failed with 404: Account not found", 404, "Account not found");

    const report = await run(ctx);

    expect(check(report, "search").state).toBe("waiting");
    expect(check(report, "search").detail).toMatch(/not attempted/i);
  });

  it("carries the provider's own sentence when a search is refused", async () => {
    const { ctx, linkedin } = harness();
    linkedin.searchError = new Error("402 subscription required");

    const report = await run(ctx);

    expect(check(report, "search").state).toBe("blocked");
    expect(check(report, "search").detail).toContain("402");
  });

  it("names a missing webhook secret as blocking replies, not as a detail", async () => {
    // Fails closed, so every reply from every prospect is rejected. Silent
    // until now: the product simply appeared to get no replies.
    const { ctx } = harness({ env: { UNIPILE_WEBHOOK_SECRET: undefined } });

    const report = await run(ctx);

    expect(check(report, "webhook-secret").state).toBe("blocked");
    expect(check(report, "webhook-secret").detail).toMatch(/never sees it/i);
  });

  /**
   * Every other check on this screen can be green and not one message will
   * leave the building if the loop that sends them is not running. It is the
   * one failure that makes the rest of the report meaningless, and it was
   * missing for the whole of the first live launch.
   */
  it("reports the sending loop as blocked when it has never reported in", async () => {
    const { ctx } = harness();

    const report = await run(ctx);

    expect(check(report, "pacing-loop").state).toBe("blocked");
    expect(check(report, "pacing-loop").detail).toMatch(/never reported in/);
  });

  it("reports the sending loop as blocked when it stopped running", async () => {
    // Not "ok because it ran once". A loop that ran an hour ago and should run
    // every five minutes is a loop that is not running.
    const { db, ctx } = harness();
    db.seed("worker_heartbeats", [
      { name: "campaign-tick", beat_at: new Date(Date.now() - 60 * 60_000).toISOString(), detail: {} },
    ]);

    expect(check(await run(ctx), "pacing-loop").state).toBe("blocked");
  });

  it("reports the sending loop as fine when it has just run", async () => {
    const { db, ctx } = harness();
    db.seed("worker_heartbeats", [
      { name: "campaign-tick", beat_at: new Date(Date.now() - 60_000).toISOString(), detail: {} },
    ]);

    expect(check(await run(ctx), "pacing-loop").state).toBe("ok");
  });

  it("names an unreachable queue rather than a worker that is down", async () => {
    // The two need different people to do different things, and the pacing
    // stamp reports them identically because it cannot be written without the
    // queue it is reporting on.
    const { db, ctx } = harness();
    db.seed("worker_heartbeats", [
      {
        name: "worker-boot",
        beat_at: new Date().toISOString(),
        detail: { queueReachable: false, redisHost: "red-abc:6379" },
      },
    ]);

    const report = await run(ctx);

    expect(check(report, "worker-boot").state).toBe("blocked");
    expect(check(report, "worker-boot").detail).toContain("red-abc:6379");
    expect(check(report, "worker-boot").fix).toMatch(/REDIS_URL/);
  });

  it("does not call a worker down when it has only never said it started", async () => {
    // Which is also what a deployment looks like before the build carrying the
    // stamp has shipped. "unknown", not "blocked": a check that asserts more
    // than it knows sends somebody to restart a healthy process.
    const { ctx } = harness();
    expect(check(await run(ctx), "worker-boot").state).toBe("unknown");
  });

  it("reports a healthy worker without claiming its loop has run", async () => {
    const { db, ctx } = harness();
    db.seed("worker_heartbeats", [
      { name: "worker-boot", beat_at: new Date().toISOString(), detail: { queueReachable: true, commit: "abc1234def" } },
    ]);

    const report = await run(ctx);

    expect(check(report, "worker-boot").state).toBe("ok");
    // Which build is actually running, from the process rather than from the
    // dashboard reporting on it.
    expect(check(report, "worker-boot").detail).toContain("abc1234");
    // Booting is not sending. Two rows, because they fail separately.
    expect(check(report, "pacing-loop").state).toBe("blocked");
  });

  it("says a deployment with no model key cannot run an agent at all", async () => {
    const { ctx } = harness({ env: { OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined } });

    expect(check(await run(ctx), "model-provider").state).toBe("blocked");
  });

  it("distinguishes a stage waiting on an earlier one from a stage waiting on a person", async () => {
    // Nothing connected and nothing onboarded. "Approve a customer profile" is
    // not this person's next move, and telling them it is buries the one that
    // is.
    const { ctx } = harness({ account: null });

    const report = await run(ctx);

    expect(check(report, "onboarding").state).toBe("todo");
    expect(check(report, "approval").state).toBe("waiting");
    expect(check(report, "account-row").state).toBe("todo");
    expect(check(report, "account-live").state).toBe("waiting");
  });
});
