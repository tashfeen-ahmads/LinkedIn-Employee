import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchOfferedSlot } from "../src/jobs/booking.js";
import { DEFAULT_BOOKING_RULES } from "../src/calendar.js";

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
  // Monday morning before the week the slots below fall in. The booking path
  // asks whether an offered time is still free, and a time in the past never
  // is — so the clock is pinned rather than left to drift past the fixtures.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-07T09:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const WORKSPACE = "11111111-1111-4111-8111-111111111111";
  const USER = "22222222-2222-4222-8222-222222222222";
  const PROSPECT = "55555555-5555-4555-8555-555555555555";
  const CONVERSATION = "66666666-6666-4666-8666-666666666666";

  async function harness(options: { email?: boolean } = {}) {
    const { FakeDb } = await import("./fake-db.js");
    const { MockCalendarProvider } = await import("@le/calendar");
    const { MockEmailProvider } = await import("@le/email");
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
    const email = options.email ? new MockEmailProvider() : null;
    const ctx = { db: db.asDb(), email, env: { APP_URL: "https://app.test" } } as never;
    return {
      db,
      ctx,
      calendar,
      email,
      binding: {
        provider: calendar,
        accessToken: "mock",
        timezone: "UTC",
        rules: DEFAULT_BOOKING_RULES,
        ownOnly: false,
        repSettings: false,
        bookedStarts: [] as string[],
      },
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
    db.seed("conversations", [{ id: CONVERSATION, workspace_id: WORKSPACE, prospect_id: PROSPECT, needs_human: false }]);

    // Nothing was proposed, so nothing can have been accepted — however
    // enthusiastic the message sounds.
    const id = await tryBookMeeting(ctx, { ...base(binding), offeredSlots: [] });

    expect(id).toBeNull();
    expect(calendar.created).toHaveLength(0);
    expect(db.rows("meetings")).toHaveLength(0);
    expect(db.rows("campaign_prospects")[0]?.status).toBe("replied");
    // Nor any hold: there was no acceptance to honour, so there is nothing for
    // a person to book by hand.
    expect(db.find("conversations", { id: CONVERSATION })?.needs_human).toBe(false);
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

  it("emails the rep about their first booked meeting, quoting the prospect", async () => {
    const { ctx, email, binding } = await harness({ email: true });
    const { tryBookMeeting } = await import("../src/jobs/booking.js");

    await tryBookMeeting(ctx, {
      ...base(binding),
      message: "Tuesday at 2pm works, see you then",
      offeredSlots: ["2026-09-08T14:00:00Z"],
    });

    expect(email!.sent).toHaveLength(1);
    expect(email!.sent[0]?.subject).toBe("Meeting booked with Jane Doe");
    // Their own words, not a summary of them.
    expect(email!.sent[0]?.text).toContain("Tuesday at 2pm works, see you then");
    // The time as the calendar package formats it, in the rep's timezone —
    // this email must never disagree with the one the prospect was sent.
    expect(email!.sent[0]?.text).toContain("Tuesday, September 8");
  });

  it("emails about the first meeting only, never the second", async () => {
    // A working product that emails on every booking has made itself into a
    // thing people filter. The digest carries the rest.
    const { db, ctx, email, binding } = await harness({ email: true });
    const { tryBookMeeting } = await import("../src/jobs/booking.js");

    await tryBookMeeting(ctx, { ...base(binding), offeredSlots: ["2026-09-08T14:00:00Z"] });
    db.seed("campaign_prospects", [
      { workspace_id: WORKSPACE, campaign_id: "camp", prospect_id: PROSPECT, status: "replied" },
    ]);
    await tryBookMeeting(ctx, {
      ...base(binding),
      message: "Wednesday at 10am works",
      offeredSlots: ["2026-09-09T10:00:00Z"],
    });

    expect(db.rows("meetings")).toHaveLength(2);
    expect(email!.sent).toHaveLength(1);
  });
});

/**
 * The acceptance matcher, case by case.
 *
 * Every row is a sentence a real prospect could send in answer to three
 * offered times. The rule underneath all of them is rule 6: we book a time we
 * offered, exactly, or we book nothing. The matcher this replaced read the
 * first number in a message and compared minutes against a part it never
 * asked the formatter for, so "Wednesday at 9:30" booked nothing and
 * "Wednesday at 9" booked the 9:30 — a time the prospect never wrote.
 */
