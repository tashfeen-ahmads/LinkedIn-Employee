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
    "worker_heartbeats",
    "events",
    "llm_calls",
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
  it("never lists what a member simply has not done yet", async () => {
    // System bugs only. A signup with no workspace, an unfinished LinkedIn
    // sign-in, a paused or never-launched campaign are a person's choices.
    const issues = await harness((db) => {
      db.seed("profiles", [{ id: "brian", email: "brian@example.com", full_name: "Brian", created_at: "2026-10-02T17:20:00Z" }]);
      db.seed("linkedin_accounts", [
        { id: "a1", workspace_id: WS, user_id: "u1", status: "connecting", provider_account_id: null, created_at: "2026-10-05T10:00:00Z" },
      ]);
      db.seed("campaigns", [{ id: "c1", workspace_id: WS, name: "Agency founders", status: "paused", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-28T00:00:00Z" }]);
      db.seed("campaign_prospects", [{ campaign_id: "c1", status: "accepted" }]);
    });
    expect(issues.filter((i) => ["Members", "Support"].includes(i.area))).toHaveLength(0);
    expect(ids(issues)).not.toContain("linkedin:unconnected:a1");
    expect(ids(issues)).not.toContain("campaigns:paused-waiting:c1");
  });

  it("reports an account the provider stopped accepting", async () => {
    const issues = await harness((db) =>
      db.seed("linkedin_accounts", [
        { id: "a2", workspace_id: WS, user_id: "u1", status: "reauth_required", provider_account_id: "acct_x", created_at: "2026-10-01T00:00:00Z" },
      ]),
    );
    expect(ids(issues)).toContain("unipile:dropped:a2");
  });

  it("reports a campaign running on an account that cannot send", async () => {
    const issues = await harness((db) => {
      db.seed("linkedin_accounts", [
        { id: "a3", workspace_id: WS, user_id: "u1", status: "reauth_required", provider_account_id: "acct_y", created_at: "2026-10-01T00:00:00Z" },
      ]);
      db.seed("campaigns", [{ id: "c2", workspace_id: WS, name: "Live", status: "running", linkedin_account_id: "a3", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-28T00:00:00Z" }]);
    });
    expect(ids(issues)).toContain("campaigns:running-dead:c2");
  });

  it("reports background jobs that failed past their retries", async () => {
    const db = new FakeDb();
    for (const t of ["workspaces", "profiles", "linkedin_accounts", "campaigns", "campaign_prospects", "worker_heartbeats", "events", "llm_calls", "email_sends"]) db.seed(t, []);
    const ctx = { db: db.asDb(), env: { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "x", EMAIL_FROM: "x", INTERNAL_API_SECRET: "s" } } as unknown as WorkerContext;
    const issues = await collectIssues(ctx, NOW, { linkedinAction: { failed: 3, reasons: ["422: Cannot send invitation"] } });
    expect(ids(issues)).toContain("jobs:failed:linkedinAction");
  });

  it("reports failing AI calls", async () => {
    const issues = await harness((db) =>
      db.seed("llm_calls", [{ workspace_id: WS, agent: "targeting.invite-note", error: "model returned no parsable output", created_at: "2026-10-05T17:00:00Z" }]),
    );
    expect(ids(issues)).toContain("ai:targeting.invite-note");
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
    const issues = await harness(() => undefined, { EMAIL_PROVIDER: "off" });
    expect(issues[0]?.severity).toBe("critical");
  });
});
