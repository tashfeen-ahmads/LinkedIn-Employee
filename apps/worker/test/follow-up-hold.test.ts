import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACING_LAST_ACTION } from "@le/shared";
import { runCampaignTick } from "../src/jobs/campaign-tick.js";
import { CAMPAIGN, drain, harness, memoryQueue } from "./loop-harness.js";

/*
 * A follow-up held for an approved pitch (rule 40) returns without sending and
 * without moving its schedule, so it sends itself the moment a line is
 * approved. The loop keeps offering it — and used to count every offer as
 * work, stamping PACING_LAST_ACTION, the record that exists to say when the
 * loop last *sent* something (rule 45).
 */

const NOW = new Date("2026-10-07T13:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function heldFollowUp() {
  const setup = harness(NOW, {
    steps: [{ campaign_id: CAMPAIGN, variant_id: null, step_number: 1, delay_days: 0, message: "{{pitch}}" }],
  });
  for (const t of ["pitches", "campaign_variants", "conversations", "agents", "hooks", "ctas"]) setup.db.seed(t, []);
  const id = setup.prospect({
    status: "accepted",
    invited_at: "2026-10-06T10:00:00Z",
    accepted_at: "2026-10-07T11:00:00Z",
    next_action_at: "2026-10-07T12:00:00Z",
  });
  return { ...setup, id };
}

describe("a follow-up waiting for a pitch", () => {
  it("is not reported as the loop's last action on every tick", async () => {
    const { ctx, db, linkedin, id } = heldFollowUp();
    const { jobs, queues } = memoryQueue();

    expect(await runCampaignTick(db.asDb(), queues, NOW)).toBe(1);
    await drain(ctx, jobs);
    expect(linkedin.sentMessages).toHaveLength(0); // held, correctly
    expect(db.find("campaign_prospects", { id })?.status_reason).toBe("waiting for an approved pitch");

    db.rows("worker_heartbeats").length = 0;
    const later = new Date(NOW.getTime() + 5 * 60_000);
    vi.setSystemTime(later);
    // Nothing can be sent until somebody approves a pitch.
    expect(await runCampaignTick(db.asDb(), queues, later)).toBe(0);
    expect(db.find("worker_heartbeats", { name: PACING_LAST_ACTION })).toBeUndefined();
  });

  it("is still offered, so approving a pitch is all it takes to send it", async () => {
    const { ctx, db, linkedin, id } = heldFollowUp();
    const { jobs, queues } = memoryQueue();
    await runCampaignTick(db.asDb(), queues, NOW);
    await drain(ctx, jobs);

    db.seed("pitches", [
      { id: "pitch-1", workspace_id: db.rows("campaigns")[0]!.workspace_id, body: "We find the leak.", approved_at: NOW.toISOString(), is_default: true, retired_at: null },
    ]);
    const later = new Date(NOW.getTime() + 5 * 60_000);
    vi.setSystemTime(later);
    await runCampaignTick(db.asDb(), queues, later);
    await drain(ctx, jobs);

    expect(linkedin.sentMessages.map((m) => m.text)).toEqual(["We find the leak."]);
    expect(db.find("campaign_prospects", { id })?.status_reason ?? null).toBeNull();
  });
});