describe("matchOfferedSlot reads the time a prospect actually wrote", () => {
  // Wednesday 9:30, Thursday 10:00, Friday 14:00 — UTC.
  const WED = "2026-10-07T09:30:00Z";
  const THU = "2026-10-08T10:00:00Z";
  const FRI = "2026-10-09T14:00:00Z";
  const SLOTS = [WED, THU, FRI];

  const cases: Array<[string, string | null]> = [
    ["Wednesday at 9:30 works", WED],
    ["Wednesday at 9 works", null],
    ["Wednesday 9 works", null],
    ["Wed 9:30am works", WED],
    ["9:30 works for me", WED],
    ["Thursday, October 8 at 10:00 AM works for me", THU],
    ["Let's do Thursday, October 8 at 10:00 AM UTC", THU],
    ["Thursday at 10am works", THU],
    ["Thursday at 10:30 works", null],
    ["Thursday the 8th at 10 works", THU],
    ["October 8th works", THU],
    ["Friday at 2pm works", FRI],
    ["Friday at 2 works", FRI],
    ["Friday at 14:00 works", FRI],
    ["Friday at 3pm works", null],
    ["Wednesday or Thursday works", null],
    ["Tomorrow at 10 works", null],
    ["Option 2 works", THU],
    ["The second one works, Thursday", THU],
    ["The first one works, Thursday", null],
    ["Sounds good", null],
  ];

  for (const [message, expected] of cases) {
    it(`${JSON.stringify(message)} → ${expected ?? "nothing"}`, () => {
      expect(matchOfferedSlot(message, SLOTS, "UTC")).toBe(expected);
    });
  }

  it("matches each slot quoted back in exactly the form we sent it", async () => {
    // `formatSlot` is what the prospect read. Pasting it back is the most
    // literal acceptance there is, and it failed for every slot we offered.
    const { formatSlot } = await import("@le/calendar");
    for (const slot of SLOTS) {
      expect(matchOfferedSlot(`${formatSlot(slot, "UTC")} works`, SLOTS, "UTC")).toBe(slot);
    }
  });

  it("matches a time pasted with the narrow space newer formatters put before AM", () => {
    expect(matchOfferedSlot("Wednesday, October 7 at 9:30 AM works", SLOTS, "UTC")).toBe(WED);
  });

  it("reads hours in the rep's time zone", () => {
    // 16:30 UTC is 9:30 in the morning in Los Angeles.
    const la = ["2026-10-07T16:30:00Z", "2026-10-08T17:00:00Z"];
    expect(matchOfferedSlot("Wednesday at 9:30 works", la, "America/Los_Angeles")).toBe(la[0]);
    expect(matchOfferedSlot("Wednesday at 4:30pm works", la, "America/Los_Angeles")).toBeNull();
  });
});

