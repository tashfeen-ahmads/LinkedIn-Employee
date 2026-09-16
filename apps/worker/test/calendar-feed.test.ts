import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";

// The fetch path resolves DNS and vets the address before it connects. Both are
// stubbed here so these tests never touch the network; the address checks
// themselves are covered in @le/calendar.
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "142.250.187.238", family: 4 }],
}));

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const REP = "22222222-2222-4222-8222-222222222222";
const KEY = "a".repeat(64);

/**
 * The rep's real calendar, read from a published address.
 *
 * Two properties matter more than the rest. The intervals it produces have to
 * actually block slots, or the whole feature is decoration. And a feed that
 * stops working must keep its last good snapshot: deleting on failure turns a
 * rotated URL or a bad afternoon at Google into a calendar that suddenly looks
 * completely free, which is the worse of the two failures by a distance — the
 * rep gets double-booked rather than under-booked.
 */
function harness(options: { feed?: Record<string, unknown>; busy?: Array<{ starts_at: string; ends_at: string }> } = {}) {
  const db = new FakeDb();
  db.seed("profiles", [{ id: REP, timezone: "UTC", full_name: "Sam", email: "sam@acme.test" }]);
  db.seed("availability", [
    {
      id: "av-1",
      workspace_id: WORKSPACE,
      user_id: REP,
      timezone: "UTC",
      working_hours: { start: 0, end: 24, days: [0, 1, 2, 3, 4, 5, 6] },
      meeting_minutes: 30,
      min_notice_hours: 0,
      buffer_minutes: 0,
      max_per_day: 5,
      location: null,
    },
  ]);
  if (options.feed !== undefined) {
    db.seed("calendar_feeds", [
      {
        id: "feed-1",
        workspace_id: WORKSPACE,
        user_id: REP,
        url_encrypted: "",
        url_host: "calendar.google.com",
        status: "ok",
        last_synced_at: new Date().toISOString(),
        last_error: null,
        event_count: 1,
        ...options.feed,
      },
    ]);
  }
  db.seed(
    "calendar_feed_busy",
    (options.busy ?? []).map((b, i) => ({
      id: `busy-${i}`,
      workspace_id: WORKSPACE,
      user_id: REP,
      feed_id: "feed-1",
      ...b,
    })),
  );

  const ctx = {
    db: db.asDb(),
    linkedin: null,
    email: null,
    env: { APP_URL: "http://app.test", CALENDAR_PROVIDER: "own", CREDENTIALS_KEY: KEY } as unknown as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  return { db, ctx };
}

/** A window starting tomorrow, so nothing is filtered out by notice rules. */
function soon(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();
}

describe("a connected calendar feed", () => {
  it("blocks the times it reports", async () => {
    // The whole point. A feed whose intervals never reach findFreeSlots is a
    // setting that does nothing, which is worse than no setting at all.
    const { ctx } = harness({ feed: {}, busy: [] });
    const { resolveCalendar, offerSlots } = await import("../src/calendar.js");

    const before = await offerSlots(
      (await resolveCalendar(ctx.db, ctx.env, { workspaceId: WORKSPACE, userId: REP, timezone: "UTC" }))!,
      { maxSlots: 6 },
    );
    const target = before.iso[0]!;

    const { ctx: withBusy } = harness({
      feed: {},
      busy: [{ starts_at: target, ends_at: new Date(Date.parse(target) + 3_600_000).toISOString() }],
    });
    const after = await offerSlots(
      (await resolveCalendar(withBusy.db, withBusy.env, { workspaceId: WORKSPACE, userId: REP, timezone: "UTC" }))!,
      { maxSlots: 6 },
    );

    expect(before.iso).toContain(target);
    expect(after.iso).not.toContain(target);
  });

  it("is not called a connected calendar while it is failing", async () => {
    // `ownOnly` is what the screens read to decide whether to warn. A failing
    // feed still honours its last snapshot, but the rep must not be told their
    // diary is being watched when the last read of it broke.
    const { ctx } = harness({ feed: { status: "failing", last_error: "no longer shared" }, busy: [] });
    const { resolveCalendar } = await import("../src/calendar.js");

    const binding = await resolveCalendar(ctx.db, ctx.env, { workspaceId: WORKSPACE, userId: REP, timezone: "UTC" });

    expect(binding?.ownOnly).toBe(true);
  });
});

describe("refreshing a feed that has stopped working", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the last good intervals and says why", async () => {
    const busy = [{ starts_at: soon(48), ends_at: soon(49) }];
    const { db, ctx } = harness({ feed: {}, busy });
    const { encryptJson } = await import("../src/crypto.js");
    db.rows("calendar_feeds")[0]!.url_encrypted = encryptJson("https://calendar.google.com/a.ics", KEY);

    vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
    const { syncCalendarFeeds } = await import("../src/jobs/calendar-feed.js");

    await syncCalendarFeeds(ctx);

    // Still there. A calendar that suddenly looks free is the failure that
    // double-books someone.
    expect(db.rows("calendar_feed_busy")).toHaveLength(1);
    const feed = db.rows("calendar_feeds")[0];
    expect(feed?.status).toBe("failing");
    expect(String(feed?.last_error)).toMatch(/no longer shared/i);
  });

  it("replaces them when the feed reads successfully", async () => {
    const { db, ctx } = harness({ feed: {}, busy: [{ starts_at: soon(48), ends_at: soon(49) }] });
    const { encryptJson } = await import("../src/crypto.js");
    db.rows("calendar_feeds")[0]!.url_encrypted = encryptJson("https://calendar.google.com/a.ics", KEY);

    const start = new Date(Date.now() + 72 * 3_600_000);
    const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(new Date(start.getTime() + 3_600_000))}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    vi.stubGlobal("fetch", async () => new Response(ics, { status: 200 }));
    const { syncCalendarFeeds } = await import("../src/jobs/calendar-feed.js");

    await syncCalendarFeeds(ctx);

    const rows = db.rows("calendar_feed_busy");
    expect(rows).toHaveLength(1);
    expect(Date.parse(String(rows[0]?.starts_at))).toBe(Math.floor(start.getTime() / 1000) * 1000);
    expect(db.rows("calendar_feeds")[0]?.status).toBe("ok");
  });

  it("refuses a page that is not a calendar, with a fixable reason", async () => {
    // Nearly always the rep copying the browser URL instead of the secret iCal
    // address. Saying "sync failed" leaves them with nothing to try.
    const { db, ctx } = harness({ feed: {}, busy: [] });
    const { encryptJson } = await import("../src/crypto.js");
    db.rows("calendar_feeds")[0]!.url_encrypted = encryptJson("https://calendar.google.com/a.ics", KEY);

    vi.stubGlobal("fetch", async () => new Response("<html>sign in</html>", { status: 200 }));
    const { syncCalendarFeeds } = await import("../src/jobs/calendar-feed.js");

    await syncCalendarFeeds(ctx);

    expect(String(db.rows("calendar_feeds")[0]?.last_error)).toMatch(/not a calendar feed/i);
  });
});
