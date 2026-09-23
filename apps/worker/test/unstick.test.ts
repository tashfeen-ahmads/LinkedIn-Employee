import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { unstickProspects } from "../src/jobs/unstick.js";

const NOW = new Date("2026-09-23T12:00:00Z");
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";

function db(rows: Array<Record<string, unknown>>, steps: Array<Record<string, unknown>>) {
  const fake = new FakeDb();
  fake.seed("campaign_prospects", rows);
  fake.seed("campaign_steps", steps);
  return fake;
}

const STEP2 = { id: "s2", campaign_id: CAMPAIGN, variant_id: null, step_number: 2, delay_days: 7, message: "m" };

describe("putting a stuck prospect back on the rails", () => {
  it("re-arms somebody mid-sequence with no next action at all", async () => {
    /*
     * The state the first live acceptance landed in: accepted, one message
     * sent, and `next_action_at` null. Nothing noticed — the prospect sits
     * there for ever, the campaign reports `running`, and the funnel reads
     * zero, which the person who launched it correctly reads as "the agent is
     * doing nothing".
     */
    const fake = db(
      [{ id: "cp1", campaign_id: CAMPAIGN, status: "messaged_1", last_step_sent: 1, next_action_at: null }],
      [STEP2],
    );

    expect(await unstickProspects(fake.asDb(), NOW)).toBe(1);
    expect(fake.find("campaign_prospects", { id: "cp1" })?.next_action_at).toBe(NOW.toISOString());
  });

  it("re-arms one whose time passed long ago", async () => {
    const fake = db(
      [
        {
          id: "cp1",
          campaign_id: CAMPAIGN,
          status: "accepted",
          last_step_sent: 0,
          next_action_at: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(),
        },
      ],
      [{ ...STEP2, step_number: 1 }],
    );
    expect(await unstickProspects(fake.asDb(), NOW)).toBe(1);
  });

  it("never brings forward a schedule somebody is waiting out", async () => {
    /*
     * The failure this would otherwise introduce: re-arming everything
     * collapses every configured delay to now, and a campaign paced over a
     * fortnight sends in an afternoon.
     */
    const future = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
    const fake = db(
      [{ id: "cp1", campaign_id: CAMPAIGN, status: "messaged_1", last_step_sent: 1, next_action_at: future }],
      [STEP2],
    );
    expect(await unstickProspects(fake.asDb(), NOW)).toBe(0);
    expect(fake.find("campaign_prospects", { id: "cp1" })?.next_action_at).toBe(future);
  });

  it("leaves a row whose time has only just passed for the next tick", async () => {
    // Not stuck, merely due. Re-arming it would move it backwards.
    const justNow = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const fake = db(
      [{ id: "cp1", campaign_id: CAMPAIGN, status: "messaged_1", last_step_sent: 1, next_action_at: justNow }],
      [STEP2],
    );
    expect(await unstickProspects(fake.asDb(), NOW)).toBe(0);
  });

  it("never restarts somebody who is finished", async () => {
    // closed, failed and opted_out are outcomes. Restarting one of those
    // messages a person who has already been dealt with — or told us to stop.
    const fake = db(
      [
        { id: "a", campaign_id: CAMPAIGN, status: "closed", last_step_sent: 1, next_action_at: null },
        { id: "b", campaign_id: CAMPAIGN, status: "opted_out", last_step_sent: 1, next_action_at: null },
        { id: "c", campaign_id: CAMPAIGN, status: "failed", last_step_sent: 1, next_action_at: null },
        { id: "d", campaign_id: CAMPAIGN, status: "queued", last_step_sent: 0, next_action_at: null },
      ],
      [STEP2],
    );
    expect(await unstickProspects(fake.asDb(), NOW)).toBe(0);
  });

  it("invents no step for somebody whose sequence has ended", async () => {
    // The end of a sequence is an answer, not a fault. Inventing a step here
    // messages somebody a second time with nothing left to say.
    const fake = db(
      [{ id: "cp1", campaign_id: CAMPAIGN, status: "messaged_3", last_step_sent: 3, next_action_at: null }],
      [STEP2],
    );
    expect(await unstickProspects(fake.asDb(), NOW)).toBe(0);
    expect(fake.find("campaign_prospects", { id: "cp1" })?.next_action_at).toBeNull();
  });
});
