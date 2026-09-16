import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { bookFromLink, readBookingPage } from "../src/jobs/book.js";
import type { WorkerContext } from "../src/context.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const REP = "22222222-2222-4222-8222-222222222222";
const PROSPECT = "33333333-3333-4333-8333-333333333333";
const TOKEN = "a".repeat(43);

/**
 * The one page in this product a stranger can open.
 *
 * Its token is the entire authorisation, so the checks on it are the checks on
 * everything behind it — a prospect's name, a rep's free time, and the ability
 * to put something in their diary. The refusals below are all the same shape on
 * purpose: a page that said "expired" for a real token and "not valid" for a
 * made-up one would be a way to find out which tokens exist.
 */
function harness(link: Record<string, unknown> = {}) {
  const db = new FakeDb();
  db.seed("profiles", [{ id: REP, full_name: "Sam Patel", email: "sam@acme.test", timezone: "UTC" }]);
  db.seed("prospects", [
    { id: PROSPECT, workspace_id: WORKSPACE, first_name: "Jane", last_name: "Doe", company: "Acme", linkedin_url: "https://x" },
  ]);
  db.seed("booking_links", [
    {
      id: "link-1",
      workspace_id: WORKSPACE,
      rep_user_id: REP,
      prospect_id: PROSPECT,
      conversation_id: null,
      token: TOKEN,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      meeting_id: null,
      revoked_at: null,
      ...link,
    },
  ]);

  const ctx = {
    db: db.asDb(),
    linkedin: null,
    email: null,
    env: { APP_URL: "http://app.test", CALENDAR_PROVIDER: "own" } as unknown as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  return { db, ctx };
}

describe("the booking page", () => {
  it("offers times to somebody holding a valid link", async () => {
    const { ctx } = harness();

    const page = await readBookingPage(ctx, TOKEN);

    expect(page.unavailable).toBeUndefined();
    expect(page.prospectFirstName).toBe("Jane");
    expect(page.slots.length).toBeGreaterThan(0);
  });

  it("refuses an expired link in the same words as an invented one", async () => {
    // Different words here would turn this page into an oracle for which
    // tokens are real.
    const expired = await readBookingPage(
      harness({ expires_at: new Date(Date.now() - 1000).toISOString() }).ctx,
      TOKEN,
    );
    const invented = await readBookingPage(harness().ctx, "b".repeat(43));

    expect(expired.unavailable).toBeTruthy();
    expect(invented.unavailable).toBeTruthy();
    expect(expired.slots).toEqual([]);
    expect(invented.slots).toEqual([]);
  });

  it("refuses a revoked link", async () => {
    const { ctx } = harness({ revoked_at: new Date().toISOString() });

    expect((await readBookingPage(ctx, TOKEN)).unavailable).toMatch(/withdrawn/i);
  });

  it("names the time when the link has already been used", async () => {
    // Not an error. Somebody re-opening a link they already booked wants to
    // know when their meeting is, not to be told the page is broken.
    const { db, ctx } = harness({ meeting_id: "m-1" });
    db.seed("meetings", [
      { id: "m-1", workspace_id: WORKSPACE, rep_user_id: REP, prospect_id: PROSPECT, starts_at: "2026-10-05T14:00:00.000Z", ends_at: "2026-10-05T14:30:00.000Z", status: "scheduled" },
    ]);

    const page = await readBookingPage(ctx, "a".repeat(43));

    expect(page.alreadyBookedFor).toBeTruthy();
    expect(page.slots).toEqual([]);
  });
});

describe("confirming a booking", () => {
  it("books a time that was actually offered", async () => {
    const { db, ctx } = harness();
    const page = await readBookingPage(ctx, TOKEN);

    const result = await bookFromLink(ctx, {
      token: TOKEN,
      startsAt: page.slots[0]!.iso,
      name: "Jane Doe",
      email: "jane@example.test",
    });

    expect(result.ok).toBe(true);
    const meeting = db.rows("meetings")[0];
    expect(meeting?.prospect_id).toBe(PROSPECT);
    expect(meeting?.rep_user_id).toBe(REP);
    expect(meeting?.booked_via).toBe("link");
    // The link is spent, so re-opening it shows the meeting rather than the
    // slot list.
    expect(db.rows("booking_links")[0]?.meeting_id).toBe(meeting?.id);
  });

  it("refuses a time nobody offered", async () => {
    // The form is a form: `startsAt` is whatever the browser sent. Without this
    // check a booking at 3am on a Sunday is one edited hidden input away.
    const { db, ctx } = harness();

    const result = await bookFromLink(ctx, {
      token: TOKEN,
      startsAt: "2026-10-05T03:00:00.000Z",
      name: "Jane Doe",
      email: "jane@example.test",
    });

    expect(result.ok).toBe(false);
    expect(db.rows("meetings")).toHaveLength(0);
  });

  it("refuses to book on an expired link", async () => {
    const { db, ctx } = harness({ expires_at: new Date(Date.now() - 1000).toISOString() });

    const result = await bookFromLink(ctx, {
      token: TOKEN,
      startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      name: "Jane",
      email: "jane@example.test",
    });

    expect(result.ok).toBe(false);
    expect(db.rows("meetings")).toHaveLength(0);
  });

  it("will not offer a time it has already booked", async () => {
    // The whole point of an own calendar: what it booked is what it treats as
    // busy next time somebody asks.
    const { ctx } = harness();
    const before = await readBookingPage(ctx, TOKEN);
    const taken = before.slots[0]!.iso;

    await bookFromLink(ctx, { token: TOKEN, startsAt: taken, name: "Jane", email: "jane@example.test" });

    const after = await readBookingPage(ctx, TOKEN);
    expect(after.slots.map((s) => s.iso)).not.toContain(taken);
  });
});
