import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { collectIssues, recentFailures } from "../src/jobs/issues.js";
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
        { id: "a3", workspace_id: WS, user_id: "u1", status: "connecting", provider_account_id: null, created_at: "2026-10-01T00:00:00Z" },
      ]);
      db.seed("campaigns", [{ id: "c2", workspace_id: WS, name: "Live", status: "running", linkedin_account_id: "a3", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-28T00:00:00Z" }]);
    });
    expect(ids(issues)).toContain("campaigns:running-dead:c2");
  });

  it("says a signed-out account once, naming what waits on it, not once per campaign and search", async () => {
    // Monic's sign-in read as four critical faults: the account, each of two
    // campaigns, and the search it stopped.
    const issues = await harness((db) => {
      db.seed("linkedin_accounts", [
        { id: "a3", workspace_id: WS, user_id: "u1", status: "reauth_required", provider_account_id: "acct_y", created_at: "2026-10-01T00:00:00Z" },
      ]);
      db.seed("campaigns", [
        { id: "c2", workspace_id: WS, name: "Live", status: "running", linkedin_account_id: "a3", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-28T00:00:00Z" },
        { id: "c3", workspace_id: WS, name: "Second", status: "running", linkedin_account_id: "a3", created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-28T00:00:00Z" },
      ]);
      db.seed("events", [
        { workspace_id: WS, name: "targeting.stopped", payload: { reason: "LinkedIn needs you to sign in again." }, created_at: "2026-10-05T10:00:00Z" },
      ]);
    });
    const account = issues.filter((i) => i.id.startsWith("unipile:dropped:a3"));
    expect(account).toHaveLength(1);
    expect((account[0] as { detail: string }).detail).toContain('"Live", "Second"');
    expect(ids(issues)).not.toContain("campaigns:running-dead:c2");
    expect(ids(issues)).not.toContain(`campaigns:targeting:${WS}`);
  });

  it("reports failed people from this week only, never a month-old one for ever", async () => {
    const issues = await harness((db) => {
      db.seed("campaigns", [
        { id: "old", workspace_id: WS, name: "Old", status: "running", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
        { id: "new", workspace_id: WS, name: "New", status: "running", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      ]);
      db.seed("campaign_prospects", [
        { campaign_id: "old", status: "failed", updated_at: "2026-09-20T00:00:00Z" },
        { campaign_id: "new", status: "failed", updated_at: "2026-10-04T00:00:00Z" },
      ]);
    });
    expect(ids(issues)).not.toContain("campaigns:failed:old");
    expect(ids(issues)).toContain("campaigns:failed:new");
  });

  it("drops a missing note from the list once the hourly fill has had a day at it", async () => {
    const issues = await harness((db) => {
      db.seed("campaigns", [
        { id: "stale", workspace_id: WS, name: "Stale", status: "running", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
        { id: "fresh", workspace_id: WS, name: "Fresh", status: "running", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      ]);
      db.seed("campaign_prospects", [
        { campaign_id: "stale", status: "queued", invite_note: null },
        { campaign_id: "fresh", status: "queued", invite_note: null },
      ]);
      db.seed("events", [
        { workspace_id: WS, subject_id: "stale", name: "campaign.notes_missing", payload: {}, created_at: "2026-10-03T00:00:00Z" },
        { workspace_id: WS, subject_id: "fresh", name: "campaign.notes_missing", payload: {}, created_at: "2026-10-05T12:00:00Z" },
      ]);
    });
    expect(ids(issues)).not.toContain("campaigns:notes:stale");
    expect(ids(issues)).toContain("campaigns:notes:fresh");
  });

  it("reports background jobs that failed past their retries", async () => {
    const db = new FakeDb();
    for (const t of ["workspaces", "profiles", "linkedin_accounts", "campaigns", "campaign_prospects", "worker_heartbeats", "events", "llm_calls", "email_sends"]) db.seed(t, []);
    const ctx = { db: db.asDb(), env: { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "x", EMAIL_FROM: "x", INTERNAL_API_SECRET: "s" } } as unknown as WorkerContext;
    const issues = await collectIssues(ctx, NOW, { linkedinAction: { failed: 3, reasons: ["422: Cannot send invitation"] } });
    expect(ids(issues)).toContain("jobs:failed:linkedinAction");
  });

  it("counts only the last day's failed jobs, never a fixed fault's leftovers", () => {
    // 220 "Custom Id cannot contain :" jobs from a bug fixed weeks earlier sat
    // in campaignTick, because BullMQ only ages failures out when another job
    // in the same queue fails. They read as a live fault.
    const old = NOW.getTime() - 8 * 24 * 60 * 60_000;
    const fresh = NOW.getTime() - 60 * 60_000;
    const counted = recentFailures(
      [
        ...Array.from({ length: 220 }, () => ({ failedReason: "Custom Id cannot contain :", finishedOn: old })),
        { failedReason: "422: Cannot send invitation", finishedOn: fresh },
      ],
      NOW,
    );
    expect(counted.failed).toBe(1);
    expect(counted.reasons).toEqual(["422: Cannot send invitation"]);
    expect(recentFailures([{ failedReason: "x", finishedOn: old }], NOW).failed).toBe(0);
  });

  it("stops reporting missing notes once they have been written", async () => {
    const event = { workspace_id: WS, name: "campaign.notes_missing", subject_id: "c9", payload: { missing: 1, prospects: 40 }, created_at: "2026-10-05T04:05:00Z" };
    const missing = await harness((db) => {
      db.seed("events", [event]);
      db.seed("campaign_prospects", [{ campaign_id: "c9", status: "queued", invite_note: null }]);
    });
    expect(ids(missing)).toContain("campaigns:notes:c9");
    const filled = await harness((db) => {
      db.seed("events", [event]);
      db.seed("campaign_prospects", [{ campaign_id: "c9", status: "queued", invite_note: "Hi Dana, …" }]);
    });
    expect(ids(filled)).not.toContain("campaigns:notes:c9");
  });

  it("lists repeated search stops once, and clears them when a later search starts", async () => {
    const stop = (at: string) => ({ workspace_id: WS, name: "targeting.stopped", subject_id: "cp1", payload: { reason: "LinkedIn refused the search." }, created_at: at });
    const repeated = await harness((db) =>
      db.seed("events", [stop("2026-10-03T17:24:00Z"), stop("2026-10-03T17:25:00Z"), stop("2026-10-04T15:48:00Z")]),
    );
    const rows = repeated.filter((i) => i.id.startsWith("campaigns:targeting:"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain("3 times");

    const retried = await harness((db) =>
      db.seed("events", [
        stop("2026-10-03T17:24:00Z"),
        { workspace_id: WS, name: "targeting.queued", subject_id: "cp1", payload: {}, created_at: "2026-10-05T10:00:00Z" },
      ]),
    );
    expect(retried.filter((i) => i.id.startsWith("campaigns:targeting:"))).toHaveLength(0);
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

  it("says which Sales Navigator fields the latest weekly probe saw refused", async () => {
    const probe = (created_at: string, payload: Record<string, string>) => ({
      workspace_id: WS,
      name: "targeting.sales_navigator_probe",
      subject_id: "cp1",
      payload,
      created_at,
    });
    const issues = await harness((db) =>
      db.seed("events", [
        probe("2026-10-01T09:00:00Z", { "SN keywords only": "1", "SN title": "refused: Invalid parameters" }),
        probe("2026-10-04T09:00:00Z", { "SN keywords only": "1", "SN role": "1", "SN seniority owner/partner": "refused: Invalid parameters" }),
      ]),
    );
    const row = issues.find((i) => i.id === `unipile:sales-navigator-probe:${WS}`);
    expect(row?.detail).toContain("SN seniority owner/partner (Invalid parameters)");
    // The latest probe only: a field refused last week and accepted since is fixed.
    expect(row?.detail).not.toContain("SN title");
    expect(row?.since).toBe("2026-10-04T09:00:00Z");
  });

  it("says nothing about a probe that saw every field accepted", async () => {
    const issues = await harness((db) =>
      db.seed("events", [
        { workspace_id: WS, name: "targeting.sales_navigator_probe", subject_id: "cp1", payload: { "SN keywords only": "1" }, created_at: "2026-10-04T09:00:00Z" },
      ]),
    );
    expect(ids(issues).some((id) => id.startsWith("unipile:sales-navigator-probe"))).toBe(false);
  });
});
