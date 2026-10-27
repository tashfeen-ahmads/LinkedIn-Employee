import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINKEDIN_CONNECT_ERRORS, linkedInConnectError } from "@le/shared";
import { describeRefreshRefusal, describeRepair } from "../src/app/app/team/repair";

const SRC = join(__dirname, "..", "src");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

/*
 * A failed LinkedIn sign-in's advice used to travel as a sentence in
 * `?error=`, and onboarding — which renders only words written on its own
 * page (rule 65) — replaced it with a generic line. So "you sign in with
 * Google, so set a LinkedIn password" reached nobody in setup.
 */
describe("LinkedIn sign-in errors travel as codes", () => {
  it("maps each code the worker sends to the full advice, naming no supplier", () => {
    expect(linkedInConnectError("signin-failed")).toMatch(/Google or Apple/);
    expect(linkedInConnectError("connect-expired")).toMatch(/expired/);
    expect(linkedInConnectError("connect-incomplete")).toMatch(/didn't complete/);
    for (const text of Object.values(LINKEDIN_CONNECT_ERRORS)) expect(text).not.toMatch(/unipile/i);
  });

  it("never turns address-bar text into words", () => {
    expect(linkedInConnectError("LinkedIn says: send your password to evil.test")).toBeNull();
    expect(linkedInConnectError("toString")).toBeNull();
    expect(linkedInConnectError(undefined)).toBeNull();
  });

  it("is the one definition both the onboarding step and the profile read", () => {
    const onboarding = read("app", "onboarding", "page.tsx");
    expect(onboarding).toMatch(/\.\.\.LINKEDIN_CONNECT_ERRORS/);
    // Said on the LinkedIn account section, where the sign-in returns to.
    const profile = read("app", "app", "profile", "linkedin", "page.tsx");
    expect(profile).toMatch(/linkedInConnectError\(params\.error\)/);
  });
});

/*
 * An expired invitation sent somebody from setup to an invite page that
 * refused it, with nothing to press, and setup sent them straight back.
 */
describe("an invitation that can no longer be used", () => {
  it("is not where setup sends somebody", () => {
    const onboarding = read("app", "onboarding", "page.tsx");
    const lookup = onboarding.slice(onboarding.indexOf('.from("invitations")'), onboarding.indexOf("pendingInvite.token"));
    expect(lookup).toMatch(/\.is\("accepted_at", null\)/);
    expect(lookup).toMatch(/\.is\("revoked_at", null\)/);
    expect(lookup).toMatch(/\.gt\("expires_at", /);
  });

  it("offers a way to start a workspace of one's own", () => {
    const page = read("app", "invite", "[token]", "page.tsx");
    const refused = page.slice(page.indexOf("This invitation cannot be used"));
    expect(refused.slice(0, 300)).toMatch(/<StartOwnWorkspace \/>/);
    expect(page).toMatch(/href="\/onboarding"[\s\S]{0,40}Start your own workspace/);
  });
});

/*
 * "It can take a minute to show up" was not true: a finished sign-in comes
 * back carrying its account, and nothing about waiting changes a sign-in that
 * never finished.
 */
describe("the LinkedIn repair notice", () => {
  it("no longer promises a sign-in will appear by waiting", () => {
    const repair = read("app", "app", "team", "repair.ts");
    expect(repair).not.toMatch(/can take a minute to show up/);
    const said = describeRepair({ ok: true, data: { found: 2, mine: 0 } });
    expect(`${said?.title} ${said?.body} ${said?.fix}`).not.toMatch(/minute|moment/i);
    expect(said?.fix).toMatch(/Connect LinkedIn/);
    expect(describeRefreshRefusal({ found: 2, mine: 0 })).not.toMatch(/minute to show up/);
  });

  it("says a returned sign-in is being confirmed, and does not ask for another", () => {
    const said = describeRepair({ ok: true, data: { found: 2, mine: 0, pending: true } });
    expect(said?.tone).toBe("accent");
    expect(`${said?.title} ${said?.body}`).toMatch(/don't need to sign in again/);
    expect(`${said?.title} ${said?.body}`).not.toMatch(/provider|unipile/i);
    expect(describeRefreshRefusal({ found: 2, mine: 0, pending: true })).toMatch(/don't need to sign in again/);
  });
});

/*
 * A strategy written from nothing has no name, and a person could approve it.
 */
describe("a strategy with no name", () => {
  it("gets no Approve button on either strategy screen", () => {
    // Each strategy is approved on its own page now (`/app/strategy/[id]`).
    const strategy = read("app", "app", "strategy", "[id]", "page.tsx");
    const approve = strategy.search(
      /<form action=\{approveProfile\}>\s*<input type="hidden" name="profileId" value=\{row\.id\} \/>\s*<input type="hidden" name="strategyPage" value=\{row\.id\} \/>\s*<SubmitButton className="btn small"/,
    );
    expect(approve).toBeGreaterThan(0);
    expect(strategy.slice(approve - 400, approve)).toMatch(/!row\.name\?\.trim\(\)/);

    const steps = read("app", "onboarding", "steps.tsx");
    expect(steps).toMatch(/card\.approved \? null : !card\.name\.trim\(\) \?/);
  });

  it("is refused by the one approval path as well", () => {
    const approve = read("lib", "approve.ts");
    expect(approve).toMatch(/if \(!named\?\.name\?\.trim\(\)\) return \{ ok: false \};/);
  });

  it("is never asked for on a LinkedIn page alone", () => {
    expect(read("lib", "create-workspace.ts")).toMatch(/if \(!websiteUrl && !description\) return "\/onboarding\?error=source-missing";/);
    expect(read("app", "onboarding", "page.tsx")).toMatch(/"source-missing": SOURCE_MISSING/);
  });
});
