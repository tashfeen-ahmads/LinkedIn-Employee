import { describe, expect, it } from "vitest";
import { linkedInState, SIGN_IN_DID_NOT_HAPPEN } from "../src/app/app/profile/linkedin-state";

/**
 * What every screen says about a rep's LinkedIn account.
 *
 * A sign-in LinkedIn refused left the row at `connecting`, and the profile, the
 * team table and the banner all printed that word — so a customer watched
 * "connecting" for a sign-in that had already failed in front of her. A row
 * with no account behind it is not connected, and says so.
 */
describe("linkedInState", () => {
  it("never calls a row with no account behind it connecting", () => {
    for (const status of ["connecting", "disconnected", "reauth_required", "active"]) {
      const said = linkedInState({ status, provider_account_id: null });
      expect(said.kind, status).not.toBe("attached");
      expect(said.label, status).toBe("not connected");
    }
  });

  it("tells somebody whose sign-in failed that none happened, and to try again", () => {
    const said = linkedInState({ status: "disconnected", provider_account_id: null, status_detail: null });
    expect(said.kind).toBe("failed");
    expect(said.kind === "failed" && said.detail).toBe(SIGN_IN_DID_NOT_HAPPEN);
    expect(SIGN_IN_DID_NOT_HAPPEN).toMatch(/No sign-in happened/);
    expect(SIGN_IN_DID_NOT_HAPPEN).toMatch(/try again/);
  });

  it("keeps a connect that is still under way apart from one that failed", () => {
    expect(linkedInState({ status: "connecting", provider_account_id: null }).kind).toBe("unfinished");
  });

  it("reports a real account by its status, and never as connecting", () => {
    expect(linkedInState({ status: "reauth_required", provider_account_id: "a" }).label).toBe("reauth required");
    expect(linkedInState({ status: "connecting", provider_account_id: "a" }).label).toBe("needs reconnecting");
  });

  it("reads no row as not connected", () => {
    expect(linkedInState(null)).toEqual({ kind: "none", label: "not connected" });
  });
});
