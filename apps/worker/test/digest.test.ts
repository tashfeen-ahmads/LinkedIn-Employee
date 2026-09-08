import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockEmailProvider } from "@le/email";
import { FakeDb } from "./fake-db.js";
import { runDailyDigest } from "../src/jobs/digest.js";
import type { WorkerContext } from "../src/context.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-09T07:00:00Z");

function harness() {
  const db = new FakeDb();
  const email = new MockEmailProvider();

  db.seed("workspaces", [{ id: WORKSPACE, name: "Acme", plan: "pro" }]);
  db.seed("profiles", [{ id: USER, email: "rep@acme.test", full_name: "Sam Patel", timezone: "UTC" }]);
  db.seed("memberships", [{ workspace_id: WORKSPACE, user_id: USER, role: "owner" }]);
  db.seed("linkedin_accounts", [
    { workspace_id: WORKSPACE, user_id: USER, status: "active", provider_account_id: "acct" },
  ]);

  const ctx = {
    db: db.asDb(),
    email,
    env: { APP_URL: "https://app.test" } as WorkerContext["env"],
  } as unknown as WorkerContext;

  return { db, ctx, email };
}

function activity(db: FakeDb, names: string[], at = new Date(NOW.getTime() - 3_600_000).toISOString()) {
  db.seed(
    "events",
    names.map((name) => ({ workspace_id: WORKSPACE, name, created_at: at })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("runDailyDigest", () => {
  it("sends when something happened", async () => {
    const { db, ctx, email } = harness();
    activity(db, ["invite.sent", "invite.sent", "message.received", "meeting.booked"]);

    expect(await runDailyDigest(ctx, NOW)).toBe(1);
    expect(email.sent[0]?.to).toBe("rep@acme.test");
    expect(email.sent[0]?.text).toContain("2 invitations sent");
  });

  it("stays silent on a day with nothing to report", async () => {
    const { ctx, email } = harness();

    // A digest whose only content is four zeroes teaches people to ignore it.
    expect(await runDailyDigest(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("sends when replies are waiting even if nothing else happened", async () => {
    const { db, ctx, email } = harness();
    db.seed("reply_drafts", [
      { workspace_id: WORKSPACE, conversation_id: "c1", body: "draft", status: "pending", prompt_version: "v1" },
    ]);

    expect(await runDailyDigest(ctx, NOW)).toBe(1);
    expect(email.sent[0]?.subject).toBe("1 reply needs you");
  });

  it("ignores activity older than the window", async () => {
    const { db, ctx, email } = harness();
    activity(db, ["invite.sent"], new Date(NOW.getTime() - 5 * 86_400_000).toISOString());

    expect(await runDailyDigest(ctx, NOW)).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it("warns about a paused account, and sends because of it", async () => {
    const { db, ctx, email } = harness();
    db.rows("linkedin_accounts")[0]!.status = "reauth_required";

    expect(await runDailyDigest(ctx, NOW)).toBe(1);
    expect(email.sent[0]?.text).toContain("reauth required");
  });

  it("lists upcoming meetings with who they are with", async () => {
    const { db, ctx, email } = harness();
    activity(db, ["meeting.booked"]);
    db.seed("prospects", [
      { id: "p1", workspace_id: WORKSPACE, linkedin_url: "x", first_name: "Jane", last_name: "Doe", company: "Northwind" },
    ]);
    db.seed("meetings", [
      {
        workspace_id: WORKSPACE,
        prospect_id: "p1",
        rep_user_id: USER,
        starts_at: new Date(NOW.getTime() + 2 * 86_400_000).toISOString(),
        ends_at: new Date(NOW.getTime() + 2 * 86_400_000 + 1_800_000).toISOString(),
      },
    ]);

    await runDailyDigest(ctx, NOW);
    expect(email.sent[0]?.text).toContain("Jane Doe (Northwind)");
  });

  it("does nothing at all when email is not configured", async () => {
    const { db, ctx } = harness();
    activity(db, ["invite.sent"]);
    const withoutEmail = { ...ctx, email: null } as WorkerContext;

    expect(await runDailyDigest(withoutEmail, NOW)).toBe(0);
  });
});
