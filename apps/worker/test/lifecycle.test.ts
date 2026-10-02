import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockEmailProvider } from "@le/email";
import { FakeDb } from "./fake-db.js";
import { runLifecycleEmails } from "../src/jobs/lifecycle.js";
import type { WorkerContext } from "../src/context.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-10T09:00:00Z");

function harness(overrides: { createdDaysAgo?: number; trialEndsInDays?: number | null } = {}) {
  const db = new FakeDb();
  const email = new MockEmailProvider();
  const createdDaysAgo = overrides.createdDaysAgo ?? 5;

  db.seed("workspaces", [
    {
      id: WORKSPACE,
      name: "Acme",
      plan: "trial",
      created_at: new Date(NOW.getTime() - createdDaysAgo * 86_400_000).toISOString(),
      trial_ends_at:
        overrides.trialEndsInDays === null
          ? null
          : new Date(NOW.getTime() + (overrides.trialEndsInDays ?? 30) * 86_400_000).toISOString(),
      subscription_status: null,
    },
  ]);
  db.seed("profiles", [{ id: USER, email: "sam@acme.test", full_name: "Sam Patel" }]);
  db.seed("memberships", [{ workspace_id: WORKSPACE, user_id: USER, role: "owner" }]);

  const ctx = {
    db: db.asDb(),
    email,
    env: { APP_URL: "https://app.test" } as WorkerContext["env"],
  } as unknown as WorkerContext;

  return { db, ctx, email };
}

describe("runLifecycleEmails", () => {
  it("nudges the first outstanding step", async () => {
    const { ctx, email } = harness();

    expect(await runLifecycleEmails(ctx, NOW)).toBe(1);
    expect(email.sent[0]?.subject).toBe("Tell us what you sell");
  });

  it("never nudges the same step twice", async () => {
    // The difference between a helpful reminder and spam is repetition.
    const { ctx, email } = harness();

    await runLifecycleEmails(ctx, NOW);
    expect(await runLifecycleEmails(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(1);
  });

  it("leaves a workspace alone on its first day", async () => {
    // Someone who signed up an hour ago has not stalled, they are reading.
    const { ctx, email } = harness({ createdDaysAgo: 0 });

    expect(await runLifecycleEmails(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("moves to the next step once the first is done", async () => {
    const { db, ctx, email } = harness();
    db.seed("business_profiles", [{ workspace_id: WORKSPACE, spec: {} }]);

    await runLifecycleEmails(ctx, NOW);
    expect(email.sent[0]?.subject).toBe("Approve a customer profile");
  });

  it("names what is already done rather than only what is not", async () => {
    const { db, ctx, email } = harness();
    db.seed("business_profiles", [{ workspace_id: WORKSPACE, spec: {} }]);

    await runLifecycleEmails(ctx, NOW);
    expect(email.sent[0]?.text).toContain("further along");
  });

  /*
   * Trial-ending emails, with the trial limit switched on.
   *
   * The limit is suspended by default until pricing is decided, and while it
   * is off the warning returns before any of these checks run. Left unpinned,
   * "does not warn a workspace that has already subscribed" would keep passing
   * for that reason alone — green, and no longer testing the subscription
   * check at all, which is how a mutation quietly stops biting.
   */
  describe("with the trial limit on", () => {
    let was: string | undefined;
    beforeEach(() => {
      was = process.env.TRIAL_LIMIT_ENFORCED;
      process.env.TRIAL_LIMIT_ENFORCED = "true";
    });
    afterEach(() => {
      if (was === undefined) delete process.env.TRIAL_LIMIT_ENFORCED;
      else process.env.TRIAL_LIMIT_ENFORCED = was;
    });

    it("warns three days before a trial ends", async () => {
      const { ctx, email } = harness({ trialEndsInDays: 3 });

      await runLifecycleEmails(ctx, NOW);
      const trial = email.sent.find((m) => m.subject.includes("trial"));
      expect(trial?.subject).toBe("Your trial ends in 3 days");
    });

    it("does not warn a workspace that has already subscribed", async () => {
      const { db, ctx, email } = harness({ trialEndsInDays: 3 });
      db.find("workspaces", { id: WORKSPACE })!.subscription_status = "active";

      await runLifecycleEmails(ctx, NOW);
      expect(email.sent.some((m) => m.subject.includes("trial"))).toBe(false);
    });

    it("says the numbers are early rather than claiming success on three invitations", async () => {
      const { ctx, email } = harness({ trialEndsInDays: 1 });

      await runLifecycleEmails(ctx, NOW);
      const trial = email.sent.find((m) => m.subject.includes("trial"));
      expect(trial?.text).toContain("not yet a fair test");
    });
  });

  it("sends no trial-ending email while the trial limit is off", async () => {
    // "Your trial ends in 3 days" for a trial that does not end is a threat
    // the product does not carry out, and the real one later reads as another
    // false alarm.
    const was = process.env.TRIAL_LIMIT_ENFORCED;
    delete process.env.TRIAL_LIMIT_ENFORCED;
    try {
      const { ctx, email } = harness({ trialEndsInDays: 3 });
      await runLifecycleEmails(ctx, NOW);
      expect(email.sent.some((m) => m.subject.toLowerCase().includes("trial"))).toBe(false);
    } finally {
      if (was !== undefined) process.env.TRIAL_LIMIT_ENFORCED = was;
    }
  });

  it("does nothing at all when email is not configured", async () => {
    const { ctx } = harness();
    const withoutEmail = { ...ctx, email: null } as WorkerContext;

    expect(await runLifecycleEmails(withoutEmail, NOW)).toBe(0);
  });
});
