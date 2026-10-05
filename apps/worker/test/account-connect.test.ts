import { describe, expect, it } from "vitest";
import { MockLinkedInProvider, UnipileError } from "@le/linkedin";
import { FakeDb } from "./fake-db.js";
import { encryptJson } from "../src/crypto.js";
import { createServer } from "../src/server.js";
import { applyHealth, type AccountRecord } from "../src/accounts.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const INTERNAL_SECRET = "internal-secret-at-least-32-characters-long";
const CREDENTIALS_KEY = "a".repeat(64);

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
      // The connect return trip is authorised by a token this worker mints
      // with this key rather than by a session, so a harness without one is
      // testing a deployment that cannot connect at all.
      CREDENTIALS_KEY: CREDENTIALS_KEY,
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

  it("distinguishes no accounts from accounts labelled with someone else", async () => {
    // These look identical from the outside and need completely different
    // things done about them: wait a moment, versus the reference we hand the
    // hosted flow is not coming back the way we expect.
    const { app, linkedin } = harness();
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: "Sam Patel", status: "ok" },
    ];

    const response = await refresh(app, { workspaceId: WORKSPACE, userId: USER });
    const body = (await response.json()) as { found: number; mine: number; referenceShape?: string[] };

    expect(body.found).toBe(1);
    expect(body.mine).toBe(0);
    // Shape, not value: enough to tell a display name from an id that does not
    // match, without putting one workspace's labels in another's browser.
    expect(body.referenceShape).toEqual(["text with spaces"]);
  });

  it("never lets a delivery re-point an account that is already working", async () => {
    // The property this used to assert about the refresh route, asserted where
    // it actually belongs.
    //
    // Being *told* an account changed and *asking* whether it did are not the
    // same claim. A delivery is unauthenticated input from the network, so it
    // may only complete a connection someone here started — otherwise a forged
    // one re-points a live account at a stranger's LinkedIn and every campaign
    // message goes out from it. Asking is the recovery path, and it is tested
    // below.
    const { db, app, linkedin } = harness({ status: "active", provider_account_id: "acct_original" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_different", reference: USER, status: "ok" }];

    await post(app, { status: "CREATION_SUCCESS", account_id: "acct_different", name: USER });

    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBe("acct_original");
  });
});

/**
 * A row that says `active` while the provider has no such account.
 *
 * This is not hypothetical: it is what the first live deployment sat in. Every
 * campaign failed with "LinkedIn's provider refused the search" — the
 * provider's own words were `404 … Account not found` — while the Team page
 * showed a healthy connection, usage bars and a Check again button that did
 * nothing, because binding deliberately only touches a row that is waiting.
 * The only way out was editing the database by hand.
 */
