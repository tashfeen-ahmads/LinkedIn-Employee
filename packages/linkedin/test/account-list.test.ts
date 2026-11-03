import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";

/*
 * The pull path read the push path's fields. `GET /accounts` has no
 * `reference` and its `name` is the LinkedIn display name, so reading
 * `reference ?? name` made every account's reference a person's name: nothing
 * ever matched a rep's user id, recovery repaired 0, and `account_name` — not
 * in this payload — left every display name null.
 */
describe("UnipileProvider.listAccounts", () => {
  const items = [
    {
      object: "Account",
      id: "acct_1",
      name: "Tashfeen Ahmad",
      type: "LINKEDIN",
      created_at: "2026-10-20T10:00:00Z",
      sources: [{ id: "acct_1_MESSAGING", status: "OK" }],
      connection_params: {},
      groups: [],
    },
  ];
  const provider = new UnipileProvider({
    dsn: "https://api.test",
    accessToken: "t",
    fetchImpl: (async () =>
      new Response(JSON.stringify({ items }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
  });

  it("reads the display name from `name`, and never treats it as the rep's reference", async () => {
    const [account] = await provider.listAccounts();
    expect(account?.providerAccountId).toBe("acct_1");
    expect(account?.displayName).toBe("Tashfeen Ahmad");
    // A display name is not who started the flow, and must never bind a row.
    expect(account?.reference).toBe("");
  });

  it("keeps a listed account with no reference, so a rep's own returned id can be found in it", async () => {
    expect(await provider.listAccounts()).toHaveLength(1);
  });
});

/*
 * The state is on the account's sources, not at the top. Read as
 * `item.status ?? "OK"`, every listed account was healthy, and a page load put
 * an account the health check had just said needed signing in back to active.
 */
describe("UnipileProvider.listAccounts state", () => {
  const listed = (sources: unknown) => {
    const provider = new UnipileProvider({
      dsn: "https://api.test",
      accessToken: "t",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ items: [{ object: "Account", id: "a", name: "A", type: "LINKEDIN", sources }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    return provider.listAccounts().then((all) => all[0]?.status);
  };

  it("reads the state from the account's sources", async () => {
    expect(await listed([{ id: "a_MESSAGING", status: "OK" }])).toBe("ok");
    expect(await listed([{ id: "a_MESSAGING", status: "CREDENTIALS" }])).toBe("reauth_required");
  });

  it("calls an account with no state unknown, never healthy", async () => {
    expect(await listed(undefined)).toBe("unknown");
  });
});

describe("a disconnected account on a send", () => {
  it("is a health signal, so the account is paused at the first refusal", async () => {
    const provider = new UnipileProvider({
      dsn: "https://api.test",
      accessToken: "t",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ status: 401, type: "errors/disconnected_account", title: "Disconnected account", detail: "The account appears to be disconnected from the provider service." }),
          { status: 401, headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });
    const result = await provider.sendInvitation({ accountId: "a", providerId: "p", note: undefined });
    expect(result.ok).toBe(false);
    expect(result.health).toBe("reauth_required");
  });
});
