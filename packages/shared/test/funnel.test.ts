import { describe, expect, it } from "vitest";
import { FUNNEL_STAGES, MIN_FOR_RATE, countFunnel, funnelRates } from "../src/funnel.js";

describe("countFunnel", () => {
  it("counts a prospect at every stage they have passed, not just their current one", () => {
    // Status is one current state. Counting only exact matches would drop a
    // replied prospect out of "accepted" and inflate every rate.
    const counts = countFunnel([{ status: "replied" }]);
    expect(counts.invited).toBe(1);
    expect(counts.accepted).toBe(1);
    expect(counts.replied).toBe(1);
    expect(counts.positive).toBe(0);
  });

  it("does not count someone still queued as invited", () => {
    expect(countFunnel([{ status: "queued" }]).invited).toBe(0);
  });

  it("counts a booked meeting at every stage including its own", () => {
    const counts = countFunnel([{ status: "meeting_booked" }]);
    for (const stage of FUNNEL_STAGES) expect(counts[stage.key], stage.key).toBe(1);
  });

  it("counts a negative reply as replied but never as positive", () => {
    const counts = countFunnel([{ status: "negative" }]);
    expect(counts.replied).toBe(1);
    expect(counts.positive).toBe(0);
  });

  it("never lets a later stage exceed an earlier one", () => {
    const mixed = ["queued", "invited", "accepted", "messaged_2", "replied", "negative", "positive", "meeting_booked"];
    const counts = countFunnel(mixed.map((status) => ({ status })));
    expect(counts.invited).toBeGreaterThanOrEqual(counts.accepted);
    expect(counts.accepted).toBeGreaterThanOrEqual(counts.replied);
    expect(counts.replied).toBeGreaterThanOrEqual(counts.positive);
    expect(counts.positive).toBeGreaterThanOrEqual(counts.meetings);
  });

  it("ignores a prospect who never entered the funnel at all", () => {
    // Closed during review, or an invitation the provider refused: no
    // timestamp, so nothing happened to them.
    const counts = countFunnel([{ status: "failed" }, { status: "closed" }]);
    expect(counts.invited).toBe(0);
  });

  it("keeps counting someone whose invitation was withdrawn", () => {
    // The bug this replaced: the maintenance sweep closes an expired
    // invitation, the status stops saying "invited", and the rep's invited
    // count silently falls. It happened; the timestamp says so.
    const counts = countFunnel([
      { status: "closed", invited_at: "2026-08-01T09:00:00Z" },
    ]);
    expect(counts.invited).toBe(1);
    expect(counts.accepted).toBe(0);
  });

  it("keeps counting someone who accepted and then opted out", () => {
    const counts = countFunnel([
      {
        status: "opted_out",
        invited_at: "2026-08-01T09:00:00Z",
        accepted_at: "2026-08-03T09:00:00Z",
        replied_at: "2026-08-04T09:00:00Z",
      },
    ]);
    expect(counts.invited).toBe(1);
    expect(counts.accepted).toBe(1);
    expect(counts.replied).toBe(1);
    expect(counts.positive).toBe(0);
  });

  it("reads the stage off the status when a row has no timestamps", () => {
    // Rows written before those columns were filled in, and the demo seed.
    // Nothing here says invited or accepted except where the prospect stands.
    const counts = countFunnel([{ status: "messaged_2" }]);
    expect(counts.invited).toBe(1);
    expect(counts.accepted).toBe(1);
    expect(counts.replied).toBe(0);
  });

  it("infers an acceptance from a reply even when the status has moved on", () => {
    // Excluded after replying: status says closed, no accepted_at was ever
    // written, and replying is still proof they accepted.
    const counts = countFunnel([
      { status: "closed", invited_at: "2026-08-01T09:00:00Z", replied_at: "2026-08-02T09:00:00Z" },
    ]);
    expect(counts.invited).toBe(1);
    expect(counts.accepted).toBe(1);
    expect(counts.replied).toBe(1);
  });

  it("counts an acceptance we only learned about from their reply", () => {
    // They accepted and messaged before the nightly connection check ran, so
    // accepted_at was never set. Replying proves they accepted.
    const counts = countFunnel([
      { status: "replied", invited_at: "2026-08-01T09:00:00Z", replied_at: "2026-08-02T09:00:00Z" },
    ]);
    expect(counts.accepted).toBe(1);
  });

  it("stays monotonic even when the data disagrees with itself", () => {
    // A booked meeting with no invitation timestamp at all should still count
    // once at every earlier stage rather than producing a funnel that widens.
    const counts = countFunnel([{ status: "meeting_booked" }]);
    expect(counts.invited).toBe(1);
    expect(counts.accepted).toBe(1);
  });
});

describe("funnelRates", () => {
  it("computes both rates once there is enough to judge", () => {
    const rates = funnelRates({ invited: 100, accepted: 40, replied: 8, positive: 3, meetings: 2 });
    expect(rates.acceptance).toBeCloseTo(0.4);
    expect(rates.reply).toBeCloseTo(0.2);
  });

  it("withholds a rate rather than showing a misleading zero", () => {
    // Three invitations out is too early to have an acceptance rate; 0% would
    // read as failure rather than as not yet knowing.
    const rates = funnelRates({ invited: 3, accepted: 0, replied: 0, positive: 0, meetings: 0 });
    expect(rates.acceptance).toBeNull();
    expect(rates.reply).toBeNull();
  });

  it("starts reporting exactly at the threshold", () => {
    const rates = funnelRates({ invited: MIN_FOR_RATE, accepted: 3, replied: 0, positive: 0, meetings: 0 });
    expect(rates.acceptance).toBeCloseTo(0.3);
  });

  it("judges reply rate against accepted, not against invited", () => {
    // A rep whose invitations are ignored should not also look bad at replies.
    const rates = funnelRates({ invited: 200, accepted: 20, replied: 10, positive: 4, meetings: 2 });
    expect(rates.reply).toBeCloseTo(0.5);
  });
});