describe("an account the provider no longer has", () => {
  it("re-points a live row when the provider's id has changed", async () => {
    const { db, app, linkedin } = harness({ provider_account_id: "acct_old", status: "active" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_new", reference: USER, displayName: "Sam Patel", status: "ok" },
    ];

    const response = await refresh(app, { workspaceId: WORKSPACE, userId: USER });

    expect(await response.json()).toMatchObject({ changed: true });
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_new");
    expect(account.status).toBe("active");
  });

  it("stops claiming to be connected when the provider has nothing", async () => {
    const { db, app, linkedin } = harness({ provider_account_id: "acct_gone", status: "active" });
    linkedin.connectedAccounts = [];

    const response = await refresh(app, { workspaceId: WORKSPACE, userId: USER });

    expect(await response.json()).toMatchObject({ lost: true });
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    // Reconnect is the fix and the rep can do it themselves, but only if the
    // screen admits there is something to fix.
    expect(account.status).toBe("reauth_required");
    expect(String(account.status_detail)).toMatch(/no longer has this account/i);
  });

  it("never re-points a row at an account carrying someone else's reference", async () => {
    const { db, app, linkedin } = harness({ provider_account_id: "acct_mine", status: "active" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_theirs", reference: OTHER_REP, displayName: "Someone", status: "ok" },
    ];

    await refresh(app, { workspaceId: WORKSPACE, userId: USER });

    // Reconciling must not become a way to attach a stranger's LinkedIn to a
    // rep's row and send every campaign message from it.
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_mine");
    // The provider has accounts, just none of this rep's — so this rep's is
    // gone, and that is what it says.
    expect(account.status).toBe("reauth_required");
  });

  it("leaves a healthy row entirely alone", async () => {
    const { db, app, linkedin } = harness({ provider_account_id: "acct_same", status: "active" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_same", reference: USER, status: "ok" },
    ];

    const response = await refresh(app, { workspaceId: WORKSPACE, userId: USER });

    expect(await response.json()).toMatchObject({ changed: false });
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBe("acct_same");
  });
});

const OTHER_REP = "55555555-5555-4555-8555-555555555555";

/**
 * The disagreement a real deployment sat in for a day.
 *
 * Unipile's own dashboard showed a healthy green connection. This product
 * showed "reauth required · Reconnect". Both were right about different things:
 * the rep had reconnected, the provider had issued a *new* account with a new
 * id, and our row still held the old one. Recovery existed and was only ever
 * reached by pressing a button, so whoever did not find that button stayed
 * stuck — and the nightly health poll made it worse, asking about the dead id,
 * getting a 404, and marking the row dead again every night without ever
 * asking whether a live account was sitting beside it.
 */
describe("recovering an account the provider has replaced", () => {
  it("repairs a reauth_required row from the provider's live list", async () => {
    const { db, app, linkedin } = harness({
      provider_account_id: "acct_dead",
      status: "reauth_required",
      status_detail: "provider reported reauth_required",
    });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_new", reference: USER, displayName: "Sam Patel", status: "ok" },
    ];
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    expect(result.repaired).toBe(1);
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_new");
    expect(account.status).toBe("active");
    expect(account.status_detail).toBeNull();
  });

  it("reports a refused list rather than reading it as nothing to repair", async () => {
    /*
     * The night this deployment lost.
     *
     * `listAccounts` was answered `401 Missing credentials` — the DSN and the
     * access token belonged to two different Unipile tenants — and recovery
     * correctly touched no row, because "asked and refused" must never be
     * read as "the provider has none" (that would mark every account on the
     * deployment dead over one bad minute). But it then returned
     * `repaired: 0`, which is exactly what a healthy night with nothing to fix
     * returns, and the nightly record wrote `recover-accounts: 0` and called
     * the step done.
     *
     * The only reason anybody ever found out is that the health poll standing
     * beside it surfaced the same 401 in its own row. Without that neighbour
     * the sweep was green while nothing in the product could reach LinkedIn
     * at all — a step that passes because it could not look, which is the
     * disease this repo keeps paying for.
     */
    const { db, linkedin } = harness({ provider_account_id: "acct_dead", status: "reauth_required" });
    linkedin.listAccounts = async () => {
      throw new Error("Unipile GET /api/v1/accounts failed with 401: Missing credentials");
    };
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    expect(result.unreachable).toMatch(/401/);
    expect(result.repaired).toBe(0);
    // No row touched: a refusal is not evidence about any account.
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status).toBe("reauth_required");
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBe("acct_dead");
  });

  it("says nothing was wrong when the provider answered and there was nothing to fix", async () => {
    // The other half of the pair, so `unreachable` cannot be made truthy
    // unconditionally and still pass: a clean run has to report a clean run.
    const { db, linkedin } = harness({ provider_account_id: "acct_live", status: "active" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: USER, status: "ok" },
    ];
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    expect(result.unreachable).toBeNull();
    expect(result.repaired).toBe(0);
  });

  it("finishes a connection that was left half-done", async () => {
    // A hosted flow whose notification never arrived leaves a `connecting` row
    // with no provider id, and nothing else ever completes it.
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_new", reference: USER, status: "ok" }];
    const { recoverAccounts } = await import("../src/accounts.js");

    await recoverAccounts(db.asDb(), linkedin);

    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status).toBe("active");
    void app;
  });

  it("leaves an active account alone while the provider still has its id", async () => {
    // The row is right, so there is nothing to repair. This is the case the
    // active rows are walked for, and it has to be a no-op or every nightly
    // run rewrites every healthy account on the deployment.
    const { db, linkedin } = harness({ provider_account_id: "acct_live", status: "active" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: USER, status: "ok" },
      { providerAccountId: "acct_other", reference: USER, status: "ok" },
    ];
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    expect(result.repaired).toBe(0);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBe("acct_live");
  });

  it("re-points an active account whose stored id the provider has dropped", async () => {
    // The live failure: a new provider account is connected, ours keeps the old
    // id, and because the row never stopped saying `active` nothing looked at
    // it. Every send behind it fails under a green tick.
    const { db, linkedin } = harness({ provider_account_id: "acct_gone", status: "active" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_new", reference: USER, status: "ok" }];
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    expect(result.repaired).toBe(1);
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_new");
    expect(account.status).toBe("active");
  });

  it("does not re-point an active account when the held id is merely unlabelled", async () => {
    // An account connected in the provider's own dashboard carries no
    // reference. Reading unlabelled as missing is what once tore down a live
    // connection, so the id is looked for across the whole list.
    const { db, linkedin } = harness({ provider_account_id: "acct_live", status: "active" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: null, status: "ok" },
      { providerAccountId: "acct_new", reference: USER, status: "ok" },
    ];
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    expect(result.repaired).toBe(0);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBe("acct_live");
  });

  it("refuses to guess which of several accounts replaced a working one", async () => {
    // Same person, two LinkedIn accounts. Picking wrong sends a campaign from
    // the wrong profile under a real rep's name, so it is reported instead.
    const { db, linkedin } = harness({ provider_account_id: "acct_gone", status: "active" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_one", reference: USER, status: "ok" },
      { providerAccountId: "acct_two", reference: USER, status: "ok" },
    ];
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    expect(result.repaired).toBe(0);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBe("acct_gone");
    // Silence would leave the green tick with no explanation anywhere.
    expect(db.find("events", { name: "linkedin.account.recovery_ambiguous" })).toBeTruthy();
  });

  it("re-points an unhealthy account without needing the held id to be gone", async () => {
    // The pre-existing path: a row that already says it is broken is repaired
    // against whatever the provider has for this rep, several or not.
    const { db, linkedin } = harness({ provider_account_id: "acct_stale", status: "reauth_required" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_a", reference: USER, status: "ok" },
      { providerAccountId: "acct_b", reference: USER, status: "ok" },
    ];
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    expect(result.repaired).toBe(1);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status).toBe("active");
  });

  it("keeps the throttle and the warm-up when an account is re-pointed", async () => {
    // A new provider account is not a new LinkedIn account. The ramp reads
    // `first_action_at` and the backoff reads `invites_paused_until`, and
    // clearing either would hand a profile LinkedIn is already refusing its
    // full allowance on the day it reconnected.
    const paused = "2030-01-01T00:00:00.000Z";
    const first = "2026-09-22T16:52:18.455Z";
    const { db, linkedin } = harness({
      provider_account_id: "acct_gone",
      status: "active",
      invites_paused_until: paused,
      invite_throttle_streak: 4,
      first_action_at: first,
    });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_new", reference: USER, status: "ok" }];
    const { recoverAccounts } = await import("../src/accounts.js");

    await recoverAccounts(db.asDb(), linkedin);

    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_new");
    expect(account.invites_paused_until).toBe(paused);
    expect(account.invite_throttle_streak).toBe(4);
    expect(account.first_action_at).toBe(first);
  });

  it("never attaches an account carrying someone else's reference", async () => {
    const { db, linkedin } = harness({ provider_account_id: "acct_dead", status: "reauth_required" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_theirs", reference: "99999999-9999-4999-8999-999999999999", status: "ok" },
    ];
    const { recoverAccounts } = await import("../src/accounts.js");

    await recoverAccounts(db.asDb(), linkedin);

    // Repairing must not become a way to send a whole campaign from a
    // stranger's LinkedIn.
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_dead");
    expect(account.status).toBe("reauth_required");
  });

  it("does not mark every account dead because the provider had a bad minute", async () => {
    // Asked-and-not-answered is not "the provider has nothing". Treating it as
    // that would disconnect an entire deployment over one failed request.
    const { db, linkedin } = harness({ provider_account_id: "acct_dead", status: "reauth_required" });
    linkedin.listAccounts = async () => {
      throw new Error("provider unavailable");
    };
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    expect(result.repaired).toBe(0);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status).toBe("reauth_required");
  });

  it("keeps the reason when the provider genuinely has nothing for this rep", async () => {
    // The specific explanation already on the row is the only one anybody has;
    // overwriting it with a generic one loses it.
    const { db, linkedin } = harness({
      provider_account_id: "acct_dead",
      status: "reauth_required",
      status_detail: "provider reported reauth_required",
    });
    linkedin.connectedAccounts = [];
    const { recoverAccounts } = await import("../src/accounts.js");

    await recoverAccounts(db.asDb(), linkedin);

    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status_detail).toBe("provider reported reauth_required");
  });
});

/**
 * Existence and ownership are different questions.
 *
 * The provider's label records who started the hosted flow. An account
 * connected in the provider's own dashboard carries none; one attached by an
 * administrator carries none either. The id records whether the account is
 * there at all.
 *
 * Answering the first question with the second tore down a working connection:
 * a live account, present in the provider's list under the id this row holds,
 * was marked dead because its label said a person's name instead of a user id
 * — and marked dead again on every page load, so no fix of any kind could
 * survive. Binding is untouched by this: choosing a *new* id still requires the
 * rep's own reference. Only tearing an existing one down changed, and that now
 * needs evidence the account is gone.
 */
describe("an account the provider holds but does not label", () => {
  const dashboardAccount = {
    providerAccountId: "acct_live",
    reference: "Sam Patel",
    status: "ok" as const,
  };

  it("leaves a held account alone when the provider still has that id", async () => {
    const { db, linkedin } = harness({ provider_account_id: "acct_live", status: "active" });
    const { reconcileAccount } = await import("../src/accounts.js");
    void linkedin;

    const result = await reconcileAccount(db.asDb(), WORKSPACE, USER, [], [dashboardAccount]);

    expect(result).toEqual({ unlabelled: true });
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.status).toBe("active");
    expect(account.provider_account_id).toBe("acct_live");
  });

  it("still marks an account dead when its id is genuinely absent", async () => {
    // The check that must keep working. An id nowhere in the provider's list
    // is gone, whatever anything is labelled.
    const { db } = harness({ provider_account_id: "acct_dead", status: "active" });
    const { reconcileAccount } = await import("../src/accounts.js");

    const result = await reconcileAccount(db.asDb(), WORKSPACE, USER, [], [dashboardAccount]);

    expect(result).toEqual({ lost: true });
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status).toBe("reauth_required");
  });

  it("still refuses to attach an account labelled with somebody else", async () => {
    // Existence is not permission. An account carrying another rep's reference
    // is never bound here, however present it is.
    const { db } = harness({ provider_account_id: null, status: "connecting" });
    const { reconcileAccount } = await import("../src/accounts.js");

    await reconcileAccount(db.asDb(), WORKSPACE, USER, [], [
      { providerAccountId: "acct_theirs", reference: "99999999-9999-4999-8999-999999999999", status: "ok" },
    ]);

    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBeNull();
  });
});

