import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { collectIssues } from "../src/jobs/issues.js";
import type { WorkerContext } from "../src/context.js";

/**
 * The operator's one list of what is wrong. Each case below is a fault this
 * deployment actually had, found by somebody running SQL after a complaint.
 */
const NOW = new Date("2026-10-05T18:00:00Z");
const WS = "11111111-1111-4111-8111-111111111111";

function harness(seed: (db: FakeDb) => void, env: Record<string, unknown> = {}) {
  const db = new FakeDb();
  for (const table of [
    "workspaces",
    "memberships",
    "profiles",
    "linkedin_accounts",
    "campaigns",
    "campaign_prospects",
    "customer_profiles",
    "worker_heartbeats",
    "events",
    "support_tickets",
    "email_sends",
  ]) {
    db.seed(table, []);
  }
  seed(db);
  const ctx = {
    db: db.asDb(),
    env: { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x", EMAIL_FROM: "Nora <n@x.com>", INTERNAL_API_SECRET: "s", ...env },
  } as unknown as WorkerContext;
  return collectIssues(ctx, NOW);
}

const ids = (issues: Array<{ id: string }>) => issues.map((i) => i.id);

describe("collectIssues", () => {
  it("names somebody who signed up and never finished setup", async () => {
    const issues = await harness((db) =>
      db.seed("profiles", [{ id: "brian", email: "brian@example.com", full_name: "Brian", created_at: "2026-10-02T17:20:00Z" }]),
    );
    expect(ids(issues)).toContain("members:no-workspace:brian");
  });

  it("spots one person with two accounts on two addresses of the same mailbox", async () => {
    const issues = await harness((db) =>
      db.seed("profiles", [
        { id: "p1", email: "pdmiltonandassoc.llc@pm.me", full_name: "Patti Dubas", created_at: "2026-10-02T15:21:00Z" },
        { id: "p2", email: "pdmiltonandassoc.llc@proton.me", full_name: null, created_at: "2026-10-03T18:47:00Z" },
      ]),
    );
    expect(issues.some((i) => i.id.startsWith("members:duplicate:"))).toBe(true);
  });

  it("reports a LinkedIn sign-in that never finished", async () => {
    const issues = await harness((db) =>
      db.seed("linkedin_accounts", [
        { id: "a1", workspace_id: WS, user_id: "u1", status: "connecting", provider_account_id: null, created_at: "2026-10-05T10:00:00Z" },
      ]),
    );
    expect(ids(issues)).toContain("linkedin:unconnected:a1");
  });

  it("reports a paused campaign holding people who accepted", async () => {
    const issues = await harness((db) => {
      db.seed("campaigns", [{ id: "c1", workspace_id: WS, name: "Agency founders", status: "paused", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-28T00:00:00Z" }]);
      db.seed("campaign_prospects", [{ campaign_id: "c1", status: "accepted" }, { campaign_id: "c1", status: "messaged_1" }]);
    });
    expect(ids(issues)).toContain("campaigns:paused-waiting:c1");
  });

  it("does not report a webhook refusal the worker has since repaired", async () => {
    const issues = await harness((db) =>
      db.seed("worker_heartbeats", [
        { name: "webhook:messages", beat_at: "2026-10-02T22:16:46Z", detail: { ok: false, hadSignature: false } },
        { name: "webhooks:registered", beat_at: "2026-10-02T22:49:06Z", detail: { ok: true } },
        { name: "campaign-tick", beat_at: "2026-10-05T17:58:00Z", detail: {} },
        { name: "worker-boot", beat_at: "2026-10-05T16:00:00Z", detail: { queueReachable: true } },
        { name: "maintenance", beat_at: "2026-10-05T03:00:00Z", detail: { ok: true, failed: [] } },
      ]),
    );
    expect(ids(issues)).not.toContain("replies:refused");
    expect(ids(issues)).not.toContain("platform:pacing");
  });

  it("does report a refusal that came after the registration", async () => {
    const issues = await harness((db) =>
      db.seed("worker_heartbeats", [
        { name: "webhooks:registered", beat_at: "2026-10-02T22:49:06Z", detail: { ok: true } },
        { name: "webhook:messages", beat_at: "2026-10-03T09:00:00Z", detail: { ok: false, hadSignature: false } },
      ]),
    );
    expect(ids(issues)).toContain("replies:refused");
  });

  it("says email is off when it is", async () => {
    const issues = await harness(() => undefined, { EMAIL_PROVIDER: "off" });
    expect(ids(issues)).toContain("email:off");
  });

  it("puts critical first", async () => {
    const issues = await harness((db) =>
      db.seed("profiles", [{ id: "x", email: "x@example.com", full_name: "X", created_at: "2026-10-01T00:00:00Z" }]),
    );
    expect(issues[0]?.severity).toBe("critical");
  });
});
