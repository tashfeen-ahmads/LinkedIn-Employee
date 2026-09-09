import { describe, expect, it } from "vitest";
import { matchOfferedSlot } from "../src/jobs/booking.js";

// Tuesday 14:00, Wednesday 10:00, Friday 16:00 — all UTC.
const OFFERED = ["2026-09-08T14:00:00Z", "2026-09-09T10:00:00Z", "2026-09-11T16:00:00Z"];

describe("matchOfferedSlot", () => {
  it("matches an ordinal reference", () => {
    expect(matchOfferedSlot("The second one works for me", OFFERED, "UTC")).toBe(OFFERED[1]);
    expect(matchOfferedSlot("let's do option 3", OFFERED, "UTC")).toBe(OFFERED[2]);
  });

  it("matches a weekday", () => {
    expect(matchOfferedSlot("Wednesday works, thanks", OFFERED, "UTC")).toBe(OFFERED[1]);
  });

  it("matches a weekday with an explicit time", () => {
    expect(matchOfferedSlot("Friday at 4pm sounds good", OFFERED, "UTC")).toBe(OFFERED[2]);
  });

  it("refuses to book when the acceptance is ambiguous", () => {
    expect(matchOfferedSlot("The first or the second both work", OFFERED, "UTC")).toBeNull();
  });

  it("refuses a time we never offered", () => {
    expect(matchOfferedSlot("Can we do Monday at 9am instead?", OFFERED, "UTC")).toBeNull();
  });

  it("refuses a weekday mention that is not an acceptance", () => {
    expect(matchOfferedSlot("I am travelling all Wednesday", OFFERED, "UTC")).toBeNull();
  });

  it("refuses when a stated hour does not match the offered slot", () => {
    expect(matchOfferedSlot("Wednesday at 3pm works", OFFERED, "UTC")).toBeNull();
  });

  it("refuses a declined slot that happens to contain acceptance words", () => {
    // "doesn't work for me" contains "work for me". Booking here would put the
    // rep in a meeting the prospect believes they refused.
    expect(matchOfferedSlot("Tuesday doesn't work for me", OFFERED, "UTC")).toBeNull();
    expect(matchOfferedSlot("Wednesday won't work, sorry", OFFERED, "UTC")).toBeNull();
    expect(matchOfferedSlot("Friday is no good, can we do another time?", OFFERED, "UTC")).toBeNull();
  });

  it("refuses a counter-proposal on an offered day", () => {
    expect(matchOfferedSlot("Wednesday works but could we do 11 instead?", OFFERED, "UTC")).toBeNull();
  });

  it("compares minutes, not just the hour", () => {
    // 2026-09-11T16:00Z was offered; 4:30 is a different time.
    expect(matchOfferedSlot("Friday at 4:30pm works", OFFERED, "UTC")).toBeNull();
    expect(matchOfferedSlot("Friday at 4:00pm works", OFFERED, "UTC")).toBe(OFFERED[2]);
  });

  it("books nothing when no slots were offered", () => {
    expect(matchOfferedSlot("Yes, that works", [], "UTC")).toBeNull();
  });

  it("refuses when several options are named at once, even alongside a day", () => {
    // "Either of the first two, say Wednesday" is a loose acceptance, not a
    // choice. Booking one of them guesses on the prospect's behalf.
    // "works" is what makes this read as an acceptance at all; without it the
    // message is rejected earlier and the test would prove nothing.
    expect(matchOfferedSlot("Either the first or the second works, Wednesday?", OFFERED, "UTC")).toBeNull();
  });

  it("reads the day in the rep's time zone, not UTC", () => {
    // 2026-09-08T02:00Z is still Monday evening in Los Angeles.
    const lateSlots = ["2026-09-08T02:00:00Z"];
    expect(matchOfferedSlot("Monday works", lateSlots, "America/Los_Angeles")).toBe(lateSlots[0]);
    expect(matchOfferedSlot("Monday works", lateSlots, "UTC")).toBeNull();
  });
});