/**
 * The claim route: the hosted-auth redirect hands back an `account_id`, and
 * this is what turns that into a bound row.
 *
 * It carries rule 8's binding rule on a second path, and it had no tests at
 * all — which the mutation check found the hard way. `connect/no-rebinding`
 * SURVIVED because its target string appears in this route *and* in
 * `bindAccounts`, so the mutation broke this one, where nothing was looking.
 */
function claim(app: ReturnType<typeof createServer>, body: unknown, secret = INTERNAL_SECRET) {
  return app.request("/jobs/linkedin-claim", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
  });
}

describe("claiming an account from the hosted-auth redirect", () => {
  it("binds the account to the row this rep's own Connect press created", async () => {
    const { db, linkedin, app } = harness();
    linkedin.connectedAccounts = [
      { providerAccountId: "prov-1", displayName: "Jane Rep", status: "ok", reference: USER },
    ];

    const res = await claim(app, { workspaceId: WORKSPACE, userId: USER, accountId: "prov-1" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: true });
    const row = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(row.provider_account_id).toBe("prov-1");
    expect(row.status).toBe("active");
  });

  it("never re-points a row that is already working", async () => {
    /*
     * Rule 8, on the pull path. `account_id` arrives in a query string, so it
     * is a claim rather than a fact — and a claim that could re-point a
     * healthy row would send every campaign message from a stranger's
     * LinkedIn account under this rep's name.
     */
    const { db, linkedin, app } = harness({ status: "active", provider_account_id: "prov-old" });
    linkedin.connectedAccounts = [
      { providerAccountId: "prov-new", displayName: "Jane Rep", status: "ok", reference: USER },
    ];

    const res = await claim(app, { workspaceId: WORKSPACE, userId: USER, accountId: "prov-new" });

    expect(await res.json()).toMatchObject({ claimed: false });
    // Untouched: the working account keeps the id it was working with.
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBe("prov-old");
  });

  it("refuses an account another row already holds", async () => {
    const { db, linkedin, app } = harness();
    db.seed("linkedin_accounts", [
      {
        id: "other-row",
        workspace_id: WORKSPACE,
        user_id: "99999999-9999-4999-8999-999999999999",
        provider: "mock",
        provider_account_id: "prov-1",
        status: "active",
      },
    ]);
    linkedin.connectedAccounts = [
      { providerAccountId: "prov-1", displayName: "Someone Else", status: "ok", reference: USER },
    ];

    const res = await claim(app, { workspaceId: WORKSPACE, userId: USER, accountId: "prov-1" });

    expect(await res.json()).toMatchObject({ claimed: false });
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBeNull();
  });

  it("refuses an id the provider has never heard of", async () => {
    // Asked, not assumed. An id from a query string is a claim about the
    // provider, and the provider is what settles it.
    const { db, linkedin, app } = harness();
    linkedin.connectedAccounts = [];

    const res = await claim(app, { workspaceId: WORKSPACE, userId: USER, accountId: "invented" });

    expect(await res.json()).toMatchObject({ claimed: false });
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBeNull();
  });

  it("refuses a caller without the internal secret", async () => {
    // Rule 8: the internal API fails closed. This route names a workspace and
    // a user, so an unauthenticated caller could bind in someone else's tenant.
    const { db, linkedin, app } = harness();
    linkedin.connectedAccounts = [
      { providerAccountId: "prov-1", displayName: "Jane Rep", status: "ok", reference: USER },
    ];

    const res = await claim(app, { workspaceId: WORKSPACE, userId: USER, accountId: "prov-1" }, "wrong");

    expect(res.status).toBe(401);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBeNull();
  });

  it("refuses somebody who is not a member of that workspace", async () => {
    const { db, linkedin, app } = harness();
    linkedin.connectedAccounts = [
      { providerAccountId: "prov-1", displayName: "Jane Rep", status: "ok", reference: USER },
    ];

    const res = await claim(app, {
      workspaceId: WORKSPACE,
      userId: "88888888-8888-4888-8888-888888888888",
      accountId: "prov-1",
    });

    expect(res.status).toBe(403);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })?.provider_account_id).toBeNull();
  });
});