describe("tryBookMeeting refuses what it can no longer honour", () => {
  const WORKSPACE = "11111111-1111-4111-8111-111111111111";
  const USER = "22222222-2222-4222-8222-222222222222";
  const PROSPECT = "55555555-5555-4555-8555-555555555555";
  const CONVERSATION = "66666666-6666-4666-8666-666666666666";
  const SLOT = "2026-09-08T14:00:00.000Z";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-07T09:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function harness() {
    const { FakeDb } = await import("./fake-db.js");
    const { MockCalendarProvider } = await import("@le/calendar");
    const db = new FakeDb();
    db.seed("profiles", [{ id: USER, full_name: "Sam Patel", email: "sam@acme.test" }]);
    db.seed("prospects", [{ id: PROSPECT, workspace_id: WORKSPACE, linkedin_url: "x", first_name: "Jane" }]);
    db.seed("campaign_prospects", [
      { workspace_id: WORKSPACE, campaign_id: "camp", prospect_id: PROSPECT, status: "replied" },
    ]);
    db.seed("conversations", [{ id: CONVERSATION, workspace_id: WORKSPACE, prospect_id: PROSPECT, needs_human: false }]);
    const calendar = new MockCalendarProvider();
    const binding = {
      provider: calendar,
      accessToken: "mock",
      timezone: "UTC",
      rules: DEFAULT_BOOKING_RULES,
      ownOnly: true,
      repSettings: false,
      bookedStarts: [] as string[],
    };
    const ctx = { db: db.asDb(), email: null, env: { APP_URL: "https://app.test" } } as never;
    const input = {
      workspaceId: WORKSPACE,
      conversationId: CONVERSATION,
      prospectId: PROSPECT,
      repUserId: USER,
      message: "Tuesday at 2pm works",
      offeredSlots: [SLOT],
      binding: binding as never,
      durationMinutes: 30,
    };
    return { db, ctx, calendar, binding, input };
  }

  function expectNothingBooked(db: import("./fake-db.js").FakeDb) {
    expect(db.rows("meetings")).toHaveLength(0);
    expect(db.rows("campaign_prospects")[0]?.status).toBe("replied");
    expect(db.rows("events").some((e) => e.name === "meeting.booked")).toBe(false);
    const conversation = db.find("conversations", { id: CONVERSATION })!;
    // Somebody accepted a time; a person has to answer that, and the flag is
    // a booking hold so the reply going out next does not clear it.
    expect(conversation.needs_human).toBe(true);
    expect(conversation.needs_human_kind).toBe("booking");
  }

  it("does not book an offered time that has since been taken", async () => {
    // The offer is days old by the time somebody says yes. Booking it anyway
    // puts two people in one call (rule 18).
    const { db, ctx, calendar, input } = await harness();
    calendar.busy = [{ start: SLOT, end: "2026-09-08T14:30:00.000Z" }];
    const { bookAcceptedSlot } = await import("../src/jobs/booking.js");

    const outcome = await bookAcceptedSlot(ctx, input);

    expect(outcome.status).toBe("held");
    expect(calendar.created).toHaveLength(0);
    expectNothingBooked(db);
    expect(db.find("conversations", { id: CONVERSATION })?.needs_human_reason).toMatch(/no longer free/);
  });

  it("does not book an offered time that has already passed", async () => {
    const { db, ctx, input } = await harness();
    vi.setSystemTime(new Date("2026-09-08T15:00:00Z"));
    const { tryBookMeeting } = await import("../src/jobs/booking.js");

    expect(await tryBookMeeting(ctx, input)).toBeNull();
    expectNothingBooked(db);
  });

  it("does not book past the rep's meetings-per-day cap", async () => {
    // `max_per_day` was stored and shown and enforced nowhere.
    const { db, ctx, binding, input } = await harness();
    binding.bookedStarts = ["2026-09-08T09:00:00Z", "2026-09-08T10:00:00Z", "2026-09-08T11:00:00Z"];
    const { tryBookMeeting } = await import("../src/jobs/booking.js");

    expect(await tryBookMeeting(ctx, input)).toBeNull();
    expectNothingBooked(db);
  });

  it("does not mark anybody booked when the meeting row is refused", async () => {
    // `meetings_one_per_rep_slot` refusing the insert is somebody else having
    // taken the half hour. The prospect used to be marked booked anyway, with
    // a `meeting.booked` event and no meeting.
    const { db, ctx, input } = await harness();
    (db as unknown as { uniqueKeys: Record<string, string[]> }).uniqueKeys.meetings = ["rep_user_id", "starts_at"];
    db.seed("meetings", [{ workspace_id: WORKSPACE, rep_user_id: USER, starts_at: SLOT, status: "scheduled" }]);
    const { bookAcceptedSlot } = await import("../src/jobs/booking.js");

    const outcome = await bookAcceptedSlot(ctx, input);

    expect(outcome.status).toBe("held");
    expect(db.rows("meetings")).toHaveLength(1);
    expect(db.rows("campaign_prospects")[0]?.status).toBe("replied");
    expect(db.rows("events").some((e) => e.name === "meeting.booked")).toBe(false);
    expect(db.find("conversations", { id: CONVERSATION })?.needs_human_kind).toBe("booking");
  });

  it("books a free offered slot exactly", async () => {
    const { db, ctx, input } = await harness();
    const { bookAcceptedSlot } = await import("../src/jobs/booking.js");

    const outcome = await bookAcceptedSlot(ctx, input);

    expect(outcome.status).toBe("booked");
    expect(db.rows("meetings")[0]?.starts_at).toBe(SLOT);
    expect(db.rows("campaign_prospects")[0]?.status).toBe("meeting_booked");
  });
});