describe("tryBookMeeting", () => {
  const WORKSPACE = "11111111-1111-4111-8111-111111111111";
  const USER = "22222222-2222-4222-8222-222222222222";
  const PROSPECT = "55555555-5555-4555-8555-555555555555";
  const CONVERSATION = "66666666-6666-4666-8666-666666666666";

  async function harness() {
    const { FakeDb } = await import("./fake-db.js");
    const { MockCalendarProvider } = await import("@le/calendar");
    const db = new FakeDb();

    db.seed("profiles", [{ id: USER, full_name: "Sam Patel", email: "sam@acme.test" }]);
    db.seed("prospects", [
      {
        id: PROSPECT,
        workspace_id: WORKSPACE,
        linkedin_url: "linkedin.com/in/jane",
        first_name: "Jane",
        last_name: "Doe",
        company: "Northwind",
      },
    ]);
    db.seed("campaign_prospects", [
      { workspace_id: WORKSPACE, campaign_id: "camp", prospect_id: PROSPECT, status: "replied" },
    ]);

    const calendar = new MockCalendarProvider();
    const ctx = { db: db.asDb() } as never;
    return {
      db,
      ctx,
      calendar,
      binding: { provider: calendar, accessToken: "mock", timezone: "UTC" },
    };
  }

  const base = (binding: unknown) => ({
    workspaceId: WORKSPACE,
    conversationId: CONVERSATION,
    prospectId: PROSPECT,
    repUserId: USER,
    message: "Tuesday at 2pm works",
    binding: binding as never,
    durationMinutes: 30,
  });

  it("books an accepted slot and marks the prospect as booked", async () => {
    const { db, ctx, calendar, binding } = await harness();
    const { tryBookMeeting } = await import("../src/jobs/booking.js");

    const id = await tryBookMeeting(ctx, { ...base(binding), offeredSlots: ["2026-09-08T14:00:00Z"] });

    expect(id).toBeTruthy();
    expect(calendar.created).toHaveLength(1);
    expect(db.rows("meetings")).toHaveLength(1);
    expect(db.rows("campaign_prospects")[0]?.status).toBe("meeting_booked");
  });

  it("writes nothing at all when no slots were offered", async () => {
    const { db, ctx, calendar, binding } = await harness();
    const { tryBookMeeting } = await import("../src/jobs/booking.js");

    // Nothing was proposed, so nothing can have been accepted — however
    // enthusiastic the message sounds.
    const id = await tryBookMeeting(ctx, { ...base(binding), offeredSlots: [] });

    expect(id).toBeNull();
    expect(calendar.created).toHaveLength(0);
    expect(db.rows("meetings")).toHaveLength(0);
    expect(db.rows("campaign_prospects")[0]?.status).toBe("replied");
  });

  it("books only the offered slot, never a time from the message", async () => {
    const { calendar, ctx, binding } = await harness();
    const { tryBookMeeting } = await import("../src/jobs/booking.js");

    await tryBookMeeting(ctx, {
      ...base(binding),
      message: "Tuesday at 2pm works",
      offeredSlots: ["2026-09-08T14:00:00Z"],
    });

    expect(calendar.created[0]?.startsAt).toBe("2026-09-08T14:00:00Z");
  });

  it("hands the conversation to a human when the calendar write fails", async () => {
    const { db, ctx, binding } = await harness();
    const { tryBookMeeting } = await import("../src/jobs/booking.js");
    db.seed("conversations", [{ id: CONVERSATION, workspace_id: WORKSPACE, prospect_id: PROSPECT }]);
    binding.provider.createMeeting = async () => {
      throw new Error("calendar unavailable");
    };

    const id = await tryBookMeeting(ctx, { ...base(binding), offeredSlots: ["2026-09-08T14:00:00Z"] });

    // A booked meeting that never reached the calendar must not vanish quietly.
    expect(id).toBeNull();
    const conversation = db.find("conversations", { id: CONVERSATION })!;
    expect(conversation.needs_human).toBe(true);
    // Marked as a booking, so the reply that goes out moments later does not
    // clear it. Nothing else says the meeting is in nobody's diary.
    expect(conversation.needs_human_kind).toBe("booking");
  });
});
