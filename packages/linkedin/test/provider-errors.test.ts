import { describe, expect, it } from "vitest";
import { classifyProviderError, describeCooldown } from "../src/provider-errors.js";

/** The exact strings this deployment has actually been handed by Unipile. */
const LIVE = {
  temporaryLimit:
    "Unipile POST /api/v1/users/invite failed with 422: Cannot resend yet — You have reached a temporary provider limit. Please try again later. — errors/cannot_resend_yet",
  recentlyInvited:
    "Unipile POST /api/v1/users/invite failed with 422: Should delay new invitation to this recipient — An invitation has already been sent recently to this recipient. Please try again later. — errors/already_invited_recently",
};

describe("reading a provider refusal", () => {
  it("treats LinkedIn's temporary limit as temporary", () => {
    /*
     * The one that cost seven real prospects. Every refusal was written as a
     * permanent failure with no next action, on an error whose own words are
     * "please try again later", and the campaign screen then read as seven bad
     * prospects rather than one throttled account.
     */
    const verdict = classifyProviderError(LIVE.temporaryLimit);

    expect(verdict.kind).toBe("retry_later");
    // Hours, not minutes. A rejected invitation is a request LinkedIn logs
    // against an account it has already decided to slow down.
    if (verdict.kind === "retry_later") expect(verdict.cooldownMs).toBeGreaterThanOrEqual(60 * 60_000);
  });

  it("treats a recently-invited recipient as temporary", () => {
    expect(classifyProviderError(LIVE.recentlyInvited).kind).toBe("retry_later");
  });

  it("blames the recipient for a recipient's refusal, not the account", () => {
    /*
     * "An invitation has already been sent recently to this recipient" is a
     * fact about that recipient. Read as an account-wide throttle it put a
     * live account into a twenty-four hour hold over one awkward row, and the
     * other twenty-five people on the list could not be written to — one
     * prospect silencing a campaign, which is the failure the account-wide
     * pause exists to prevent, pointed the wrong way.
     */
    const verdict = classifyProviderError(LIVE.recentlyInvited);
    expect(verdict.kind === "retry_later" && verdict.scope).toBe("prospect");
  });

  it("blames the account for an account-wide limit", () => {
    const verdict = classifyProviderError(LIVE.temporaryLimit);
    expect(verdict.kind === "retry_later" && verdict.scope).toBe("account");
  });

  it.each([
    "Unipile POST /api/v1/users/invite failed with 422: Cannot send invitation to this member",
    "Unipile POST /api/v1/users/invite failed with 404: member not found",
    "invitation failed",
  ])("treats %s as permanent", (error) => {
    expect(classifyProviderError(error).kind).toBe("permanent");
  });

  it("treats a refusal it does not recognise as permanent", () => {
    // Conservative on purpose and in one direction only: retrying an unknown
    // error against LinkedIn for ever is how an account gets restricted, and a
    // restricted account is the failure this product cannot come back from.
    expect(classifyProviderError("something nobody has seen before").kind).toBe("permanent");
  });

  it.each([null, undefined, ""])("treats %s as permanent rather than guessing", (error) => {
    // A failure that said nothing about itself is not evidence that retrying
    // is safe.
    expect(classifyProviderError(error).kind).toBe("permanent");
  });

  it("reads a transport failure as nothing having been decided", () => {
    // The provider never answered, so nothing was settled about this person,
    // and "failed" is the one reading that is certainly wrong.
    expect(classifyProviderError("Unipile POST /api/v1/users/invite failed with 503").kind).toBe(
      "retry_later",
    );
  });

  it("says what is happening in words a rep can act on", () => {
    const said = describeCooldown(
      "LinkedIn is temporarily refusing invitations from this account",
      new Date("2026-09-24T18:00:00Z"),
      7,
    );

    // Never "7 failed", which reads as seven bad prospects.
    expect(said).toMatch(/7 people are waiting/);
    expect(said).toMatch(/automatically/);
    expect(said).toMatch(/Nothing is lost/);
  });
});
