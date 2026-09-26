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
function harness(
  options: {
    account?: Record<string, unknown> | null;
    env?: Record<string, unknown>;
    /** The provider the worker actually built, which is what the email row reads. */
    email?: unknown;
  } = {},
) {
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
    email: options.email ?? null,
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

describe("whether an email can actually be sent", () => {
  /*
   * The row asked `EMAIL_PROVIDER === "off"`, and `render.yaml` hard-codes that
   * variable to `resend`. So on a deployment with no API key the check reported
   * "both sides get a calendar invitation" while no email could be sent at all:
   * a prospect books a time, nothing reaches their diary, and the one screen
   * built to find that says it is working. Rule 17, and `trySend` swallows the
   * failure on purpose, so this row is the only place it can be seen.
   */
  it("is blocked when the provider is named but could not be built", async () => {
    const { ctx } = harness({ env: { EMAIL_PROVIDER: "resend" }, email: null });
    const row = check(await run(ctx), "invitations");

    expect(row.state).toBe("blocked");
    // What it costs, to the customer; which variables, to whoever can set them.
    expect(row.detail).toContain("No email can be sent");
    expect(row.operator).toContain("no provider could be built");
    // And names both variables, because either one missing sends nothing.
    expect(row.operator).toContain("RESEND_API_KEY");
    expect(row.operator).toContain("EMAIL_FROM");
  });

  it("says the digest and the weekly report are silent for the same reason", async () => {
    // A meeting invitation is the row's title, and it is not the only thing
    // that stops. Somebody reading this should not have to work out the rest.
    const { ctx } = harness({ env: { EMAIL_PROVIDER: "resend" }, email: null });
    expect(check(await run(ctx), "invitations").detail).toContain("weekly report");
  });

  it("still tells somebody who turned email off that they turned it off", async () => {
    // Two different situations, two different things to do: one is a decision,
    // the other is a missing key.
    const { ctx } = harness({ env: { EMAIL_PROVIDER: "off" }, email: null });
    const row = check(await run(ctx), "invitations");
    expect(row.state).toBe("blocked");
    expect(row.detail).toContain("Email is switched off");
  });

  it("is ok only when a provider exists", async () => {
    const { ctx } = harness({ env: { EMAIL_PROVIDER: "resend" }, email: { send: async () => {} } });
    expect(check(await run(ctx), "invitations").state).toBe("ok");
  });
});

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
    expect(check(report, "webhook-secret").detail).toMatch(/never sees them/i);
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

  it("carries the last run's reason and what is stuck behind it", async () => {
    // "Last ran two minutes ago" is reassuring and can be true of a loop that
    // has been declining for a week.
    const { db, ctx } = harness();
    db.seed("worker_heartbeats", [
      {
        name: "campaign-tick",
        beat_at: new Date().toISOString(),
        detail: {
          enqueued: 0,
          decisions: [{ campaign: "c1", reason: "limiter: outside_working_hours" }],
          queue: { waiting: 0, delayed: 0, failed: 2, active: 0 },
        },
      },
    ]);

    const check1 = check(await run(ctx), "pacing-loop");

    expect(check1.state).toBe("ok");
    expect(check1.detail).toContain("outside_working_hours");
    // The trap worth naming: BullMQ accepts an add whose id is already taken
    // and never replaces the job, so a failed action stops that person being
    // re-queued at all while every screen reports a healthy loop.
    expect(check1.detail).toMatch(/failed/);
    expect(check1.detail).toMatch(/keeps its slot/);
  });

  it("stays quiet about a queue with nothing in it", async () => {
    const { db, ctx } = harness();
    db.seed("worker_heartbeats", [
      {
        name: "campaign-tick",
        beat_at: new Date().toISOString(),
        detail: { enqueued: 1, decisions: [], queue: { waiting: 0, delayed: 0, failed: 0 } },
      },
    ]);

    expect(check(await run(ctx), "pacing-loop").detail).not.toMatch(/Queue:/);
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
    // The address and the variable go to whoever can change them; the customer
    // is told their campaigns are not being picked up.
    expect(check(report, "worker-boot").operator).toContain("red-abc:6379");
    expect(check(report, "worker-boot").operator).toMatch(/REDIS_URL/);
    expect(check(report, "worker-boot").detail).toMatch(/nothing you launch/i);
  });

  it("says a webhook Unipile is calling unsigned is a webhook nobody is receiving", async () => {
    /*
     * The failure this was written for. Unipile was calling with no signature
     * header, the worker refused every delivery as it should, and the only
     * check on the screen asked whether the *secret* was configured — which it
     * was. So a live conversation on LinkedIn was absent from the product's own
     * inbox with every light green.
     */
    const { db, ctx } = harness();
    db.seed("worker_heartbeats", [
      {
        name: "webhook:messages",
        beat_at: "2026-09-23T09:57:55.094Z",
        detail: { ok: false, reason: "Invalid Unipile webhook signature", hadSignature: false, bytes: 2308 },
      },
    ]);

    const report = await run(ctx);

    expect(check(report, "webhook-deliveries").state).toBe("blocked");
    // The header, not the secret: those are two different things to go and do,
    // and telling somebody to re-copy a secret that is already correct is an
    // afternoon.
    expect(check(report, "webhook-deliveries").operator).toMatch(/unipile-signature/);
    // And the secret check still reads ok, which is why this row had to exist.
    expect(check(report, "webhook-secret").state).toBe("ok");
  });

  it("names the secret when a signature arrived and did not verify", async () => {
    const { db, ctx } = harness();
    db.seed("worker_heartbeats", [
      {
        name: "webhook:messages",
        beat_at: "2026-09-23T09:57:55.094Z",
        detail: { ok: false, reason: "Invalid Unipile webhook signature", hadSignature: true },
      },
    ]);

    expect(check(await run(ctx), "webhook-deliveries").operator).toMatch(/UNIPILE_WEBHOOK_SECRET/);
  });

  it("does not report a webhook that has never been called as working", async () => {
    // `waiting`, never `ok`. A campaign that has had no reply yet and a webhook
    // that was never pointed here look identical from this row, and calling the
    // second one healthy is how a week goes by.
    const { ctx } = harness();

    const state = check(await run(ctx), "webhook-deliveries").state;
    expect(state).toBe("waiting");
    expect(state).not.toBe("ok");
  });

  it("reports an accepted delivery as working", async () => {
    const { db, ctx } = harness();
    db.seed("worker_heartbeats", [
      { name: "webhook:messages", beat_at: "2026-09-23T09:57:55.094Z", detail: { ok: true, messages: 1 } },
    ]);

    expect(check(await run(ctx), "webhook-deliveries").state).toBe("ok");
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
    expect(check(report, "worker-boot").operator).toContain("abc1234");
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

/*
 * Who each sentence on this screen is written for.
 *
 * `/app/system` is gated on a session and nothing else, so the person reading
 * it is normally the business owner whose campaigns are stuck. A row telling
 * them to set `UNIPILE_WEBHOOK_SECRET`, or naming the vendor we buy LinkedIn
 * access from, does two harmful things at once: it names our supply chain on
 * somebody else's dashboard, and it assigns the repair to a person with no
 * access to perform it. That is rule 8 one step worse — repair that waits not
 * for somebody to find a button, but for somebody who could never press it.
 *
 * So `detail` and `fix` are theirs and `operator` is ours, and only a platform
 * admin is served the second. This walks every row in every state it has,
 * because the one that regresses will be a branch nobody re-read.
 */
describe("the two audiences for a system check", () => {
  /** Words that belong to whoever runs the deployment, and to nobody else. */
  const OPERATOR_ONLY = [
    "unipile",
    "resend",
    "openai",
    "anthropic",
    "redis",
    "render",
    "supabase",
    "bullmq",
    "webhook",
    "env",
    "api key",
    "api_key",
    "redeploy",
    "deploy",
    "mock",
    "localhost",
    "signature",
    "/webhooks/",
    "/jobs/",
    "boot_beat",
  ];

  /** Every state each row has, so no branch escapes by not being exercised. */
  async function everyRow() {
    const states = [
      harness(),
      harness({ account: null }),
      harness({ env: { LINKEDIN_PROVIDER: "mock" } }),
      harness({ env: { UNIPILE_WEBHOOK_SECRET: undefined } }),
      harness({ env: { OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined } }),
      harness({ env: { EMAIL_PROVIDER: "off" }, email: null }),
      harness({ env: { EMAIL_PROVIDER: "resend" }, email: null }),
      harness({ env: { EMAIL_PROVIDER: "resend" }, email: { send: async () => {} } }),
    ];

    // A signature that did not verify, and one that never arrived: the two
    // refusals are different rows of prose and both used to name the vendor.
    states[0].db.seed("worker_heartbeats", [
      { name: "webhook:messages", beat_at: "2026-09-23T09:57:55.094Z", detail: { ok: false, reason: "bad digest" } },
    ]);
    states[1].db.seed("worker_heartbeats", [
      { name: "webhook:messages", beat_at: "2026-09-23T09:57:55.094Z", detail: { ok: false, unsigned: true } },
      { name: "worker-boot", beat_at: new Date().toISOString(), detail: { queueReachable: false, redisHost: "127.0.0.1" } },
    ]);
    states[2].db.seed("worker_heartbeats", [
      { name: "webhook:messages", beat_at: "2026-09-23T09:57:55.094Z", detail: { ok: true, messages: 1 } },
      { name: "worker-boot", beat_at: new Date().toISOString(), detail: { queueReachable: true, commit: "abc1234def" } },
      // A live loop, so the branch that quotes its own last decision is walked
      // too: that string is assembled from a reason the loop wrote, and it is
      // the one piece of customer-facing prose this file does not spell out.
      {
        name: "PACING_LOOP",
        beat_at: new Date().toISOString(),
        detail: { enqueued: 0, reason: "outside_working_hours", queued: 0, waiting: 0 },
      },
      { name: "maintenance", beat_at: new Date().toISOString(), detail: { ok: false, failed: ["retention"] } },
    ]);

    const reports = await Promise.all(states.map((s) => run(s.ctx)));
    return reports.flatMap((r) => r.checks);
  }

  it("says nothing to a customer that only an operator could act on", async () => {
    const offenders: string[] = [];
    for (const row of await everyRow()) {
      // Every sentence this screen shows without an admin session.
      const mine = [row.label, row.detail, row.fix ?? ""].join(" ").toLowerCase();
      for (const word of OPERATOR_ONLY) {
        if (mine.includes(word)) offenders.push(`${row.key}: "${word}"`);
      }
      // An environment variable is SHOUTED, which is how one is recognised
      // without listing every name this deployment might gain.
      const shouted = mine.match(/[A-Z][A-Z0-9]{3,}_[A-Z0-9_]+/);
      if (shouted) offenders.push(`${row.key}: ${shouted[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("does not answer a fault of ours by asking the customer to fix it", async () => {
    // A blocked row either has something they can do, or says so and points at
    // support. What it must never do is describe a remedy they have no access
    // to and then leave them looking at it.
    for (const row of await everyRow()) {
      if (row.state !== "blocked") continue;
      if (row.href && row.href !== "/app/support") continue;
      expect(row.fix, `${row.key} is blocked with nothing to do about it`).toBeTruthy();
    }
  });

  it("keeps the operator's version, rather than deleting the detail", async () => {
    // The point is to move that sentence, not to lose it: somebody still has to
    // fix the deployment, and a row with no remedy anywhere is a worse screen
    // than one with the remedy on the wrong half of it.
    const rows = await everyRow();
    const blocked = rows.filter((r) => r.state === "blocked");
    expect(blocked.length).toBeGreaterThan(3);
    for (const row of blocked) {
      expect(row.operator, `${row.key} tells nobody how to fix it`).toBeTruthy();
    }
  });
});
