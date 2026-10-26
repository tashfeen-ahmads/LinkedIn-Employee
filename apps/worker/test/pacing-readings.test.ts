import { describe, expect, it, vi } from "vitest";
import { INVITE_CAPACITY_BEAT, PACING_LOOP } from "@le/shared";
import {
  inviteCapacityBeat,
  jobDueAt,
  rescheduleJob,
  runCampaignTick,
  whyNobodyIsReady,
} from "../src/jobs/campaign-tick.js";
import { jobId } from "../src/queues.js";
import { ACCOUNT, CAMPAIGN, HOUR, WORKSPACE, harness, memoryQueue } from "./loop-harness.js";

/**
 * Three things the pacing loop read wrongly about the work it was pacing.
 */

// A Wednesday, 13:00 UTC: eleven hours of the rep's (UTC) day left.
const NOW = new Date("2026-10-07T13:00:00Z");

describe("when a rescheduled invitation is due", () => {
  /*
   * BullMQ 5's moveToDelayed keeps the job's original `timestamp` and makes
   * `delay` relative to the reschedule, so `timestamp + delay` read a job
   * placed two days ago and moved this morning to tomorrow as due yesterday.
   * It was charged to today's allowance, and today sent less.
   */
  it("is read from the due time the job carries, not timestamp + delay", () => {
    const placed = NOW.getTime() - 48 * HOUR;
    const rescheduledAt = NOW.getTime() - HOUR;
    const job = { timestamp: placed, delay: 21 * HOUR, data: { dueAt: rescheduledAt + 21 * HOUR } };
    expect(jobDueAt(job, NOW)).toBe(rescheduledAt + 21 * HOUR);
    // A job from before the field existed keeps the old reading.
    expect(jobDueAt({ timestamp: placed, delay: 21 * HOUR, data: {} }, NOW)).toBe(placed + 21 * HOUR);
  });

  it("is written into the job's data whenever the worker reschedules it", async () => {
    const calls: string[] = [];
    const job = {
      data: { kind: "invite", campaignProspectId: "cp-1" } as Record<string, unknown>,
      token: "tok",
      updateData: vi.fn(async (data: Record<string, unknown>) => {
        calls.push("updateData");
        job.data = data;
      }),
      moveToDelayed: vi.fn(async () => void calls.push("moveToDelayed")),
    };

    await rescheduleJob(job, 5 * HOUR, NOW.getTime());

    expect(job.data.dueAt).toBe(NOW.getTime() + 5 * HOUR);
    expect(job.moveToDelayed).toHaveBeenCalledWith(NOW.getTime() + 5 * HOUR, "tok");
    // Stamped before it moves, so no reading ever sees the move without it.
    expect(calls).toEqual(["updateData", "moveToDelayed"]);
  });

  it("does not take today's allowance when it really goes tomorrow", async () => {
    const { db, prospect } = harness(NOW, { cap: 1 });
    const { jobs, queues } = memoryQueue();
    const parked = prospect();
    const fresh = prospect();
    jobs.set(jobId("invite", parked), {
      name: "invite",
      state: "delayed",
      timestamp: NOW.getTime() - 48 * HOUR,
      // Relative to the reschedule an hour ago: really due tomorrow at 09:00.
      delay: 21 * HOUR,
      data: { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: parked, dueAt: NOW.getTime() + 20 * HOUR },
    });

    await runCampaignTick(db.asDb(), queues, NOW);

    expect(jobs.has(jobId("invite", fresh))).toBe(true);
    // And the invitation just placed carries its own due time.
    const placed = jobs.get(jobId("invite", fresh))!;
    expect((placed.data as { dueAt?: number }).dueAt).toBe(NOW.getTime() + placed.delay);
  });
});

