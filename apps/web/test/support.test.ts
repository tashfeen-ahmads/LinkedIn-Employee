import { describe, expect, it } from "vitest";
import { describeTicketContext } from "../src/lib/support";

/**
 * What a ticket tells the person answering it.
 *
 * Every failure this deployment hit was reported as a sentence — "I launched a
 * campaign and nothing happened" — that is true of four different problems. The
 * snapshot on the ticket exists so the operator does not have to ask which. The
 * thing that breaks it is a fact the snapshot did not capture being left off
 * the list, because an operator reading four facts and no mention of the
 * sending loop concludes the loop was running.
 */

const NOW = new Date("2026-09-18T12:00:00Z").getTime();

const FULL = {
  stuckOn: "launch",
  stuckOnLabel: "Launch your first campaign",
  linkedInStatus: "active",
  linkedInDetail: null,
  sendingLoopRunning: true,
  pacingBeatAt: "2026-09-18T11:58:00Z",
  workerBootAt: "2026-09-18T09:00:00Z",
  workerBuild: "abc1234def5678",
  raisedAt: "2026-09-18T12:00:00Z",
};

describe("describeTicketContext", () => {
  it("reads the four facts that decide which stage to look at", () => {
    const facts = describeTicketContext(FULL, NOW);
    expect(facts).toHaveLength(4);
    expect(facts[0]).toBe("Stuck on: Launch your first campaign");
    expect(facts[1]).toBe("LinkedIn: active");
    expect(facts[2]).toBe("Sending loop: running (last run 2m ago)");
    expect(facts[3]).toBe("Worker booted 3h ago on abc1234");
  });

  it("says a missing fact is missing rather than leaving it out", () => {
    // An empty snapshot is what a ticket raised against an older build carries,
    // and it must not read as a healthy workspace.
    const facts = describeTicketContext({}, NOW);
    expect(facts).toHaveLength(4);
    for (const fact of facts) expect(fact).toMatch(/not captured/);
  });

  it("distinguishes a loop that is not running from one nobody asked about", () => {
    // These were the same screen for eight hours. They are three different
    // things to do, so they are three different sentences.
    const stopped = describeTicketContext({ ...FULL, sendingLoopRunning: false }, NOW);
    expect(stopped[2]).toContain("NOT running");
    expect(stopped[2]).not.toMatch(/not captured/);

    const unknown = describeTicketContext({ ...FULL, sendingLoopRunning: null }, NOW);
    expect(unknown[2]).toBe("Sending loop: not captured");
  });

  it("never claims a loop ran when it has never run", () => {
    const facts = describeTicketContext({ ...FULL, sendingLoopRunning: false, pacingBeatAt: null }, NOW);
    expect(facts[2]).toBe("Sending loop: NOT running (never run)");
  });

  it("names an unknown build rather than implying the boot stamp carried one", () => {
    const facts = describeTicketContext({ ...FULL, workerBuild: null }, NOW);
    expect(facts[3]).toBe("Worker booted 3h ago, build unknown");
  });

  it("survives a context that is not an object at all", () => {
    // `context` is jsonb: a null, a string or an array can land in that column
    // and the operator console must still render.
    for (const raw of [null, undefined, "broken", [1, 2, 3], 7]) {
      const facts = describeTicketContext(raw, NOW);
      expect(facts).toHaveLength(4);
      expect(facts.every((f) => f.includes("not captured"))).toBe(true);
    }
  });

  it("carries the provider's own words about a disconnected account", () => {
    const facts = describeTicketContext(
      { ...FULL, linkedInStatus: "reauth_required", linkedInDetail: "Checkpoint required" },
      NOW,
    );
    expect(facts[1]).toBe("LinkedIn: reauth required — Checkpoint required");
  });
});
