import { describe, expect, it } from "vitest";
import { UnipileProvider } from "../src/unipile.js";

/*
 * Nothing was ever withdrawn on any account: the call went to
 * `/users/invite/{id}`, which the provider refuses, instead of
 * `/users/invite/sent/{id}`. The refusal was skipped without a word, and the
 * piles of unanswered invitations grew until LinkedIn stopped taking new ones.
 */
describe("withdrawing an invitation", () => {
  it("cancels at /users/invite/sent/{id} for the account, with DELETE", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ object: "InvitationCanceled" }), { status: 200 });
    }) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });

    const result = await provider.withdrawInvitation({ accountId: "acct", invitationId: "inv 7" });

    expect(result.ok).toBe(true);
    expect(seen[0]!.init.method).toBe("DELETE");
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe("/api/v1/users/invite/sent/inv%207");
    expect(url.searchParams.get("account_id")).toBe("acct");
  });

  it("hands back the provider's refusal rather than reporting a withdrawal", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ type: "errors/invalid_invitation_id", title: "Invalid invitation id" }), {
        status: 400,
      })) as typeof fetch;
    const provider = new UnipileProvider({ dsn: "https://api.test", accessToken: "t", fetchImpl });
    const result = await provider.withdrawInvitation({ accountId: "acct", invitationId: "nope" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