describe("the pending-invitation sample", () => {
  it("is kept per account, so every account is asked, not only the first", async () => {
    /*
     * One shared heartbeat row gated the hourly sample, so the first account
     * sampled reset the clock for all of them and the others were never asked.
     */
    const { db, ctx } = harness(NOW);
    const { queues } = memoryQueue();
    const SECOND = "99999999-9999-4999-8999-999999999999";
    db.seed("linkedin_accounts", [
      { ...db.find("linkedin_accounts", { id: ACCOUNT })!, id: SECOND, provider_account_id: "acct-2" },
    ]);
    db.seed("campaigns", [{ ...db.find("campaigns", { id: CAMPAIGN })!, id: "camp-2", linkedin_account_id: SECOND }]);
    // The first account was sampled a minute ago; the second never has been.
    db.seed("worker_heartbeats", [
      { name: inviteCapacityBeat(ACCOUNT), beat_at: new Date(NOW.getTime() - 60_000).toISOString(), detail: {} },
    ]);

    await runCampaignTick(db.asDb(), queues, NOW, ctx.linkedin);

    const second = db.find("worker_heartbeats", { name: inviteCapacityBeat(SECOND) });
    expect(second?.beat_at).toBe(NOW.toISOString());
    expect((second?.detail as { account?: string })?.account).toBe(SECOND);
    // The first is left alone until its hour is up.
    expect(db.find("worker_heartbeats", { name: inviteCapacityBeat(ACCOUNT) })?.beat_at).not.toBe(NOW.toISOString());
    expect(db.find("worker_heartbeats", { name: INVITE_CAPACITY_BEAT })).toBeUndefined();
  });
});

describe("a warm-up campaign between a view and its invitation", () => {
  it("says the person is waiting out their own warm-up, not held by LinkedIn", async () => {
    /*
     * The wait drawn after a view is `next_action_at`, the same column a
     * LinkedIn refusal uses, and both were reported as "waiting on a
     * per-person hold from LinkedIn". Somebody went looking for a refusal
     * that never happened.
     */
    const { db, prospect } = harness(NOW, { warmUp: true });
    const { queues } = memoryQueue();
    prospect({
      warmed_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      next_action_at: new Date(NOW.getTime() + 35 * 60_000).toISOString(),
    });

    await runCampaignTick(db.asDb(), queues, NOW);

    const decisions = (db.find("worker_heartbeats", { name: PACING_LOOP })?.detail as {
      decisions?: Array<{ reason: string }>;
    })?.decisions;
    const said = (decisions ?? []).map((d) => d.reason).join(" | ");
    expect(said).toContain("viewed and waiting");
    expect(said).not.toContain("hold from LinkedIn");
  });

  it("still names a real hold from LinkedIn separately", () => {
    const rows = [
      // Viewed ten minutes ago, invitation due in 35.
      { id: "a", warmed_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(), next_action_at: new Date(NOW.getTime() + 35 * 60_000).toISOString() },
      // Viewed, invited, refused: held for days, past any warm-up window.
      { id: "b", warmed_at: new Date(NOW.getTime() - 30 * 60_000).toISOString(), next_action_at: new Date(NOW.getTime() + 72 * HOUR).toISOString() },
      // Never viewed, refused.
      { id: "c", warmed_at: null, next_action_at: new Date(NOW.getTime() + 24 * HOUR).toISOString() },
      // Already on its way.
      { id: "d", warmed_at: null, next_action_at: null },
    ];
    const said = whyNobodyIsReady(rows, { entries: new Map([["d", {}]]) }, NOW);
    expect(said).toBe(
      "1 viewed and waiting the usual pause before their invitation (next ready in 35 min), 2 waiting on a per-person hold from LinkedIn, 1 already queued",
    );
  });
});

describe("what the loop says is queued for today", () => {
  /*
   * The campaign page nets today's queued invitations off the room it
   * promises. It used to read them out of the loop's sentences, capped at
   * twenty; the stamp now carries the count itself.
   */
  it("stamps today's queued invitations per account and campaign, and leaves tomorrow's out", async () => {
    const { db, prospect } = harness(NOW, { cap: 5 });
    const { jobs, queues } = memoryQueue();
    const tomorrow = prospect();
    prospect();
    jobs.set(jobId("invite", tomorrow), {
      name: "invite",
      state: "delayed",
      timestamp: NOW.getTime(),
      delay: 20 * HOUR,
      data: { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: tomorrow, dueAt: NOW.getTime() + 20 * HOUR },
    });

    await runCampaignTick(db.asDb(), queues, NOW);

    const placedToday = [...jobs.values()].filter(
      (j) => j.name === "invite" && ((j.data as { dueAt?: number }).dueAt ?? 0) < NOW.getTime() + 11 * HOUR,
    ).length;
    const beat = db.find("worker_heartbeats", { name: PACING_LOOP });
    const entry = (beat?.detail as { inFlight?: Record<string, { account: number; campaigns: Record<string, number> }> })
      .inFlight?.[ACCOUNT];
    expect(placedToday).toBeGreaterThan(0);
    expect(entry?.account).toBe(placedToday);
    expect(entry?.campaigns[CAMPAIGN]).toBe(placedToday);
  });
});
