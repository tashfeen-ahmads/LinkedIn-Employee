import { describe, expect, it } from "vitest";
import {
  FUNNEL_STAGES,
  MIN_FOR_RATE,
  WEEK_MS,
  dailySends,
  funnelReport,
  momentum,
  rate,
  stagesForGoals,
  type DatedFunnelRow,
} from "../src/index.js";

/**
 * What a dashboard is allowed to claim.
 *
 * Each of these was wrong on a screen somebody read: a permanent "Meetings 0"
 * on a workspace that only ever sends links, a 0% acceptance rate computed from
 * three invitations, and five lifetime totals that look identical whether the
 * system sent fifty people yesterday or stopped a fortnight ago.
 */

const NOW = new Date("2026-09-18T12:00:00Z").getTime();

describe("stagesForGoals", () => {
  it("keeps meetings only when some campaign is asking for one", () => {
    expect(stagesForGoals(["meeting"]).map((s) => s.key)).toContain("meetings");
    expect(stagesForGoals(["link"]).map((s) => s.key)).not.toContain("meetings");
    expect(stagesForGoals(["reply"]).map((s) => s.key)).not.toContain("meetings");
  });

  it("keeps meetings when only one campaign of several asks for one", () => {
    // The union, not the intersection: dropping the stage because two of three
    // campaigns cannot reach it would hide the third campaign's actual result.
    expect(stagesForGoals(["link", "reply", "meeting"]).map((s) => s.key)).toContain("meetings");
  });

  it("shows the whole funnel before any campaign exists", () => {
    // An empty dashboard is a preview of what this will say. Cutting it to the
    // stages of nothing makes the page rearrange itself the moment somebody
    // builds their first campaign.
    expect(stagesForGoals([])).toEqual(FUNNEL_STAGES);
  });

  it("returns stages in the funnel's own order however the goals arrive", () => {
    const keys = stagesForGoals(["meeting", "link"]).map((s) => s.key);
    expect(keys).toEqual(FUNNEL_STAGES.map((s) => s.key));
  });
});

describe("rate", () => {
  it("refuses to call a rate from too small a sample", () => {
    const r = rate(0, MIN_FOR_RATE - 1, 0.3);
    expect(r.value).toBeNull();
    expect(r.verdict).toBe("too-early");
  });

  it("does not report a new account as failing", () => {
    // Three invitations and no acceptance yet is a Tuesday morning, not a
    // broken account. It used to render "0.0%" under a 30% target.
    expect(rate(0, 3, 0.3).verdict).toBe("too-early");
    expect(rate(0, 3, 0.3).verdict).not.toBe("below");
  });

  it("calls it once the sample is big enough", () => {
    expect(rate(4, 10, 0.3).verdict).toBe("on-target");
    expect(rate(2, 10, 0.3).verdict).toBe("below");
    expect(rate(3, 10, 0.3).verdict).toBe("on-target"); // exactly on target is on target
  });

  it("carries the raw numbers so a screen never recomputes them", () => {
    const r = rate(7, 25, 0.3);
    expect(r.numerator).toBe(7);
    expect(r.denominator).toBe(25);
    expect(r.target).toBe(0.3);
  });
});