/**
 * The delivery that cannot be verified, and the day it costs.
 *
 * The provider does not sign the `notify_url` handed to it on a hosted auth
 * link, so the one delivery that says "a rep just connected" always fails the
 * signature check. Refusing it is right — a forged body would bind a
 * stranger's LinkedIn to a rep's row. Refusing it and then doing *nothing* is
 * what left this deployment holding a dead account id: the only other paths to
 * binding were a person loading an authenticated page, and a sweep that ran at
 * three in the morning.
 *
 * So the ring makes us ask. Nothing from the body is read; the answer is still
 * 401; and what binds comes from a list the worker fetched itself.
 */
describe("an account notice we cannot verify", () => {
  /**
   * The mock provider accepts any body, so the refusal has to be staged: this
   * is what the real one does with a delivery carrying no signature, and it is
   * the only state the `notify_url` ever arrives in.
   */
  function refusing(linkedin: MockLinkedInProvider): void {
    linkedin.parseAccountWebhook = () => {
      throw new Error("Invalid Unipile webhook signature");
    };
  }

  const unsigned = (app: ReturnType<typeof createServer>) =>
    app.request("/webhooks/unipile/accounts", {
      method: "POST",
      body: JSON.stringify({ account_id: "acct_new", name: USER, status: "OK" }),
      headers: { "content-type": "application/json" },
    });

  it("still refuses the delivery, and binds from what the provider says instead", async () => {
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_new", reference: USER, status: "ok" }];
    refusing(linkedin);

    const res = await unsigned(app);
    expect(res.status).toBe(401);

    // The pull runs beside the response rather than inside it.
    await new Promise((r) => setTimeout(r, 20));

    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_new");
    expect(account.status).toBe("active");
  });

  it("binds nothing the caller named that the provider does not have", async () => {
    // The body claims acct_new. The provider has never heard of it. If any of
    // that body were read, this row would end up holding a stranger's id.
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    linkedin.connectedAccounts = [];
    refusing(linkedin);

    expect((await unsigned(app)).status).toBe(401);
    await new Promise((r) => setTimeout(r, 20));

    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBeNull();
  });

  it("does not let an open endpoint become a way to hammer the provider", async () => {
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_new", reference: USER, status: "ok" }];
    refusing(linkedin);
    let calls = 0;
    const real = linkedin.listAccounts.bind(linkedin);
    linkedin.listAccounts = async () => {
      calls += 1;
      return real();
    };

    for (let i = 0; i < 5; i += 1) {
      expect((await unsigned(app)).status).toBe(401);
      await new Promise((r) => setTimeout(r, 20));
    }

    // Anyone can POST here without authenticating, so the debounce is the whole
    // defence against one open door becoming an amplifier.
    expect(calls).toBe(1);
    void db;
  });
});

