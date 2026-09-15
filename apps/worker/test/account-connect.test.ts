import { describe, expect, it } from "vitest";
import { MockLinkedInProvider } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { createServer } from "../src/server.js";
import { applyHealth, type AccountRecord } from "../src/accounts.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const INTERNAL_SECRET = "internal-secret-at-least-32-characters-long";

function harness(accountOverrides: Record<string, unknown> = {}) {
  const db = new FakeDb();
  const linkedin = new MockLinkedInProvider();

  db.seed("linkedin_accounts", [
    {
      id: ACCOUNT,
      workspace_id: WORKSPACE,
      user_id: USER,
      provider: "mock",
      provider_account_id: null,
      status: "connecting",
      ...accountOverrides,
    },
  ]);

  // The refresh route checks membership before touching anything, so the
  // harness needs one. The webhook does not: it is authenticated by signature
  // and names the rep by the reference the provider echoes back.
  db.seed("memberships", [{ id: "m-1", workspace_id: WORKSPACE, user_id: USER, role: "owner" }]);

  const ctx = {
    db: db.asDb(),
    linkedin,
    email: null,
    env: {
      APP_URL: "http://app.test",
      WORKER_URL: "http://worker.test",
      // /jobs/* is behind the internal secret, and the refresh route belongs
      // there: it names a workspace and a user, so an unauthenticated caller
      // could bind accounts in someone else's tenant.
      INTERNAL_API_SECRET: INTERNAL_SECRET,
    } as WorkerContext["env"],
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;

  const queues = {
    inbound: { add: async () => {} },
    linkedinAction: { add: async () => {} },
  } as unknown as Queues;

  return { db, ctx, linkedin, app: createServer(ctx, queues) };
}

function post(app: ReturnType<typeof createServer>, body: unknown) {
  return app.request("/webhooks/unipile/accounts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("account connected webhook", () => {
  it("binds the provider account, which is what lets anything send at all", async () => {
    // Without this the rep completes the hosted login, sees a success
    // redirect, and every job skips their account forever for want of a
    // provider id.
    const { db, app, linkedin } = harness();
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: USER, displayName: "Sam Patel", status: "ok" },
    ];

    const response = await post(app, { account_id: "acct_live", name: USER });

    expect(response.status).toBe(200);
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_live");
    expect(account.status).toBe("active");
    expect(account.display_name).toBe("Sam Patel");
  });

  it("starts the warm-up ramp from the moment it connects", async () => {
    // connected_at drives the daily cap, so a fresh account sends at the low
    // one rather than inheriting whatever was in the row.
    const { db, app, linkedin } = harness();
    linkedin.connectedAccounts = [{ providerAccountId: "acct_live", reference: USER, status: "ok" }];

    await post(app, {});

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.connected_at).toBeTruthy();
  });

  it("does not re-bind an account that is already connected", async () => {
    // A replayed delivery must not repoint a working account or restart its
    // warm-up ramp.
    const { db, app, linkedin } = harness({ status: "active", provider_account_id: "acct_original" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_other", reference: USER, status: "ok" }];

    await post(app, {});

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBe("acct_original");
  });

  it("ignores a notification for somebody who never started a connection", async () => {
    const { db, app, linkedin } = harness();
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: "99999999-9999-4999-8999-999999999999", status: "ok" },
    ];

    await post(app, {});

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBeNull();
  });

  it("rejects a delivery it cannot verify rather than binding an account", async () => {
    // A forged delivery would bind a stranger's LinkedIn account to this rep,
    // and every message the campaign sends would leave that account.
    const { db, app, linkedin } = harness();
    linkedin.parseAccountWebhook = () => {
      throw new Error("Invalid Unipile webhook signature");
    };

    const response = await post(app, {});

    expect(response.status).toBe(401);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBeNull();
  });

  it("keeps an account paused when the provider says it still needs attention", async () => {
    const { db, app, linkedin } = harness();
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: USER, status: "reauth_required" },
    ];

    await post(app, {});

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.status).toBe("reauth_required");
  });
});

