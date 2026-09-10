import { describe, expect, it } from "vitest";
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

  it("does nothing at all when email is not configured", async () => {
    const { ctx } = harness();
    const withoutEmail = { ...ctx, email: null } as WorkerContext;

    expect(await runLifecycleEmails(withoutEmail, NOW)).toBe(0);
  });
});