/**
 * Connecting must not depend on a cookie outliving the trip to LinkedIn.
 *
 * The hosted flow used to return straight to an app page, and that page read
 * the signed-in session to know whose account to attach. So the whole
 * connection hung on a cookie still being present several minutes later, on
 * whichever host the redirect named. When it was not — an expired session, a
 * different host, a browser that dropped it — the rep landed on /login, the
 * claim never ran, and the row sat `connecting` holding nothing while the
 * account worked perfectly at the provider. Pressing Connect again reproduced
 * it exactly, which is what made it cost days rather than minutes.
 *
 * The return trip now carries a token this worker minted. Identity comes out
 * of the token; everything it unlocks is still guarded by `claimAccount`.
 */
describe("the connect return trip", () => {
  const token = (workspaceId = WORKSPACE, userId = USER, issuedAt = Date.now()) =>
    encryptJson({ workspaceId, userId, issuedAt }, CREDENTIALS_KEY);

  const done = (app: ReturnType<typeof createServer>, query: string) =>
    app.request(`/auth/linkedin/done?${query}`);

  it("binds the account with no session anywhere in the request", async () => {
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_new", reference: "whoever", status: "ok" }];

    const res = await done(app, `claim=${encodeURIComponent(token())}&account_id=acct_new`);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/app/profile");
    const account = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(account.provider_account_id).toBe("acct_new");
    expect(account.status).toBe("active");
  });

  it("binds nothing without a token, and says so rather than rendering", async () => {
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_new", reference: "whoever", status: "ok" }];

    const res = await done(app, "account_id=acct_new");

    expect(res.status).toBe(302);
    // A sentence the person can act on, never the machine code the banner
    // used to print verbatim.
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toMatch(/didn't complete.*Connect LinkedIn/);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBeNull();
  });

  it("binds nothing for a token it did not mint", async () => {
    // The token is the whole authorisation, so a forged one must buy nothing.
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_new", reference: "whoever", status: "ok" }];
    const forged = encryptJson({ workspaceId: WORKSPACE, userId: USER, issuedAt: Date.now() }, "b".repeat(64));

    const res = await done(app, `claim=${encodeURIComponent(forged)}&account_id=acct_new`);

    // A sentence the person can act on, never the machine code the banner
    // used to print verbatim.
    expect(decodeURIComponent(res.headers.get("location") ?? "")).toMatch(/didn't complete.*Connect LinkedIn/);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBeNull();
  });

  it("binds nothing for a token that has gone stale", async () => {
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_new", reference: "whoever", status: "ok" }];
    const old = token(WORKSPACE, USER, Date.now() - 2 * 60 * 60_000);

    const res = await done(app, `claim=${encodeURIComponent(old)}&account_id=acct_new`);

    expect(decodeURIComponent(res.headers.get("location") ?? "")).toMatch(/expired.*Connect LinkedIn/);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBeNull();
  });

  it("cannot be pointed at an account another row already holds", async () => {
    // The token names who started the flow; it does not licence taking
    // somebody else's connection. That guard lives in claimAccount and has to
    // still apply on this path.
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    db.seed("linkedin_accounts", [
      {
        id: "44444444-4444-4444-8444-444444444444",
        workspace_id: WORKSPACE,
        user_id: "99999999-9999-4999-8999-999999999999",
        provider: "mock",
        provider_account_id: "acct_theirs",
        status: "active",
      },
    ]);
    linkedin.connectedAccounts = [{ providerAccountId: "acct_theirs", reference: "whoever", status: "ok" }];

    await done(app, `claim=${encodeURIComponent(token())}&account_id=acct_theirs`);

    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBeNull();
  });

  it("does not depend on the provider labelling the account with the rep", async () => {
    // The whole reason this path exists rather than a pull: the provider's
    // account list carries nothing tying an account to whoever started the
    // flow, so matching by reference can never work however it is spelled.
    const { db, app, linkedin } = harness({ provider_account_id: null, status: "connecting" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_new", reference: "Tashfeen Ahmad", status: "ok" },
    ];

    await done(app, `claim=${encodeURIComponent(token())}&account_id=acct_new`);

    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBe("acct_new");
  });
});

describe("the link the rep is sent to LinkedIn with", () => {
  it("comes back to the worker carrying a token, not to a page needing a cookie", async () => {
    const { ctx, app, linkedin } = harness();
    void ctx;

    const res = await app.request("/auth/linkedin/link", {
      method: "POST",
      body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER }),
      headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    expect(res.status).toBe(200);

    const asked = linkedin.lastHostedAuth!;
    // The worker's own host: the return has to reach the thing holding the key
    // that can read the token, and no page in between.
    expect(asked.successUrl.startsWith("http://worker.test/auth/linkedin/done")).toBe(true);
    expect(new URL(asked.successUrl).searchParams.get("claim")).toBeTruthy();
    // And a failed sign-in comes back through the worker too, carrying the
    // same token, so the failure is recorded before the person is sent on —
    // straight to the page, it was written nowhere.
    expect(asked.failureUrl.startsWith("http://worker.test/auth/linkedin/failed")).toBe(true);
    expect(new URL(asked.failureUrl).searchParams.get("claim")).toBeTruthy();
  });
});

/*
 * Pressing Connect on an account that already works.
 *
 * Every press used to write `connecting`, which every job skips — so a rep who
 * pressed Reconnect on a healthy account and then mistyped their password had
 * broken a working account by trying to repair it. The button is now on the
 * screen in every state, which makes that the common path rather than a rare
 * one.
 */
describe("reconnecting an account that already works", () => {
  function press(app: ReturnType<typeof createServer>) {
    return app.request("/auth/linkedin/link", {
      method: "POST",
      body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER }),
      headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
    });
  }

  it("leaves a working account sending while the sign-in is under way", async () => {
    const { db, app } = harness({ provider_account_id: "acct_live", status: "active" });

    expect((await press(app)).status).toBe(200);

    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status).toBe("active");
  });

  it("still starts a connection for a row that holds nothing", async () => {
    // The other half: a failed sign-in leaves `disconnected`, and pressing
    // Connect again must make that row claimable or the retry can never land.
    const { db, app } = harness({ provider_account_id: null, status: "disconnected" });

    await press(app);

    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status).toBe("connecting");
  });

  it("keeps the Sales Navigator tick and hours the rep set since signup", async () => {
    // A reconnect is a repair. It used to write the signup answers back over
    // whatever the rep had changed on their profile — a different search tier
    // chosen by nobody (rule 12).
    const { db, app } = harness({ provider_account_id: "acct_live", status: "active", has_sales_navigator: true, working_hours: { start: 7, end: 15, days: [1, 2, 3] } });
    db.seed("workspaces", [{ id: WORKSPACE, onboarding: { hasSalesNavigator: false, workingHours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] } } }]);

    await press(app);

    const row = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(row.has_sales_navigator).toBe(true);
    expect(row.working_hours).toEqual({ start: 7, end: 15, days: [1, 2, 3] });
  });

  it("calls a sign-in that came back with the same account a success", async () => {
    const { db, linkedin, app } = harness({ provider_account_id: "acct_live", status: "active" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_live", reference: USER, status: "ok" }];

    const res = await claim(app, { workspaceId: WORKSPACE, userId: USER, accountId: "acct_live" });

    expect(await res.json()).toMatchObject({ claimed: true });
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status).toBe("active");
  });
});

