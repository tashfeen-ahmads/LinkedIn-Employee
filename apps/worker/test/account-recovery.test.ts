import { describe, expect, it } from "vitest";
import { MockEmailProvider } from "@le/email";
import { FakeDb } from "./fake-db.js";
import { emailForLogin, sendRecovery } from "../src/jobs/account-recovery.js";
import type { WorkerContext } from "../src/context.js";

/*
 * Getting back in. Every login complaint so far was a forgotten password or a
 * different address from the one the workspace was set up with — which signs
 * in fine and then asks the person to start over.
 */
const REAL = "11111111-1111-4111-8111-111111111111";
const EMPTY = "22222222-2222-4222-8222-222222222222";
const WS = "33333333-3333-4333-8333-333333333333";

function harness() {
  const db = new FakeDb();
  db.seed("profiles", [
    { id: REAL, email: "patti@pm.me", username: "patti", full_name: "Patti Diane" },
    { id: EMPTY, email: "patti@proton.me", username: null, full_name: null },
  ]);
  db.seed("memberships", [{ user_id: REAL, workspace_id: WS, role: "owner" }]);
  db.seed("workspaces", [{ id: WS, name: "P.D. Milton" }]);
  db.seed("email_sends", []);
  const email = new MockEmailProvider();
  const ctx = {
    db: db.asDb(),
    email,
    env: { APP_URL: "https://app.norasdr.com" },
  } as unknown as WorkerContext;
  const minted: string[] = [];
  const mint = async (address: string) => {
    minted.push(address);
    return `tok-${address}`;
  };
  return { db, ctx, email, mint, minted };
}

describe("password reset", () => {
  it("finds the account behind any Proton spelling, and writes only to the address typed", async () => {
    const { ctx, email, mint } = harness();
    expect(await sendRecovery(ctx, { identifier: "Patti@protonmail.com", kind: "password" }, mint)).toBe("sent");
    expect(email.sent).toHaveLength(1);
    // The same inbox, spelled the way the person spelled it.
    expect(email.sent[0]!.to).toBe("patti@protonmail.com");
    // One link per sign-in, and the one with the workspace first.
    expect(email.sent[0]!.text).toMatch(/patti@pm\.me — your P\.D\. Milton workspace/);
    expect(email.sent[0]!.html).toContain("/auth/confirm?type=recovery&amp;token_hash=tok-patti%40pm.me");
  });

  it("sends nothing for an address nobody signed up with", async () => {
    const { ctx, email, mint } = harness();
    expect(await sendRecovery(ctx, { identifier: "stranger@example.com", kind: "password" }, mint)).toBe("no_account");
    expect(email.sent).toHaveLength(0);
  });

  it("sends a username's reset to that account's own address", async () => {
    const { ctx, email, mint } = harness();
    await sendRecovery(ctx, { identifier: "PATTI", kind: "password" }, mint);
    expect(email.sent[0]!.to).toBe("patti@pm.me");
  });

  it("does not fill an inbox: one of each kind per ten minutes", async () => {
    const { ctx, email, mint } = harness();
    const now = new Date("2026-10-07T12:00:00Z");
    expect(await sendRecovery(ctx, { identifier: "patti@pm.me", kind: "password" }, mint, now)).toBe("sent");
    expect(await sendRecovery(ctx, { identifier: "patti@pm.me", kind: "password" }, mint, now)).toBe("throttled");
    expect(email.sent).toHaveLength(1);
  });
});

describe("which email did I use", () => {
  it("lists every sign-in for that inbox and says which one opens the workspace", async () => {
    const { ctx, email, mint } = harness();
    expect(await sendRecovery(ctx, { identifier: "patti@proton.me", kind: "signin" }, mint)).toBe("sent");
    expect(email.sent[0]!.to).toBe("patti@proton.me");
    expect(email.sent[0]!.text).toMatch(/patti@pm\.me \(username patti\) — signs in to P\.D\. Milton/);
    expect(email.sent[0]!.text).toMatch(/patti@proton\.me — not set up yet/);
  });
});

describe("emailForLogin", () => {
  it("resolves a username and nothing else", async () => {
    const { ctx } = harness();
    expect(await emailForLogin(ctx, "patti")).toBe("patti@pm.me");
    expect(await emailForLogin(ctx, "patti@pm.me")).toBeNull();
    expect(await emailForLogin(ctx, "nobody")).toBeNull();
  });
});
