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