/*
 * Whose words come back to the browser when the provider refuses.
 *
 * `/auth/linkedin/link` and `/jobs/linkedin-claim` both answer the web app,
 * and the web app puts `error` straight into `?error=` and renders it in the
 * red banner on `/app/profile`. So this text is read by the rep who just
 * pressed Connect LinkedIn — and for a 401 it used to read "its administrator
 * needs to check the Unipile access token", and for a 404 "check the Unipile
 * DSN, including its port".
 *
 * That is rule 54 exactly, outside the screen rule 54 was written about: our
 * supply chain and our credentials printed on a customer's dashboard, with the
 * repair assigned to somebody they are not, in the one flow every customer has
 * to finish before the product does anything at all. And it was live — this
 * deployment's token and DSN belong to two different Unipile tenants, so 401
 * is the branch it actually hits.
 *
 * The sentence is not deleted, it is moved: `operatorProviderFailure` names
 * the variable and goes to the worker's log.
 */
describe("a provider refusal, in the words the rep reads", () => {
  /** Words that belong to whoever holds the credentials, and to nobody else. */
  const OPERATOR_ONLY = ["unipile", "dsn", "access token", "administrator", "deployment", "credential"];

  function refusing(status: number) {
    const h = harness();
    h.linkedin.createHostedAuthLink = async () => {
      throw new UnipileError(`failed with ${status}`, status, "nope");
    };
    h.linkedin.listAccounts = async () => {
      throw new UnipileError(`failed with ${status}`, status, "nope");
    };
    return h;
  }

  // Every status the function branches on, so no branch escapes by not being
  // exercised — which is how the system-check guard missed four of these.
  for (const status of [401, 403, 404, 500, 429]) {
    it(`says nothing operator-only to the rep on a ${status}`, async () => {
      const { app } = refusing(status);

      const link = await app.request("/auth/linkedin/link", {
        method: "POST",
        body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER }),
        headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
      });
      const body = (await link.json()) as { error?: string };

      expect(body.error, `a ${status} must still say something`).toBeTruthy();
      const said = (body.error ?? "").toLowerCase();
      for (const word of OPERATOR_ONLY) {
        expect(said, `a ${status} leaks "${word}" to the rep`).not.toContain(word);
      }
      // An environment variable is SHOUTED, which is how one is recognised
      // without listing every name this deployment might gain. Matched on the
      // real text, never a lowercased copy — that mistake made the identical
      // guard on `/app/system` test nothing for its whole life.
      expect(body.error ?? "").not.toMatch(/[A-Z][A-Z0-9]{3,}_[A-Z0-9_]+/);
    });
  }

  it("still tells the rep it is ours rather than leaving them to guess", async () => {
    // Moving the sentence must not turn into saying nothing: a refusal they
    // cannot act on has to name that it is ours and where to tell us.
    const { app } = refusing(401);
    const link = await app.request("/auth/linkedin/link", {
      method: "POST",
      body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER }),
      headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    const body = (await link.json()) as { error?: string };
    expect(body.error).toMatch(/ours to fix/i);
    expect(body.error).toMatch(/support/i);
  });

  it("gives the claim route the same treatment", async () => {
    // The other route the browser reads, and the one the connect return trip
    // runs on arrival.
    const { app } = refusing(401);
    const res = await claim(app, { workspaceId: WORKSPACE, userId: USER, accountId: "prov-1" });
    const body = (await res.json()) as { error?: string };
    expect((body.error ?? "").toLowerCase()).not.toContain("unipile");
    expect(body.error ?? "").not.toMatch(/[A-Z][A-Z0-9]{3,}_[A-Z0-9_]+/);
  });
});

