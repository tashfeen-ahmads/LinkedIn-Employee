import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db.js";
import { LINKEDIN_LIMITS } from "@le/shared";
import { recoverThrottledProspects, unstickProspects } from "../src/jobs/unstick.js";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { HOUR, WORKSPACE, harness } from "./loop-harness.js";

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

  it("invents no step for somebody whose angle's sequence has ended", async () => {
    /*
     * Rule 28 and rule 42 together. An angle that wrote a sequence owns it end
     * to end, and the send path stops where it stops. Repair used to fall
     * through to the campaign-wide step 2 the angle never had, re-arming
     * somebody whose sequence was over — every hour, for a send that would
     * then be refused.
     */
    const fake = db(
      [
        {
          id: "cp1",
          campaign_id: CAMPAIGN,
          variant_id: "angle-a",
          status: "messaged_1",
          last_step_sent: 1,
          next_action_at: null,
        },
      ],
      [{ ...STEP2, id: "a1", variant_id: "angle-a", step_number: 1 }, STEP2],
    );
    expect(await unstickProspects(fake.asDb(), NOW)).toBe(0);
    expect(fake.find("campaign_prospects", { id: "cp1" })?.next_action_at).toBeNull();
  });

  it("still re-arms an angle's own next step", async () => {
    const fake = db(
      [
        {
          id: "cp1",
          campaign_id: CAMPAIGN,
          variant_id: "angle-a",
          status: "messaged_1",
          last_step_sent: 1,
          next_action_at: null,
        },
      ],
      [{ ...STEP2, id: "a1", variant_id: "angle-a", step_number: 1 }, { ...STEP2, id: "a2", variant_id: "angle-a" }],
    );
    expect(await unstickProspects(fake.asDb(), NOW)).toBe(1);
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

  it("leaves an accepted row that already records a message sent", async () => {
    // A crash between the send and the status write leaves exactly this shape:
    // still `accepted`, but message 1 is out and the next delay is the rep's.
    // The query cannot be relied on to keep it out; the rule itself must.
    const due = new Date(NOW.getTime() + 7 * 86_400_000).toISOString();
    const fake = db([accepted({ last_step_sent: 1, next_action_at: due })], [STEP2]);

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

describe("repair at scale", () => {
  it("reaches a stuck prospect behind two hundred healthy mid-sequence rows", async () => {
    /*
     * The read was every live row, unordered, two hundred at a time, and only
     * then asked which were stuck. Rows correctly waiting out a step delay
     * filled the window, so a stuck row past them was never examined, on any
     * run, ever.
     */
    const future = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
    const healthy = Array.from({ length: 200 }, (_, i) => ({
      id: `ok-${i}`,
      campaign_id: CAMPAIGN,
      variant_id: null,
      status: "messaged_1",
      last_step_sent: 1,
      next_action_at: future,
      accepted_at: null,
    }));
    const fake = db(
      [
        ...healthy,
        { id: "stuck", campaign_id: CAMPAIGN, variant_id: null, status: "messaged_1", last_step_sent: 1, next_action_at: null, accepted_at: null },
      ],
      [STEP2],
    );

    await unstickProspects(fake.asDb(), NOW);

    expect(fake.find("campaign_prospects", { id: "stuck" })?.next_action_at).toBe(NOW.toISOString());
    // And nobody healthy was touched on the way.
    expect(fake.rows("campaign_prospects").filter((r) => r.next_action_at === future)).toHaveLength(200);
  });

  it("recovers a throttled row behind five hundred permanent refusals", async () => {
    const permanent = Array.from({ length: 500 }, (_, i) => ({
      id: `dead-${String(i).padStart(3, "0")}`,
      campaign_id: CAMPAIGN,
      status: "failed",
      status_reason: "422: Cannot send invitation to this member",
      invited_at: null,
    }));
    const fake = db(
      [
        ...permanent,
        {
          id: "throttled",
          campaign_id: CAMPAIGN,
          status: "failed",
          status_reason: "422 errors/cannot_resend_yet: temporary provider limit",
          invited_at: null,
        },
      ],
      [STEP2],
    );

    expect(await recoverThrottledProspects(fake.asDb(), NOW)).toBe(1);
    expect(fake.find("campaign_prospects", { id: "throttled" })?.status).toBe("queued");
  });
});

describe("a first follow-up the provider asked us to retry later", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is never brought forward inside the provider's own cooldown", async () => {
    /*
     * A refused first follow-up goes back on the schedule after the provider's
     * cooldown — two hours for a 429. That row is exactly the shape the stale
     * acceptance window looks for (accepted, never messaged, due well after
     * the acceptance), so the hourly run pulled it forward to twenty minutes
     * and the provider was asked again inside its own cooldown.
     */
    vi.useFakeTimers();
    const now = new Date("2026-10-07T13:00:00Z");
    vi.setSystemTime(now);
    const setup = harness(now);
    for (const t of ["conversations", "pitches", "campaign_variants", "agents", "hooks", "ctas"]) setup.db.seed(t, []);
    const id = setup.prospect({
      status: "accepted",
      invited_at: "2026-10-06T10:00:00Z",
      accepted_at: "2026-10-07T11:30:00Z",
      next_action_at: "2026-10-07T12:30:00Z",
    });
    vi.spyOn(setup.linkedin, "sendMessage").mockResolvedValue({ ok: false, error: "429 too many requests" });

    await runLinkedInAction(setup.ctx, { kind: "follow_up", workspaceId: WORKSPACE, campaignProspectId: id, stepNumber: 1 });
    const cooldownEnds = Date.parse(setup.db.find("campaign_prospects", { id })!.next_action_at as string);
    expect(cooldownEnds).toBeGreaterThan(now.getTime() + 2 * HOUR - 1);

    const later = new Date(now.getTime() + 10 * 60_000);
    vi.setSystemTime(later);
    await unstickProspects(setup.db.asDb(), later);

    expect(Date.parse(setup.db.find("campaign_prospects", { id })!.next_action_at as string)).toBe(cooldownEnds);
  });
});
