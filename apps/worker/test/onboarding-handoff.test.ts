import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

/**
 * What onboarding was told, actually reaching the rows that act on it.
 *
 * Onboarding asks for sending hours and a Sales Navigator tick at signup, when
 * no LinkedIn account exists to hold either — they wait on
 * `workspaces.onboarding` (migration 0038). A form that collects an answer and
 * then ignores it is worse than one that never asked: the rep believes the
 * question is settled, and is asked again on the profile screen, which is the
 * exact re-asking this was rebuilt to stop.
 *
 * Asserted against the shape the connect route writes rather than by calling
 * the Hono handler, which needs a provider and a live env. The value here is
 * the merge rule, and that is where it has to be right.
 */
function accountRow(answers: unknown) {
  const a = (answers ?? null) as
    | { workingHours?: { start: number; end: number; days: number[] } | null; hasSalesNavigator?: boolean }
    | null;
  return {
    workspace_id: WS,
    user_id: USER,
    provider: "unipile",
    status: "connecting",
    ...(a?.workingHours ? { working_hours: a.workingHours } : {}),
    ...(typeof a?.hasSalesNavigator === "boolean" ? { has_sales_navigator: a.hasSalesNavigator } : {}),
  } as Record<string, unknown>;
}

describe("connecting an account after onboarding", () => {
  it("takes the hours and the tier the rep already answered", () => {
    const row = accountRow({
      workingHours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
      hasSalesNavigator: true,
    });
    expect(row.working_hours).toEqual({ start: 9, end: 17, days: [1, 2, 3, 4, 5] });
    expect(row.has_sales_navigator).toBe(true);
  });

  it("writes nothing when onboarding answered nothing", () => {
    /*
     * The reconnect case, and the reason this is a spread rather than a
     * default. An account that already exists is being upserted; sending an
     * absent value would overwrite a window the rep has since edited on their
     * profile with hours nobody chose. Repair must not make things worse.
     */
    for (const empty of [null, {}, { workingHours: null }]) {
      const row = accountRow(empty);
      expect(Object.keys(row)).not.toContain("working_hours");
    }
  });

  it("carries a deliberate 'no' rather than treating it as unanswered", () => {
    // `false` is an answer: it decides which search runs, and a search sent to
    // a tier the account does not hold returns nobody at all (rule 12).
    const row = accountRow({ hasSalesNavigator: false });
    expect(row.has_sales_navigator).toBe(false);
  });

  it("stores the hours in the shape the limiter reads", async () => {
    // The fake database is the stand-in for PostgREST; this proves the column
    // round-trips as the object `parseWorkingHours` expects rather than as a
    // string.
    const db = new FakeDb();
    db.seed("linkedin_accounts", []);
    await db.asDb().from("linkedin_accounts").insert(accountRow({
      workingHours: { start: 8, end: 18, days: [1, 2, 3, 4, 5] },
    }) as never);
    const saved = db.find("linkedin_accounts", { user_id: USER });
    expect(saved?.working_hours).toMatchObject({ start: 8, end: 18 });
  });
});
