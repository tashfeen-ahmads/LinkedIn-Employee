import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPPORTUNITY_STAGES, opportunityStageOf, replyIntentOf } from "../src/app/app/opportunities/stage";

/**
 * The opportunities board's columns, read from what the inbox already reads.
 *
 * The board is a second screen over the same conversations as the inbox's
 * stage tabs, and two readings of "who has replied" drift: the board would
 * show somebody the inbox does not, or lose somebody it does. So the board
 * builds on `inboxStageOf` rather than beside it, and these pin the
 * distinctions it adds on top.
 */
const replied = { status: "replied", invited_at: "2026-10-01T10:00:00Z", accepted_at: "2026-10-02T10:00:00Z", replied_at: "2026-10-03T10:00:00Z", last_step_sent: 1 };
const said = (intent: string, body: string) => ({ classification: { intent, sentiment: "neutral", confidence: 0.9 }, body });

describe("who is on the board at all", () => {
  it("leaves off everybody the inbox does not count as replied or booked", () => {
    expect(opportunityStageOf({ status: "queued" })).toBeNull();
    expect(opportunityStageOf({ status: "invited", invited_at: replied.invited_at })).toBeNull();
    expect(opportunityStageOf({ status: "accepted", invited_at: replied.invited_at, accepted_at: replied.accepted_at })).toBeNull();
    expect(opportunityStageOf({ status: "messaged_2", invited_at: replied.invited_at, last_step_sent: 2 })).toBeNull();
    // Closed without ever answering: written to, never an opportunity.
    expect(opportunityStageOf({ status: "closed", invited_at: replied.invited_at, last_step_sent: 3 })).toBeNull();
  });

  it("puts a plain answer under Replied", () => {
    expect(opportunityStageOf(replied)).toBe("replied");
    expect(opportunityStageOf(replied, said("question", "What does it cost for a team of five?"))).toBe("replied");
  });
});

describe("the columns", () => {
  it("reads a meeting as booked, however it was made", () => {
    expect(opportunityStageOf({ ...replied, status: "meeting_booked" })).toBe("booked");
    // A meeting booked by hand from a held conversation may have no reply stamp.
    expect(opportunityStageOf({ status: "meeting_booked" })).toBe("booked");
  });

  it("reads the worker's recorded interest as Interested", () => {
    expect(opportunityStageOf({ ...replied, status: "positive" })).toBe("interested");
    expect(opportunityStageOf(replied, said("interested", "Yes, send it over"))).toBe("interested");
  });

  it("closes every ended row that had answered, an opt-out included", () => {
    for (const status of ["negative", "closed", "failed", "opted_out"]) {
      expect(opportunityStageOf({ ...replied, status }), status).toBe("closed");
    }
    // Ended outranks whatever their last message said.
    expect(opportunityStageOf({ ...replied, status: "opted_out" }, said("interested", "Sounds great"))).toBe("closed");
  });

  it("reads a not-yet the way the reply agent reads it, words over a warm label", () => {
    expect(opportunityStageOf(replied, said("not_now", "Maybe next quarter"))).toBe("not_now");
    // Rule 66: the classifier said interested at 0.86; the words say not yet.
    const convince = said("interested", "When I can convince the owner we can start looking at systems");
    expect(replyIntentOf(convince)).toBe("not_now");
    expect(opportunityStageOf(replied, convince)).toBe("not_now");
    // A later not-yet outranks an earlier yes.
    expect(opportunityStageOf({ ...replied, status: "positive" }, said("not_now", "Not right now, check back in spring"))).toBe("not_now");
  });

  it("ignores an intent nothing recorded, or one it does not know", () => {
    expect(replyIntentOf(null)).toBeNull();
    expect(replyIntentOf({ classification: null, body: "hi" })).toBeNull();
    expect(replyIntentOf({ classification: { intent: "keen" }, body: "hi" })).toBeNull();
    expect(opportunityStageOf(replied, { classification: { intent: "keen" }, body: "hi" })).toBe("replied");
  });

  it("orders the open columns first and folds Not now and Closed away", () => {
    expect(OPPORTUNITY_STAGES.map((s) => s.key)).toEqual(["replied", "interested", "booked", "not_now", "closed"]);
    expect(OPPORTUNITY_STAGES.filter((s) => s.collapsed).map((s) => s.key)).toEqual(["not_now", "closed"]);
  });
});

describe("one reading, not two", () => {
  const SRC = join(__dirname, "..", "src");
  const stage = readFileSync(join(SRC, "app", "app", "opportunities", "stage.ts"), "utf8");
  const page = readFileSync(join(SRC, "app", "app", "opportunities", "page.tsx"), "utf8");

  it("builds on the inbox's stage reading and the reply agent's intent", () => {
    expect(stage).toMatch(/const reached = inboxStageOf\(row\);/);
    expect(stage).toMatch(/return effectiveIntent\(parsed\.data, reply\.body \?\? ""\);/);
  });

  it("places every card through it, and is read-only", () => {
    expect(page).toMatch(/const stage = opportunityStageOf\(row, latest\);/);
    // A board that moved cards would change a label the agent never reads.
    expect(page).not.toMatch(/"use server"/);
    expect(page).not.toMatch(/\.update\(|\.insert\(|\.delete\(/);
  });

  it("hides Meeting booked only where no campaign can reach it (rule 29)", () => {
    expect(page).toMatch(/asksForMeetings \|\| \(cards\.get\("booked"\)\?\.length \?\? 0\) > 0/);
  });
});
