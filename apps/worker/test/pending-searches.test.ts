import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { TARGETING_BUILD } from "../src/jobs/targeting.js";
import { startPendingSearches } from "../src/jobs/pending-searches.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

/**
 * A strategy approved before LinkedIn was connected still gets its search.
 *
 * The screen said "connect your LinkedIn account and the search will run", the
 * checklist put approval first, and nothing ever ran it: a new customer
 * connected and waited for a campaign that never came.
 */
const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function harness(seed: (db: FakeDb) => void) {
  const db = new FakeDb();
  for (const t of ["linkedin_accounts", "customer_profiles", "campaigns", "events"]) db.seed(t, []);
  db.seed("linkedin_accounts", [{ id: "acct", workspace_id: WS, user_id: USER, status: "active", provider_account_id: "p1" }]);
  seed(db);
  const added: Array<{ data: { customerProfileId: string }; jobId: string }> = [];
  const queues = {
    targeting: { add: async (_n: string, data: { customerProfileId: string }, opts: { jobId: string }) => { added.push({ data, jobId: opts.jobId }); } },
  } as unknown as Pick<Queues, "targeting">;
  const ctx = { db: db.asDb() } as unknown as WorkerContext;
  return { db, added, run: () => startPendingSearches(ctx, queues) };
}

describe("startPendingSearches", () => {
  it("starts the search an approval could not start before LinkedIn was connected", async () => {
    const { db, added, run } = harness((db) =>
      db.seed("customer_profiles", [{ id: "cp1", workspace_id: WS, approved_at: "2026-10-05T00:00:00Z", do_not_pursue: false }]),
    );
    expect(await run()).toBe(1);
    expect(added.map((a) => a.data.customerProfileId)).toEqual(["cp1"]);
    // The button's own id, so a press and this can never queue two searches.
    expect(added[0]?.jobId).toBe("targeting--cp1--new");
    expect(db.rows("events").some((e) => e.name === "targeting.queued" && e.subject_id === "cp1")).toBe(true);
  });

  it("leaves alone a strategy that already has a campaign, was tried, or was not approved", async () => {
    const { added, run } = harness((db) => {
      db.seed("customer_profiles", [
        { id: "has-campaign", workspace_id: WS, approved_at: "2026-10-05T00:00:00Z", do_not_pursue: false },
        { id: "tried", workspace_id: WS, approved_at: "2026-10-05T00:00:00Z", do_not_pursue: false },
        { id: "unapproved", workspace_id: WS, approved_at: null, do_not_pursue: false },
        { id: "dropped", workspace_id: WS, approved_at: "2026-10-05T00:00:00Z", do_not_pursue: true },
      ]);
      db.seed("campaigns", [{ id: "c1", workspace_id: WS, customer_profile_id: "has-campaign" }]);
      // A search that ran under this build and stopped is an answer, not a job to repeat.
      db.seed("events", [
        { workspace_id: WS, name: "targeting.stopped", subject_id: "tried", payload: { build: TARGETING_BUILD }, created_at: "2026-10-26T10:00:00Z" },
      ]);
    });
    expect(await run()).toBe(0);
    expect(added).toHaveLength(0);
  });

  it("tries once more a search that stopped under an older build, and only once", async () => {
    // ShyMarketing: refused on 22 October, fixed on the 26th, and nothing asked again.
    const { db, added, run } = harness((db) => {
      db.seed("customer_profiles", [{ id: "refused", workspace_id: WS, approved_at: "2026-10-22T00:00:00Z", do_not_pursue: false }]);
      db.seed("events", [
        { workspace_id: WS, name: "targeting.queued", subject_id: "refused", payload: {}, created_at: "2026-10-22T17:24:12Z" },
        { workspace_id: WS, name: "targeting.stopped", subject_id: "refused", payload: { build: "2026-09-17.continuable-search" }, created_at: "2026-10-22T17:24:15Z" },
      ]);
    });
    expect(await run()).toBe(1);
    expect(added[0]?.data.customerProfileId).toBe("refused");
    // The retry stops again under this build: that is the answer, so no loop.
    db.seed("events", [
      { workspace_id: WS, name: "targeting.stopped", subject_id: "refused", payload: { build: TARGETING_BUILD }, created_at: "2099-01-01T00:00:00Z" },
    ]);
    expect(await run()).toBe(0);
  });

  it("does nothing for a workspace with no working LinkedIn account", async () => {
    const { db, added, run } = harness((db) =>
      db.seed("customer_profiles", [{ id: "cp1", workspace_id: WS, approved_at: "2026-10-05T00:00:00Z", do_not_pursue: false }]),
    );
    db.find("linkedin_accounts", { id: "acct" })!.status = "reauth_required";
    expect(await run()).toBe(0);
    expect(added).toHaveLength(0);
  });
});
