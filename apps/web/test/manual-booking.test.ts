import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FakeDb } from "../../worker/test/fake-db";
import { recordManualBooking } from "../src/lib/manual-booking";

/**
 * "I have booked it" on a booking hold.
 *
 * It only cleared the hold, so the meetings a rep booked by hand — exactly the
 * ones the automatic path could not — were counted by neither the funnel
 * (`meeting_booked`) nor the reports (`meeting.booked`).
 */
const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function seeded(status = "positive") {
  const db = new FakeDb();
  db.seed("conversations", [
    { id: "conv-1", workspace_id: WORKSPACE, prospect_id: "p-1", campaign_id: "camp-1", needs_human: true, needs_human_kind: "booking" },
  ]);
  db.seed("campaign_prospects", [
    { id: "cp-1", workspace_id: WORKSPACE, campaign_id: "camp-1", prospect_id: "p-1", status },
    // The same person on another campaign is not this booking.
    { id: "cp-2", workspace_id: WORKSPACE, campaign_id: "camp-2", prospect_id: "p-1", status: "replied" },
  ]);
  return db;
}

const input = { workspaceId: WORKSPACE, conversationId: "conv-1", userId: USER };

describe("recordManualBooking", () => {
  it("counts the meeting where the funnel and the reports read it", async () => {
    const db = seeded();

    const result = await recordManualBooking(db.asDb(), input);

    expect(result).toEqual({ ok: true, counted: true });
    expect(db.find("campaign_prospects", { id: "cp-1" })?.status).toBe("meeting_booked");
    expect(db.find("campaign_prospects", { id: "cp-2" })?.status).toBe("replied");
    const events = db.rows("events").filter((e) => e.name === "meeting.booked");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ manual: true });
    // No invented start time blocking a real slot on the rep's calendar.
    expect(db.rows("meetings")).toHaveLength(0);
  });

  it("counts it once when pressed twice", async () => {
    const db = seeded();

    await recordManualBooking(db.asDb(), input);
    const second = await recordManualBooking(db.asDb(), input);

    expect(second).toEqual({ ok: true, counted: false });
    expect(db.rows("events").filter((e) => e.name === "meeting.booked")).toHaveLength(1);
  });

  it("never walks an opt-out forward into a booking", async () => {
    const db = seeded("opted_out");

    await recordManualBooking(db.asDb(), input);

    expect(db.find("campaign_prospects", { id: "cp-1" })?.status).toBe("opted_out");
    expect(db.rows("events")).toHaveLength(0);
  });

  it("refuses a conversation in another workspace", async () => {
    const db = seeded();

    const result = await recordManualBooking(db.asDb(), { ...input, workspaceId: "other" });

    expect(result.ok).toBe(false);
    expect(db.find("campaign_prospects", { id: "cp-1" })?.status).toBe("positive");
  });
});

describe("the inbox's Mark booked", () => {
  it("records the booking before it clears the hold", () => {
    const page = readFileSync(join(__dirname, "../src/app/app/inbox/page.tsx"), "utf8");
    const start = page.indexOf("async function markBooked");
    const action = page.slice(start, page.indexOf("\nasync function", start + 10));
    const recorded = action.indexOf("recordManualBooking(");
    expect(recorded).toBeGreaterThan(-1);
    expect(recorded).toBeLessThan(action.indexOf("clearConversationHold("));
  });
});
