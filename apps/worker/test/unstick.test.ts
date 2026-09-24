import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { LINKEDIN_LIMITS } from "@le/shared";
import { recoverThrottledProspects, unstickProspects } from "../src/jobs/unstick.js";

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

describe("a first message left on a rule the product no longer has", () => {
  /*
   * Rule 43. Step 1 has no configurable delay — what precedes it is the
   * acceptance — but the Targeting Agent wrote three days into every campaign
   * this deployment built before that was enforced. Three people accepted a
   * connection request and were holding schedules days out, written by code
   * since corrected; without this they wait them out in full while the funnel
   * reads zero messages sent.
   *
   * This is the one schedule the job moves earlier, and it is narrow on
   * purpose: accepted, never messaged, and only beyond the window the rule
   * allows.
   */
  const accepted = (over: Record<string, unknown>) => ({
    id: "cp1",
    campaign_id: CAMPAIGN,
    status: "accepted",
    last_step_sent: 0,
    accepted_at: NOW.toISOString(),
    ...over,
  });

  it("pulls a three-day wait back into the acceptance window", async () => {
    const fake = db(
      [accepted({ next_action_at: new Date(NOW.getTime() + 3 * 86_400_000).toISOString() })],
      [{ ...STEP2, step_number: 1, delay_days: 3 }],
    );

    expect(await unstickProspects(fake.asDb(), NOW)).toBe(1);

    const due = Date.parse(fake.find("campaign_prospects", { id: "cp1" })!.next_action_at as string);
    expect(due).toBeGreaterThanOrEqual(NOW.getTime() + LINKEDIN_LIMITS.acceptFollowUpMinMs);
    expect(due).toBeLessThanOrEqual(NOW.getTime() + LINKEDIN_LIMITS.acceptFollowUpMaxMs);
  });

  it("leaves somebody already inside the window alone", async () => {
    // Forty minutes out is the rule working. Re-arming it every hour would
    // push the message further away each time it ran.
    const due = new Date(NOW.getTime() + 40 * 60_000).toISOString();
    const fake = db([accepted({ next_action_at: due })], [{ ...STEP2, step_number: 1 }]);

    expect(await unstickProspects(fake.asDb(), NOW)).toBe(0);
    expect(fake.find("campaign_prospects", { id: "cp1" })?.next_action_at).toBe(due);
  });

  it("leaves a later step's configured delay alone", async () => {
    // Somebody who has had message 1 is waiting out a delay a rep set, and
    // that is exactly the judgement this product should take from them.
    const due = new Date(NOW.getTime() + 7 * 86_400_000).toISOString();
    const fake = db(
      [accepted({ status: "messaged_1", last_step_sent: 1, next_action_at: due })],
      [STEP2],
    );

    expect(await unstickProspects(fake.asDb(), NOW)).toBe(0);
    expect(fake.find("campaign_prospects", { id: "cp1" })?.next_action_at).toBe(due);
  });

  it("leaves a row that never recorded when it was accepted", async () => {
    // Without accepted_at there is nothing to measure the stored time against,
    // and guessing would move a schedule on no evidence.
    const due = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
    const fake = db(
      [accepted({ accepted_at: null, next_action_at: due })],
      [{ ...STEP2, step_number: 1 }],
    );

    expect(await unstickProspects(fake.asDb(), NOW)).toBe(0);
    expect(fake.find("campaign_prospects", { id: "cp1" })?.next_action_at).toBe(due);
  });
});

describe("prospects a temporary refusal wrote off", () => {
  /*
   * `failed` is meant to be an outcome. For one morning it also meant
   * "LinkedIn said please try again later and we did not" — seven real people
   * in twenty-five minutes, each with next_action_at cleared, so nothing was
   * ever going to pick them up. Repair must not wait for somebody to notice.
   */
  const THROTTLED =
    "Unipile POST /api/v1/users/invite failed with 422: Cannot resend yet — You have reached a temporary provider limit. Please try again later. — errors/cannot_resend_yet";

  it("puts a throttled prospect back in the queue", async () => {
    const fake = db(
      [
        {
          id: "cp1",
          campaign_id: CAMPAIGN,
          status: "failed",
          status_reason: THROTTLED,
          invited_at: null,
          last_step_sent: 0,
          next_action_at: null,
        },
      ],
      [STEP2],
    );

    expect(await recoverThrottledProspects(fake.asDb(), NOW)).toBe(1);

    const after = fake.find("campaign_prospects", { id: "cp1" })!;
    expect(after.status).toBe("queued");
    // No schedule of its own: the pacing loop owns when, and the account's
    // cooldown is what holds it. A time here would be a second opinion.
    expect(after.next_action_at).toBeNull();
    expect(after.status_reason).toBeNull();
  });

  it("leaves a prospect LinkedIn genuinely refused", async () => {
    // Re-queueing this one spends a daily invitation on a send that will fail
    // again, and posts another rejected request against the account.
    const reason = "Unipile POST /api/v1/users/invite failed with 422: Cannot send invitation to this member";
    const fake = db(
      [{ id: "cp1", campaign_id: CAMPAIGN, status: "failed", status_reason: reason, invited_at: null }],
      [STEP2],
    );

    expect(await recoverThrottledProspects(fake.asDb(), NOW)).toBe(0);
    expect(fake.find("campaign_prospects", { id: "cp1" })?.status).toBe("failed");
  });

  it("never re-queues somebody whose invitation actually went out", async () => {
    // Whatever the row says afterwards: inviting them again is a second
    // approach from the same company to a stranger (rule 24).
    const fake = db(
      [
        {
          id: "cp1",
          campaign_id: CAMPAIGN,
          status: "failed",
          status_reason: THROTTLED,
          invited_at: "2026-09-22T17:00:00.000Z",
        },
      ],
      [STEP2],
    );

    expect(await recoverThrottledProspects(fake.asDb(), NOW)).toBe(0);
    expect(fake.find("campaign_prospects", { id: "cp1" })?.status).toBe("failed");
  });

  it("leaves a row with no reason recorded", async () => {
    const fake = db(
      [{ id: "cp1", campaign_id: CAMPAIGN, status: "failed", status_reason: null, invited_at: null }],
      [STEP2],
    );

    expect(await recoverThrottledProspects(fake.asDb(), NOW)).toBe(0);
  });
});