describe("momentum", () => {
  const invitedAt = (daysAgo: number): DatedFunnelRow => ({
    status: "invited",
    invited_at: new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  });

  it("counts this week and the week before it separately", () => {
    const rows = [invitedAt(1), invitedAt(3), invitedAt(9), invitedAt(10), invitedAt(11)];
    const m = momentum(rows, NOW, WEEK_MS);
    expect(m.current).toBe(2);
    expect(m.previous).toBe(3);
    expect(m.change).toBeCloseTo(-1 / 3);
  });

  it("says there is no baseline rather than inventing a percentage", () => {
    // Dividing by a week that sent nothing is not "up 100%", it is a number
    // made out of an empty denominator.
    const m = momentum([invitedAt(1), invitedAt(2)], NOW, WEEK_MS);
    expect(m.previous).toBe(0);
    expect(m.change).toBeNull();
  });

  it("ignores anything older than the two windows", () => {
    expect(momentum([invitedAt(60)], NOW, WEEK_MS)).toEqual({
      current: 0,
      previous: 0,
      change: null,
    });
  });

  it("ignores a row that was never invited", () => {
    // A queued prospect has no invited_at. Counting them would report a
    // campaign as sending on a day it sent nobody.
    //
    // Tested against a window wide enough to contain the epoch, because
    // `new Date(null)` is 1970 rather than an error: with a seven-day window
    // that lands outside by accident, and a test written that way passes
    // whether the guard is there or not. Widen the window and the accident
    // disappears — which is also the latent bug, since any caller asking
    // momentum for an all-time window would have counted every queued prospect
    // as having been invited in 1970.
    const wide = NOW + 1;
    expect(momentum([{ status: "queued", invited_at: null }], NOW, wide).current).toBe(0);
    expect(momentum([{ status: "queued" }], NOW, wide).current).toBe(0);
  });

  it("survives an unparseable timestamp rather than counting it as now", () => {
    const m = momentum([{ status: "invited", invited_at: "not a date" }], NOW, WEEK_MS);
    expect(m.current).toBe(0);
    expect(m.previous).toBe(0);
  });

  it("counts a row on the boundary exactly once", () => {
    const onBoundary: DatedFunnelRow = {
      status: "invited",
      invited_at: new Date(NOW - WEEK_MS).toISOString(),
    };
    const m = momentum([onBoundary], NOW, WEEK_MS);
    expect(m.current + m.previous).toBe(1);
  });
});

describe("funnelReport", () => {
  it("ties the counts, the stages and the rates to one set of rows", () => {
    const rows: DatedFunnelRow[] = Array.from({ length: 12 }, (_, i) => ({
      status: i < 5 ? "accepted" : "invited",
      invited_at: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(),
    }));

    const report = funnelReport(rows, ["link"], NOW);
    expect(report.counts.invited).toBe(12);
    expect(report.counts.accepted).toBe(5);
    expect(report.stages.map((s) => s.key)).not.toContain("meetings");
    expect(report.acceptance.verdict).toBe("on-target"); // 5/12 = 41.7%
    // Twelve accepted-or-invited but only five accepted: the reply denominator
    // is below the floor, so there is no reply rate yet.
    expect(report.reply.verdict).toBe("too-early");
    expect(report.momentum.current).toBe(12);
  });
});

describe("dailySends", () => {
  const at = (daysAgo: number): DatedFunnelRow => ({
    status: "invited",
    invited_at: new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  });

  it("includes the days nothing went out", () => {
    // The zero days are the point. Dropping them joins Friday to Monday with a
    // straight line and draws a weekend that looks like steady sending, on the
    // one chart that exists to answer "did anything leave yesterday".
    const series = dailySends([at(1), at(1), at(4)], NOW, 7);
    expect(series).toHaveLength(7);
    expect(series.filter((d) => d.value === 0)).toHaveLength(5);
    expect(series.reduce((sum, d) => sum + d.value, 0)).toBe(3);
  });

  it("ends on today and starts a window ago", () => {
    const series = dailySends([], NOW, 30);
    expect(series).toHaveLength(30);
    expect(series[29]!.date).toBe(new Date(NOW).toISOString().slice(0, 10));
  });

  it("leaves anything older than the window out entirely", () => {
    // Not clamped into the first bucket: a prospect invited last year must not
    // appear as a spike on the oldest day in view.
    const series = dailySends([at(400)], NOW, 30);
    expect(series.every((d) => d.value === 0)).toBe(true);
  });

  it("ignores a row that was never invited", () => {
    const series = dailySends([{ status: "queued", invited_at: null }], NOW, 7);
    expect(series.every((d) => d.value === 0)).toBe(true);
  });
});
