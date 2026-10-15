import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { refreshAccountPlan } from "../src/accounts.js";
import { FakeDb } from "./fake-db.js";

function seeded(row: Record<string, unknown> = {}) {
  const db = new FakeDb();
  db.seed("linkedin_accounts", [
    { id: "a1", provider_account_id: "acct", has_premium: false, has_sales_navigator: false, plan_detected: null, ...row },
  ]);
  return db;
}

describe("refreshAccountPlan", () => {
  it("records a paid plan, which lifts the monthly note limit", async () => {
    const db = seeded();
    const provider = new MockLinkedInProvider();
    provider.plan = { premium: true, salesNavigator: false };

    expect(await refreshAccountPlan(db.asDb(), provider, { id: "a1", provider_account_id: "acct" })).toBe("premium");
    const row = db.find("linkedin_accounts", { id: "a1" })!;
    expect(row.plan_detected).toBe("premium");
    expect(row.has_premium).toBe(true);
    expect(row.plan_checked_at).toBeTruthy();
  });

  it("takes Premium away from an account the provider says is free", async () => {
    const db = seeded({ has_premium: true });
    const provider = new MockLinkedInProvider();
    provider.plan = { premium: false, salesNavigator: false };

    await refreshAccountPlan(db.asDb(), provider, { id: "a1", provider_account_id: "acct" });
    expect(db.find("linkedin_accounts", { id: "a1" })?.has_premium).toBe(false);
  });

  it("changes nothing when the provider could not say", async () => {
    // Rule 17: a lookup that could not look must not read as "free".
    const db = seeded({ has_premium: true });
    const provider = new MockLinkedInProvider();
    provider.plan = null;

    expect(await refreshAccountPlan(db.asDb(), provider, { id: "a1", provider_account_id: "acct" })).toBeNull();
    const row = db.find("linkedin_accounts", { id: "a1" })!;
    expect(row.has_premium).toBe(true);
    expect(row.plan_detected).toBeNull();
  });

  it("never turns Sales Navigator on or off: that switch changes the search and is the rep's", async () => {
    const db = seeded();
    const provider = new MockLinkedInProvider();
    provider.plan = { premium: true, salesNavigator: true };

    await refreshAccountPlan(db.asDb(), provider, { id: "a1", provider_account_id: "acct" });
    const row = db.find("linkedin_accounts", { id: "a1" })!;
    expect(row.plan_detected).toBe("sales_navigator");
    expect(row.has_sales_navigator).toBe(false);
  });
});