/*
 * The one fact needed to repair the row by hand, written where it can be read.
 *
 * An account connected in the provider's own dashboard carries no reference to
 * the rep, so nothing binds it and rule 8 is right to refuse to guess. But the
 * ids went to `console.error` on a host nobody repairing this can reach, and
 * only the *shape* of each reference came back to the browser — so the
 * provider's actual account id was discovered and thrown away on every run,
 * which is what left this deployment pointing at a dead id with the live one
 * sitting beside it.
 */
/*
 * The live report: a customer's account was attached and working, and pressing
 * Check connection told her "the provider holds 3 accounts and none of them is
 * yours" — because it matched on the provider's label (her display name) and
 * never looked at the account her row already held.
 */
describe("checking a connection that already works", () => {
  it("recognises the account the row holds, whatever the provider labelled it", async () => {
    const { db, linkedin, app } = harness({ provider_account_id: "acct_patti", status: "connecting" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_other", reference: "Somebody Else", status: "ok" },
      { providerAccountId: "acct_patti", reference: "Patti Dubas", status: "ok" },
    ];

    const res = await app.request("/jobs/linkedin-refresh", {
      method: "POST",
      body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER }),
      headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.unlabelled).toBe(true);
    expect(body.referenceShape).toBeUndefined();
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.status).toBe("active");
  });
});

describe("what the provider holds, when none of it can be bound", () => {
  it("writes the ids down where an operator can read them", async () => {
    const { db, linkedin, app } = harness({ provider_account_id: "acct_dead", status: "connecting" });
    // Labelled with the LinkedIn display name, which is what the provider
    // returns for an account somebody connected in its own dashboard.
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: "Tashfeen Ahmad", displayName: "Tashfeen Ahmad", status: "ok" },
    ];

    const res = await app.request("/jobs/linkedin-refresh", {
      method: "POST",
      body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER }),
      headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
    });
    expect(res.status).toBe(200);

    const beat = db.find("worker_heartbeats", { name: "accounts:observed" });
    expect(beat, "nothing recorded, so the id is lost again").toBeTruthy();
    const detail = beat!.detail as { wanted: string; found: number; accounts: Array<{ providerAccountId: string }> };
    expect(detail.found).toBe(1);
    expect(detail.wanted).toBe(USER);
    expect(detail.accounts[0]?.providerAccountId).toBe("acct_live");
  });

  it("binds nothing on the strength of it", async () => {
    // Recording is not matching. The row keeps the id it had, because an
    // account the provider does not label with this rep is still not this
    // rep's to take (rule 8).
    const { db, linkedin, app } = harness({ provider_account_id: "acct_dead", status: "connecting" });
    linkedin.connectedAccounts = [
      { providerAccountId: "acct_live", reference: "Tashfeen Ahmad", status: "ok" },
    ];

    await app.request("/jobs/linkedin-refresh", {
      method: "POST",
      body: JSON.stringify({ workspaceId: WORKSPACE, userId: USER }),
      headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
    });

    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBe("acct_dead");
  });
});

/*
 * The worker hands Unipile's v1 credential to the parser.
 *
 * The parser accepting a header is not enough on its own: the route has to
 * read it off the request and pass it through, and a call site that forgets is
 * a fix that never reaches production — rule 39's lesson, that the bug lives
 * in the call site and a test of the helper passes throughout. Asserted on both
 * webhooks, because they are two routes.
 */
