import { describe, expect, it } from "vitest";
import { FUNNEL_STAGES, MIN_FOR_RATE, countFunnel, funnelRates } from "../src/funnel.js";

describe("countFunnel", () => {
  it("counts a prospect at every stage they have passed, not just their current one", () => {
    // Status is one current state. Counting only exact matches would drop a
    // replied prospect out of "accepted" and inflate every rate.
    const counts = countFunnel(["replied"]);
    expect(counts.invited).toBe(1);
    expect(counts.accepted).toBe(1);
    expect(counts.replied).toBe(1);
    expect(counts.positive).toBe(0);
  });

  it("does not count someone still queued as invited", () => {
    expect(countFunnel(["queued"]).invited).toBe(0);
  });

  it("counts a booked meeting at every stage including its own", () => {
    const counts = countFunnel(["meeting_booked"]);
    for (const stage of FUNNEL_STAGES) expect(counts[stage.key], stage.key).toBe(1);
  });

  it("counts a negative reply as replied but never as positive", () => {
    const counts = countFunnel(["negative"]);
    expect(counts.replied).toBe(1);
    expect(counts.positive).toBe(0);
  });

  it("never lets a later stage exceed an earlier one", () => {
    const mixed = ["queued", "invited", "accepted", "messaged_2", "replied", "negative", "positive", "meeting_booked"];
    const counts = countFunnel(mixed);
    expect(counts.invited).toBeGreaterThanOrEqual(counts.accepted);
    expect(counts.accepted).toBeGreaterThanOrEqual(counts.replied);
    expect(counts.replied).toBeGreaterThanOrEqual(counts.positive);
    expect(counts.positive).toBeGreaterThanOrEqual(counts.meetings);
  });

  it("ignores statuses that never entered the funnel", () => {
    expect(countFunnel(["opted_out", "failed", "closed"]).invited).toBe(0);
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