describe("applyHealth", () => {
  function record(status: string): AccountRecord {
    return {
      id: ACCOUNT,
      workspace_id: WORKSPACE,
      user_id: USER,
      provider_account_id: "acct_live",
      status,
      connected_at: null,
      invites_today: 0,
      invites_this_week: 0,
      messages_today: 0,
      counters_reset_on: null,
      last_action_at: null,
      working_hours: null,
    };
  }

  it("lets a restricted account come back when the restriction lifts", async () => {
    // LinkedIn restrictions are usually temporary and this poll is the only
    // thing watching for one lifting. Restoring only warnings left a recovered
    // account paused for good.
    const { db } = harness({ status: "restricted" });

    await applyHealth(db.asDb(), record("restricted"), "ok");

    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.status).toBe("active");
    expect(account.status_detail).toBeNull();
    expect(db.rows("events").some((e) => e.name === "linkedin.account.recovered")).toBe(true);
  });

  it("does not activate an account that has not finished connecting", async () => {
    const { db } = harness({ status: "connecting" });

    await applyHealth(db.asDb(), record("connecting"), "ok");

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.status).toBe("connecting");
  });

  it("leaves a healthy account alone", async () => {
    const { db } = harness({ status: "active" });

    await applyHealth(db.asDb(), record("active"), "ok");

    expect(db.rows("events")).toHaveLength(0);
  });
});

function refresh(app: ReturnType<typeof createServer>, body: unknown, secret = INTERNAL_SECRET) {
  return app.request("/jobs/linkedin-refresh", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
  });
}

describe("confirming a connection by asking", () => {
  const OTHER = "44444444-4444-4444-8444-444444444444";

  it("binds an account whose notification never arrived", async () => {
    // Connected at the provider, still `connecting` here — exactly the state a
    // rejected or missed webhook leaves behind, and previously permanent.
    const { db, app, linkedin } = harness();
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: USER, displayName: "Sam Patel", status: "ok" },
    ];

    const response = await refresh(app, { workspaceId: WORKSPACE, userId: USER });

    expect(response.status).toBe(200);
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_live");
    expect(account.status).toBe("active");
    expect(account.connected_at).toBeTruthy();
  });

  it("binds only the rep who asked, not everyone the provider returned", async () => {
    // The provider answers with every account this deployment holds. Binding
    // the whole list is how one person's LinkedIn ends up sending another
    // person's campaign, under their name.
    //
    // The other rep needs a row of their own for this to test anything. Without
    // one, "bind everything" and "bind mine" do the same thing — there is
    // nothing else to bind — and the test passes while proving nothing.
    const { db, app, linkedin } = harness();
    db.seed("linkedin_accounts", [
      {
        id: "acct-row-other",
        workspace_id: WORKSPACE,
        user_id: OTHER,
        provider: "mock",
        provider_account_id: null,
        status: "connecting",
      },
    ]);
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_someone_else", reference: OTHER, status: "ok" },
      { providerAccountId: "acct_mine", reference: USER, status: "ok" },
    ];

    await refresh(app, { workspaceId: WORKSPACE, userId: USER });

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBe("acct_mine");
    // The other rep's row is untouched: they did not ask, and their account is
    // not this caller's to bind.
    expect(db.find("linkedin_accounts", { id: "acct-row-other" })?.provider_account_id).toBeNull();
    expect(db.find("linkedin_accounts", { id: "acct-row-other" })?.status).toBe("connecting");
  });

  it("refuses a caller without the internal secret", async () => {
    // The route names a workspace and a user, so an unauthenticated caller
    // could bind an account in somebody else's tenant.
    const { app, linkedin } = harness();
    linkedin.connectedAccounts = [{ providerAccountId: "acct_live", reference: USER, status: "ok" }];

    const response = await refresh(app, { workspaceId: WORKSPACE, userId: USER }, "wrong");

    expect(response.status).toBe(401);
  });

  it("leaves an already-connected account alone", async () => {
    const { db, app, linkedin } = harness({ status: "active", provider_account_id: "acct_original" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_different", reference: USER, status: "ok" }];

    await refresh(app, { workspaceId: WORKSPACE, userId: USER });

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBe("acct_original");
  });
});