describe("the webhook routes pass Unipile's v1 header to the parser", () => {
  for (const route of ["/webhooks/unipile/messages", "/webhooks/unipile/accounts"] as const) {
    it(`reads Unipile-Auth on ${route}`, async () => {
      const { linkedin, app } = harness();
      const seen: Array<{ signature?: string; authHeader?: string }> = [];
      const capture = (input: { body: string; signature?: string; authHeader?: string }) => {
        seen.push({ signature: input.signature, authHeader: input.authHeader });
        return [];
      };
      linkedin.parseWebhook = capture as never;
      linkedin.parseAccountWebhook = capture as never;

      await app.request(route, {
        method: "POST",
        body: JSON.stringify({}),
        // Header names are case-insensitive on the wire; Unipile's own example
        // spells it this way.
        headers: { "content-type": "application/json", "Unipile-Auth": "the-shared-secret" },
      });

      expect(seen).toHaveLength(1);
      expect(seen[0]?.authHeader).toBe("the-shared-secret");
      expect(seen[0]?.signature).toBeUndefined();
    });
  }
});

/*
 * A LinkedIn sign-in that did not work.
 *
 * It used to land on the profile page with `?error=connection_failed`, which
 * the banner printed verbatim and nothing recorded. So a customer saw a machine
 * code, pressed Connect LinkedIn again, failed the same way — and from here,
 * "LinkedIn refused her sign-in" and "she never tried again" were the same
 * empty database. Both halves are asserted: the failure is written down, and
 * the person is told what usually causes it.
 */
describe("a LinkedIn sign-in that did not work", () => {
  function failed(app: ReturnType<typeof createServer>, query: string) {
    return app.request(`/auth/linkedin/failed?${query}`, { method: "GET" });
  }

  it("records the failure against the workspace it belongs to", async () => {
    const { db, app } = harness();
    const claim = encryptJson({ workspaceId: WORKSPACE, userId: USER, issuedAt: Date.now() }, CREDENTIALS_KEY);

    const res = await failed(app, `claim=${encodeURIComponent(claim)}&reason=checkpoint`);

    expect(res.status).toBe(302);
    const event = db.rows("events").find((e) => e.name === "linkedin.connect.failed");
    expect(event, "a failed sign-in was written nowhere").toBeTruthy();
    expect(event!.workspace_id).toBe(WORKSPACE);
    // What the provider appended is kept — it is the only clue to why — but
    // never the token itself.
    expect(JSON.stringify(event!.payload)).toContain("checkpoint");
    expect(JSON.stringify(event!.payload)).not.toContain(claim);
  });

  it("tells the person the usual causes instead of printing a code", async () => {
    const { app } = harness();
    const claim = encryptJson({ workspaceId: WORKSPACE, userId: USER, issuedAt: Date.now() }, CREDENTIALS_KEY);

    const res = await failed(app, `claim=${encodeURIComponent(claim)}`);
    const where = decodeURIComponent(res.headers.get("location") ?? "");

    expect(where).toContain("/app/profile");
    expect(where).not.toContain("connection_failed");
    // The cause nobody guesses: a Google- or Apple-created LinkedIn account has
    // no password to type on the sign-in page.
    expect(where).toMatch(/Google or Apple/);
    expect(where).toMatch(/Connect LinkedIn/);
  });

  it("records nothing for a token it did not mint, and says the same thing", async () => {
    // The route is public. A forged token must not write events into somebody
    // else's workspace, and must not be distinguishable from a real refusal.
    const { db, app } = harness();
    const forged = encryptJson({ workspaceId: WORKSPACE, userId: USER, issuedAt: Date.now() }, "b".repeat(64));

    const res = await failed(app, `claim=${encodeURIComponent(forged)}`);

    expect(res.status).toBe(302);
    expect(db.rows("events").some((e) => e.name === "linkedin.connect.failed")).toBe(false);
  });

  it("stops saying the account is connecting, because no sign-in happened", async () => {
    // The live case: the rep typed the wrong LinkedIn password on the hosted
    // page, came back, and every screen still read "connecting" — as if the
    // product were working on it, when nothing would change until they
    // pressed Connect again.
    const { db, app } = harness({ provider_account_id: null, status: "connecting" });
    const claim = encryptJson({ workspaceId: WORKSPACE, userId: USER, issuedAt: Date.now() }, CREDENTIALS_KEY);

    await failed(app, `claim=${encodeURIComponent(claim)}`);

    const row = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(row.status).toBe("disconnected");
    expect(String(row.status_detail)).toMatch(/No sign-in happened/);
    expect(String(row.status_detail)).toMatch(/try again/);
  });

  it("never breaks an account that was working when the reconnect failed", async () => {
    const { db, app } = harness({ provider_account_id: "acct_live", status: "active" });
    const claim = encryptJson({ workspaceId: WORKSPACE, userId: USER, issuedAt: Date.now() }, CREDENTIALS_KEY);

    await failed(app, `claim=${encodeURIComponent(claim)}`);

    const row = db.find("linkedin_accounts", { id: ACCOUNT })!;
    expect(row.status).toBe("active");
    expect(row.provider_account_id).toBe("acct_live");
  });

  it("records nothing for a stale token", async () => {
    const { db, app } = harness();
    const stale = encryptJson(
      { workspaceId: WORKSPACE, userId: USER, issuedAt: Date.now() - 2 * 60 * 60_000 },
      CREDENTIALS_KEY,
    );

    await failed(app, `claim=${encodeURIComponent(stale)}`);

    expect(db.rows("events").some((e) => e.name === "linkedin.connect.failed")).toBe(false);
  });
});
