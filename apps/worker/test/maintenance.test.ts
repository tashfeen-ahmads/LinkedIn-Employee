import { describe, expect, it } from "vitest";
import { MAINTENANCE_BEAT } from "@le/shared";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { runMaintenance } from "../src/jobs/maintenance.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

/**
 * The night's work, and what happens when one part of it throws.
 *
 * Maintenance is where this product keeps the promises that are not a campaign:
 * data erased at the retention limit, invitations withdrawn before they sour an
 * account, approved replies that were never dispatched picked back up, accounts
 * repaired. It ran as a bare sequence, so a single throw — a 500 from the
 * provider inside acceptance detection is entirely ordinary — skipped
 * everything below it. Silently, at three in the morning, for as many nights as
 * it kept throwing.
 *
 * And it stamped nothing, so a night that found nothing to do and a month that
 * never ran were the same absence from every screen in the product.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const INVITED = "55555555-5555-4555-8555-5555555555aa";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const CP = "66666666-6666-4666-8666-666666666666";
const STALE_CP = "66666666-6666-4666-8666-6666666666aa";
const NOW = new Date("2026-09-18T03:00:00Z");

/** A prospect old enough that the retention sweep must erase them. */
const ANCIENT = new Date(NOW.getTime() - 800 * 86_400_000).toISOString();

function harness() {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();

  db.seed("workspaces", [{ id: WORKSPACE, data_retention_days: 365 }]);
  db.seed("linkedin_accounts", [
    { id: ACCOUNT, workspace_id: WORKSPACE, provider_account_id: "acct", status: "active" },
  ]);
  db.seed("prospects", [
    {
      id: PROSPECT,
      workspace_id: WORKSPACE,
      provider_id: "prov_old",
      created_at: ANCIENT,
      last_contacted_at: ANCIENT,
      do_not_contact: false,
    },
    // Recently contacted, so the retention sweep must leave this one alone.
    {
      id: INVITED,
      workspace_id: WORKSPACE,
      provider_id: "prov_jane",
      created_at: NOW.toISOString(),
      last_contacted_at: NOW.toISOString(),
      do_not_contact: false,
    },
  ]);

  // An invited prospect, so acceptance detection actually calls the provider.
  // Without one it returns early and a stubbed provider failure never fires —
  // a test that would pass whether the guard existed or not.
  db.seed("campaigns", [
    { id: CAMPAIGN, workspace_id: WORKSPACE, linkedin_account_id: ACCOUNT, status: "running" },
  ]);
  db.seed("campaign_steps", [
    { workspace_id: WORKSPACE, campaign_id: CAMPAIGN, step_number: 1, delay_days: 2, message: "Hello" },
  ]);
  db.seed("campaign_prospects", [
    {
      id: CP,
      workspace_id: WORKSPACE,
      campaign_id: CAMPAIGN,
      prospect_id: INVITED,
      status: "invited",
      invited_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
      last_step_sent: 0,
      next_action_at: null,
    },
    // Invited 30 days ago and still pending: past the 21-day mark, so the
    // withdraw pass will ask the provider to pull it back. That call is the
    // one in the night that genuinely throws out to the caller — acceptance
    // detection catches its own provider errors per account, so a test built
    // on that would demonstrate nothing.
    {
      id: STALE_CP,
      workspace_id: WORKSPACE,
      campaign_id: CAMPAIGN,
      prospect_id: INVITED,
      status: "invited",
      invitation_id: "inv_old",
      invited_at: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
      last_step_sent: 0,
      next_action_at: null,
    },
  ]);

  const queues = {
    linkedinAction: { add: async () => undefined },
  } as unknown as Queues;

  const ctx = { db: db.asDb(), linkedin, email: null, env: { APP_URL: "https://x.test" } } as unknown as WorkerContext;
  return { db, ctx, linkedin, queues };
}

describe("runMaintenance", () => {
  it("stamps a heartbeat, so a month of not running is not silence", async () => {
    const { db, ctx, queues } = harness();
    await runMaintenance(ctx, queues, NOW);

    const beat = db.find("worker_heartbeats", { name: MAINTENANCE_BEAT });
    expect(beat).toBeTruthy();
    expect(beat!.beat_at).toBe(NOW.toISOString());
    expect((beat!.detail as { ok: boolean }).ok).toBe(true);
  });

  it("keeps the retention promise even when an earlier step throws", async () => {
    // This is the failure exactly: acceptance detection calls the provider, the
    // provider returns a 500, and the retention sweep — which is a promise
    // about how long other people's data is kept — never runs.
    const { db, ctx, linkedin, queues } = harness();
    linkedin.withdrawInvitation = async () => {
      throw new Error("502 from the provider");
    };

    await runMaintenance(ctx, queues, NOW);

    // Erasure is a tombstone, not a delete: rule 24 depends on the row
    // outliving everything, so what proves the sweep ran is the identity being
    // gone and the do-not-contact mark being set.
    const swept = db.find("prospects", { id: PROSPECT })!;
    expect(swept.do_not_contact).toBe(true);
    expect(swept.first_name).toBeNull();
    expect(swept.provider_id).toBeNull();

    // And the person contacted this week is untouched.
    expect(db.find("prospects", { id: INVITED })!.do_not_contact).toBe(false);
  });

  it("names the step that failed rather than reporting a clean night", async () => {
    const { db, ctx, linkedin, queues } = harness();
    linkedin.withdrawInvitation = async () => {
      throw new Error("502 from the provider");
    };

    await runMaintenance(ctx, queues, NOW);

    const detail = db.find("worker_heartbeats", { name: MAINTENANCE_BEAT })!.detail as {
      ok: boolean;
      failed: string[];
      failures: Record<string, string>;
    };
    expect(detail.ok).toBe(false);
    expect(detail.failed).toContain("withdraw-stale");
    // The provider's own sentence, not a shrug: "502 from the provider" is the
    // useful half of the report.
    expect(detail.failures["withdraw-stale"]).toContain("502");
  });

  it("does not let one unhealthy account stop the others being checked", async () => {
    const { db, ctx, linkedin, queues } = harness();
    db.seed("linkedin_accounts", [
      {
        id: "33333333-3333-4333-8333-33333333aaaa",
        workspace_id: WORKSPACE,
        provider_account_id: "acct2",
        status: "active",
      },
    ]);

    let asked = 0;
    linkedin.getAccountHealth = async () => {
      asked += 1;
      throw new Error("no such account");
    };

    await runMaintenance(ctx, queues, NOW);

    expect(asked).toBe(2);
    const detail = db.find("worker_heartbeats", { name: MAINTENANCE_BEAT })!.detail as {
      failed: string[];
    };
    expect(detail.failed.filter((f) => f.startsWith("health:"))).toHaveLength(2);
  });

  it("still finishes the night when every step throws", async () => {
    // The stamp is the point: a run where nothing worked must still report
    // that it ran, or it is indistinguishable from a worker that is not there.
    const { db, ctx, linkedin, queues } = harness();
    const boom = async () => {
      throw new Error("everything is on fire");
    };
    linkedin.listRelations = boom;
    linkedin.getAccountHealth = boom;
    linkedin.listAccounts = boom;
    linkedin.withdrawInvitation = boom;

    await expect(runMaintenance(ctx, queues, NOW)).resolves.toBeUndefined();
    expect(db.find("worker_heartbeats", { name: MAINTENANCE_BEAT })).toBeTruthy();
  });
});
