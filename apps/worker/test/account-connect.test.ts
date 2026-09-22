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

  it("leaves a healthy account alone", async () => {
    const { db, linkedin } = harness({ provider_account_id: "acct_live", status: "active" });
    linkedin.connectedAccounts = [{ providerAccountId: "acct_other", reference: USER, status: "ok" }];
    const { recoverAccounts } = await import("../src/accounts.js");

    const result = await recoverAccounts(db.asDb(), linkedin);

    // Not in the list it looks at, so an active account is never re-pointed by
    // a background job.
    expect(result.repaired).toBe(0);
    expect(db.find("linkedin_accounts", { id: ACCOUNT })!.provider_account_id).toBe("acct_live");
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
