import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";
import { releaseDuplicateAccounts } from "../src/jobs/duplicate-accounts.js";

/*
 * A second provider account for somebody who already has a working one is
 * billed every month and used by nothing (Phil Whitebloom had two, both
 * "Running"). Only an exact spare is released; the account somebody sends
 * from, and anybody else's, never is.
 */

const WS = "11111111-1111-4111-8111-111111111111";
const PHIL = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function harness(rows: Record<string, unknown>[], accounts: MockLinkedInProvider["connectedAccounts"]) {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();
  linkedin.connectedAccounts = accounts;
  db.seed("linkedin_accounts", rows);
  const ctx = { db: db.asDb(), linkedin } as unknown as WorkerContext;
  return { db, ctx, linkedin };
}

const held = { id: "row", workspace_id: WS, user_id: PHIL, provider_account_id: "yq9", status: "active" };

describe("releaseDuplicateAccounts", () => {
  it("releases a second account for the same person and keeps the one in use", async () => {
    const { ctx, linkedin } = harness([held], [
      { providerAccountId: "yq9", reference: "Phil Whitebloom", status: "ok" },
      { providerAccountId: "pqC", reference: "Phil Whitebloom", status: "ok" },
    ]);
    expect((await releaseDuplicateAccounts(ctx)).released).toBe(1);
    expect(linkedin.deletedAccounts).toEqual(["pqC"]);
  });

  it("keeps the spare when the account in use is not healthy", async () => {
    const { ctx, linkedin } = harness([held], [
      { providerAccountId: "yq9", reference: "Phil Whitebloom", status: "reauth_required" },
      { providerAccountId: "pqC", reference: "Phil Whitebloom", status: "ok" },
    ]);
    await releaseDuplicateAccounts(ctx);
    expect(linkedin.deletedAccounts).toEqual([]);
  });

  it("never takes somebody else's new account, even with the same name", async () => {
    const { ctx, linkedin } = harness([held], [
      { providerAccountId: "yq9", reference: PHIL, displayName: "Phil Whitebloom", status: "ok" },
      { providerAccountId: "new", reference: OTHER, displayName: "Phil Whitebloom", status: "ok" },
    ]);
    await releaseDuplicateAccounts(ctx);
    expect(linkedin.deletedAccounts).toEqual([]);
  });

  it("leaves alone anybody part-way through connecting", async () => {
    const { ctx, linkedin } = harness(
      [held, { id: "row2", workspace_id: "w2", user_id: PHIL, provider_account_id: null, status: "connecting" }],
      [
        { providerAccountId: "yq9", reference: PHIL, status: "ok" },
        { providerAccountId: "fresh", reference: PHIL, status: "ok" },
      ],
    );
    await releaseDuplicateAccounts(ctx);
    expect(linkedin.deletedAccounts).toEqual([]);
  });

  it("releases nothing when the provider cannot be asked", async () => {
    const { ctx, linkedin } = harness([held], []);
    linkedin.listAccounts = async () => {
      throw new Error("down");
    };
    expect(await releaseDuplicateAccounts(ctx)).toEqual({ released: 0, failed: 0 });
    expect(linkedin.deletedAccounts).toEqual([]);
  });
});
