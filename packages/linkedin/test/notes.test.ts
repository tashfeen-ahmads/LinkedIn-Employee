import { describe, expect, it } from "vitest";
import { FREE_NOTES_PER_MONTH } from "@le/shared";
import { localMonth, localMonthStart, noteAllowance, planOf } from "../src/notes.js";
import { UnipileProvider } from "../src/unipile.js";

describe("noteAllowance", () => {
  const month = "2026-10";
  it("gives a free account its monthly notes and no more", () => {
    expect(noteAllowance({ plan: "basic", notesSentThisMonth: 0, exhaustedMonth: null, month })).toMatchObject({
      allowed: true,
      remaining: FREE_NOTES_PER_MONTH,
    });
    expect(noteAllowance({ plan: "basic", notesSentThisMonth: FREE_NOTES_PER_MONTH, exhaustedMonth: null, month }).allowed).toBe(false);
  });
  it("believes LinkedIn's refusal over our count, for that month only", () => {
    expect(noteAllowance({ plan: "basic", notesSentThisMonth: 0, exhaustedMonth: month, month }).allowed).toBe(false);
    expect(noteAllowance({ plan: "basic", notesSentThisMonth: 0, exhaustedMonth: "2026-09", month }).allowed).toBe(true);
  });
  it("puts no limit on a paid plan", () => {
    for (const plan of ["premium", "sales_navigator"] as const) {
      expect(noteAllowance({ plan, notesSentThisMonth: 99, exhaustedMonth: month, month })).toEqual({ allowed: true, remaining: null });
    }
  });
  it("reads a count it cannot trust as spent", () => {
    expect(noteAllowance({ plan: "basic", notesSentThisMonth: Number.NaN, exhaustedMonth: null, month }).allowed).toBe(false);
  });
});

describe("planOf and the month", () => {
  it("ranks Sales Navigator over Premium over free", () => {
    expect(planOf({ has_sales_navigator: true, has_premium: false })).toBe("sales_navigator");
    expect(planOf({ has_premium: true })).toBe("premium");
    expect(planOf({})).toBe("basic");
  });
  it("is the rep's month, not UTC's", () => {
    const now = new Date("2026-11-01T03:00:00Z");
    expect(localMonth(now, "UTC")).toBe("2026-11");
    expect(localMonth(now, "America/Los_Angeles")).toBe("2026-10");
    expect(localMonthStart(new Date("2026-10-15T10:00:00Z"), "UTC").toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("getAccountPlan", () => {
  function provider(body: unknown, status = 200) {
    const fetchImpl = (async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
    return new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });
  }
  it("reads paid plans from the InMail balances", async () => {
    expect(await provider({ premium: 5, recruiter: null, sales_navigator: null }).getAccountPlan("a")).toEqual({
      premium: true,
      salesNavigator: false,
    });
    expect(await provider({ premium: null, sales_navigator: 50 }).getAccountPlan("a")).toEqual({
      premium: true,
      salesNavigator: true,
    });
    expect(await provider({ premium: null, recruiter: null, sales_navigator: null }).getAccountPlan("a")).toEqual({
      premium: false,
      salesNavigator: false,
    });
  });
  it("says it does not know rather than calling an account free", async () => {
    expect(await provider({ error: "nope" }, 500).getAccountPlan("a")).toBeNull();
    expect(await provider({ something: "else" }).getAccountPlan("a")).toBeNull();
  });
});
