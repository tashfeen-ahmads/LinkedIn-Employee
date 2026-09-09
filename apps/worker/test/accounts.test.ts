import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { recordAction } from "../src/accounts.js";

const ACCOUNT = "33333333-3333-4333-8333-333333333333";

function harness() {
  const db = new FakeDb();
  db.seed("linkedin_accounts", [
    {
      id: ACCOUNT,
      workspace_id: "11111111-1111-4111-8111-111111111111",
      user_id: "22222222-2222-4222-8222-222222222222",
      invites_today: 9,
      invites_this_week: 40,
      messages_today: 3,
    },
  ]);
  return db;
}

describe("recordAction", () => {
  it("counts an invitation against the daily and the weekly cap", async () => {
    const db = harness();
    await recordAction(db.asDb(), ACCOUNT, "invite");

    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.invites_today).toBe(10);
    expect(account.invites_this_week).toBe(41);
    expect(account.messages_today).toBe(3);
  });

  it("counts a message without touching the invitation counters", async () => {
    const db = harness();
    await recordAction(db.asDb(), ACCOUNT, "message");

    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.invites_today).toBe(9);
    expect(account.messages_today).toBe(4);
  });

  it("loses nothing when two actions are recorded at once", async () => {
    // The bug this replaced: both calls read 9 and both wrote 10, so one
    // invitation was never counted and the account went past its daily cap.
    const db = harness();
    await Promise.all([
      recordAction(db.asDb(), ACCOUNT, "invite"),
      recordAction(db.asDb(), ACCOUNT, "invite"),
      recordAction(db.asDb(), ACCOUNT, "invite"),
    ]);

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.invites_today).toBe(12);
  });

  it("raises rather than letting an action go uncounted", async () => {
    // A silently uncounted send is an account creeping past its cap while the
    // limiter keeps saying yes.
    const db = new FakeDb();
    const failing = {
      rpc: async () => ({ data: null, error: { message: "connection lost" } }),
    } as never;
    await expect(recordAction(failing, ACCOUNT, "invite")).rejects.toThrow("connection lost");
    void db;
  });
});
