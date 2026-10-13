import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendOneNow } from "../src/jobs/send-one.js";
import { RescheduleError, runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { CAMPAIGN, HOUR, WORKSPACE, harness } from "./loop-harness.js";

/*
 * Send one now takes the next invitation off the conveyor belt (rule 25). It
 * skips the waiting and nothing else — so it has to pick the person the loop
 * itself would pick, and two presses must still be one invitation.
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

describe("Send one now and the same person", () => {
  it("never sends the same person two invitations when pressed twice", async () => {
    // Two presses (or a press racing the queued job) both picked the oldest
    // queued row and both passed every read before either wrote.
    const { ctx, linkedin, prospect } = harness(NOW);
    prospect();
    prospect();
    await Promise.all([
      sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
      sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN }),
    ]);
    const ids = linkedin.sentInvitations.map((i) => i.providerId);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lets two sends at one under the cap both go", async () => {
    // Each read "one left" before either was counted. The claim is taken
    // before the cap is re-read, so whichever counts second sees both.
    const { ctx, linkedin, prospect } = harness(NOW, { cap: 1 });
    const a = prospect();
    const b = prospect();
    const results = await Promise.allSettled([
      runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: a }),
      runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: b }),
    ]);
    expect(linkedin.sentInvitations.length).toBeLessThanOrEqual(1);
    // A send that backed off is rescheduled, not lost.
    for (const r of results) if (r.status === "rejected") expect(r.reason).toBeInstanceOf(RescheduleError);
  });
});

describe("who Send one now picks", () => {
  it("does not re-ask LinkedIn about a person it is holding back on their own refusal", async () => {
    // A prospect-scoped refusal ("already invited recently") carries a wait.
    // The loop honoured it; Send one now took the oldest queued row regardless.
    const { ctx, linkedin, prospect } = harness(NOW);
    prospect(
      { next_action_at: new Date(NOW.getTime() + 24 * HOUR).toISOString(), status_reason: "422 already_invited_recently" },
      { provider_id: "held-person" },
    );
    prospect({}, { provider_id: "free-person" });
    await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });
    expect(linkedin.sentInvitations.map((i) => i.providerId)).toEqual(["free-person"]);
  });

  it("does not invite an unwarmed prospect cold on a warm-up campaign", async () => {
    const { ctx, linkedin, prospect } = harness(NOW, { warmUp: true });
    prospect({ warmed_at: null });
    const result = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });
    expect(linkedin.sentInvitations).toHaveLength(0);
    expect(result.ok).toBe(false);
  });

  it("invites somebody whose view has had time to land", async () => {
    const { ctx, linkedin, prospect } = harness(NOW, { warmUp: true });
    prospect({ warmed_at: new Date(NOW.getTime() - HOUR).toISOString(), next_action_at: new Date(NOW.getTime() - 5 * 60_000).toISOString() });
    const result = await sendOneNow(ctx, { workspaceId: WORKSPACE, campaignId: CAMPAIGN });
    expect(result.ok).toBe(true);
    expect(linkedin.sentInvitations).toHaveLength(1);
  });
});

describe("the send path re-checks what Send one now chose", () => {
  it("holds an invitation whose person is serving their own wait", async () => {
    const { ctx, linkedin, prospect } = harness(NOW);
    const id = prospect({ next_action_at: new Date(NOW.getTime() + 24 * HOUR).toISOString() });
    await expect(
      runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id }),
    ).rejects.toBeInstanceOf(RescheduleError);
    expect(linkedin.sentInvitations).toHaveLength(0);
  });

  it("never sends a warm-up campaign's invitation on a stale view", async () => {
    const { ctx, linkedin, prospect } = harness(NOW, { warmUp: true });
    const id = prospect({ warmed_at: new Date(NOW.getTime() - 17 * HOUR).toISOString() });
    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });
    expect(linkedin.sentInvitations).toHaveLength(0);
  });

  it("never sends one minutes after the view", async () => {
    const { ctx, linkedin, prospect } = harness(NOW, { warmUp: true });
    const id = prospect({ warmed_at: new Date(NOW.getTime() - 10 * 60_000).toISOString() });
    await expect(
      runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id }),
    ).rejects.toBeInstanceOf(RescheduleError);
    expect(linkedin.sentInvitations).toHaveLength(0);
  });
});
