import { describe, expect, it } from "vitest";
import { emailAliases, loginIdentifier } from "../src/accounts.js";

describe("emailAliases", () => {
  it("treats every Proton spelling of one inbox as the same person", () => {
    // A customer set up as …@pm.me, came back as …@proton.me, and was given
    // a new empty account.
    expect(emailAliases("Patti.D@Proton.me")).toEqual([
      "patti.d@proton.me",
      "patti.d@pm.me",
      "patti.d@protonmail.com",
      "patti.d@protonmail.ch",
    ]);
  });

  it("leaves every other address exactly as it is", () => {
    expect(emailAliases("ron@ronsworkperks.com")).toEqual(["ron@ronsworkperks.com"]);
    expect(emailAliases("not an email")).toEqual([]);
  });
});

describe("loginIdentifier", () => {
  it("tells an email from a username", () => {
    expect(loginIdentifier(" Sam@Acme.com ")).toEqual({ kind: "email", email: "sam@acme.com" });
    expect(loginIdentifier("sam_patel")).toEqual({ kind: "username", username: "sam_patel" });
    expect(loginIdentifier("")).toBeNull();
    expect(loginIdentifier("two words")).toBeNull();
  });
});
