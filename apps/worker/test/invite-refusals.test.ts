import { afterEach, describe, expect, it, vi } from "vitest";
import { runCampaignTick } from "../src/jobs/campaign-tick.js";
import { runLinkedInAction } from "../src/jobs/linkedin-action.js";
import { ACCOUNT, HOUR, WORKSPACE, drain, harness, memoryQueue } from "./loop-harness.js";

/*
 * What a refused invitation leaves behind: who waits, for how long, who goes
 * next, and when a person is let go. Run against the loop as well as the send
 * path, because the failures here were all a loop that kept asking.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const RECENTLY =
  "422 errors/already_invited_recently: An invitation has already been sent recently to this recipient.";
const THROTTLED = "422 errors/cannot_resend_yet: You have reached a temporary provider limit. Please try again later.";

describe("a recipient LinkedIn keeps refusing", () => {
  it("is not re-asked every day for ever, and leaves the list with LinkedIn's reason", { timeout: 60_000 }, async () => {
    /*
     * The refusal put the row back with a flat day's wait and nothing counting.
     * LinkedIn keeps that block for weeks, so the same person was re-asked
     * every day — each a rejected request against the account.
     */
    vi.useFakeTimers();
    const start = new Date("2026-10-05T09:00:00Z");
    vi.setSystemTime(start);
    const { ctx, db, prospect, linkedin } = harness(start);
    const id = prospect();
    linkedin.invitationRefusal = RECENTLY;
    const attempts = vi.spyOn(linkedin, "sendInvitation");
    const { jobs, queues } = memoryQueue();

    for (let t = start.getTime(); t <= start.getTime() + 10 * 24 * HOUR; t += 30 * 60_000) {
      vi.setSystemTime(t);
      await runCampaignTick(db.asDb(), queues, new Date(t));
      await drain(ctx, jobs, undefined, t);
    }

    expect(attempts.mock.calls.length).toBeLessThanOrEqual(3);
    const row = db.find("campaign_prospects", { id })!;
    expect(row.status).toBe("closed");
    expect(String(row.status_reason)).toContain("invited recently");
    // Never contacted, so nothing about this stops a future campaign (rule 24).
    expect(db.rows("prospects")[0]?.last_contacted_at ?? null).toBeNull();
  });
});

describe("an account-wide refusal", () => {
  it("lets somebody else be the next invitation after the hold", async () => {
    /*
     * The row LinkedIn refused on was put back with no wait of its own, so it
     * was first in line again the moment the hold lifted: the same person was
     * the probe every time, refused every time.
     */
    vi.useFakeTimers();
    const now = new Date("2026-10-07T10:00:00Z");
    vi.setSystemTime(now);
    const { ctx, db, prospect, linkedin } = harness(now);
    const first = prospect();
    const second = prospect();
    linkedin.invitationRefusal = THROTTLED;

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: first });
    const until = Date.parse(db.find("linkedin_accounts", { id: ACCOUNT })!.invites_paused_until as string);
    linkedin.invitationRefusal = null;

    const after = new Date(until + 10 * 60_000);
    vi.setSystemTime(after);
    const { jobs, queues } = memoryQueue();
    await runCampaignTick(db.asDb(), queues, after);

    const invited = [...jobs.values()].filter((j) => j.data.kind === "invite").map((j) => j.data.campaignProspectId);
    expect(invited).toEqual([second]);
  });

  it("still starts the two-minute gap", async () => {
    // A refused request is a request; the next must not go straight after it.
    vi.useFakeTimers();
    const now = new Date("2026-10-07T10:00:00Z");
    vi.setSystemTime(now);
    const { ctx, db, prospect, linkedin } = harness(now);
    const id = prospect();
    linkedin.invitationRefusal = THROTTLED;

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.last_action_at).toBe(now.toISOString());
  });
});

describe("an invitation that went out after a refusal", () => {
  it("does not keep the refusal's words", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-07T10:00:00Z");
    vi.setSystemTime(now);
    const { ctx, db, prospect } = harness(now);
    const id = prospect({ status_reason: THROTTLED });

    await runLinkedInAction(ctx, { kind: "invite", workspaceId: WORKSPACE, campaignProspectId: id });

    const row = db.find("campaign_prospects", { id })!;
    expect(row.status).toBe("invited");
    expect(row.status_reason ?? null).toBeNull();
  });
});
