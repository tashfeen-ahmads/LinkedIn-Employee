import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { REFILL_EVENT, refillCampaigns } from "../src/jobs/refill.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

/**
 * A running campaign looks for more people before it runs out.
 *
 * Lists grew only when somebody pressed Find more. Three of seven live
 * campaigns had nobody left to invite, and every account sent under its
 * allowance while the owners read the ramp as broken.
 */
const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-26T12:00:00Z");

function harness(queuedCount: number, extra: (db: FakeDb) => void = () => {}) {
  const db = new FakeDb();
  for (const t of ["campaigns", "campaign_prospects", "linkedin_accounts", "events"]) db.seed(t, []);
  db.seed("linkedin_accounts", [
    { id: "acct", workspace_id: WS, user_id: USER, status: "active", provider_account_id: "p1", first_action_at: null },
  ]);
  db.seed("campaigns", [
    {
      id: "c1",
      workspace_id: WS,
      owner_user_id: USER,
      customer_profile_id: "cp1",
      linkedin_account_id: "acct",
      daily_invite_cap: 10,
      status: "running",
      search_exhausted: false,
    },
  ]);
  db.seed(
    "campaign_prospects",
    Array.from({ length: queuedCount }, (_, i) => ({ id: `cp-${i}`, workspace_id: WS, campaign_id: "c1", status: "queued" })),
  );
  extra(db);
  const added: Array<{ data: { campaignId?: string; customerProfileId: string }; jobId: string }> = [];
  const queues = {
    targeting: {
      add: async (_n: string, data: { campaignId?: string; customerProfileId: string }, opts: { jobId: string }) => {
        added.push({ data, jobId: opts.jobId });
      },
    },
  } as unknown as Pick<Queues, "targeting">;
  const ctx = { db: db.asDb() } as unknown as WorkerContext;
  return { db, added, run: () => refillCampaigns(ctx, queues, NOW) };
}

describe("refillCampaigns", () => {
  it("continues the campaign's own search once it is down to two days of people", async () => {
    // Ten a day on a new account, so anything under twenty queued is short.
    const { db, added, run } = harness(5);
    expect(await run()).toBe(1);
    expect(added[0]?.data.campaignId).toBe("c1");
    // Find more's own id, so a press and a refill can never queue two searches.
    expect(added[0]?.jobId).toBe("targeting--cp1--c1");
    expect(db.rows("events").some((e) => e.name === REFILL_EVENT && e.subject_id === "c1")).toBe(true);
  });

  it("leaves a campaign that still has enough people queued", async () => {
    const { added, run } = harness(20);
    expect(await run()).toBe(0);
    expect(added).toHaveLength(0);
  });

  it("asks at most once a day per campaign", async () => {
    const { added, run } = harness(0, (db) =>
      db.seed("events", [
        { workspace_id: WS, name: REFILL_EVENT, subject_id: "c1", created_at: "2026-10-26T02:00:00Z", payload: {} },
      ]),
    );
    expect(await run()).toBe(0);
    expect(added).toHaveLength(0);
  });

  it("stops once LinkedIn has said there is nobody left, and never searches on a dead account", async () => {
    const exhausted = harness(0, (db) => {
      db.find("campaigns", { id: "c1" })!.search_exhausted = true;
    });
    expect(await exhausted.run()).toBe(0);

    const disconnected = harness(0, (db) => {
      db.find("linkedin_accounts", { id: "acct" })!.status = "reauth_required";
    });
    expect(await disconnected.run()).toBe(0);
  });

  it("leaves a paused or draft campaign alone", async () => {
    const { added, run } = harness(0, (db) => {
      db.find("campaigns", { id: "c1" })!.status = "paused";
    });
    expect(await run()).toBe(0);
    expect(added).toHaveLength(0);
  });
});
