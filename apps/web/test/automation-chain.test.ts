import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

const strategyPage = read("../src/app/app/strategy/page.tsx");
const strategyJob = read("../../worker/src/jobs/strategy.ts");
const campaignPage = read("../src/app/app/campaigns/[id]/page.tsx");
const signupPage = read("../src/app/signup/page.tsx");

/**
 * The links a claim about automation rests on, asserted at the call sites.
 *
 * Each of these is a place where one half of the product hands something to
 * the other half, and each has failed here before by being *nearly* wired: the
 * value existed, the reader existed, and the one line joining them did not.
 * A test of either side alone passes throughout — rule 39's lesson.
 */
describe("approving a strategy starts the search", () => {
  it("approving queues the targeting job itself", () => {
    // It used to set a flag and stop, so an approved workspace and an
    // unapproved one looked identical until somebody found a second button.
    const marker = "async function approveProfile(";
    expect(strategyPage.includes(marker), "approveProfile moved or was renamed").toBe(true);
    const body = strategyPage.slice(strategyPage.indexOf(marker));
    const end = body.indexOf("\nasync function ", 1);
    const action = end === -1 ? body : body.slice(0, end);

    expect(action).toContain("approved_at");
    expect(action).toMatch(/await queueSearch\(/);
  });

  it("the manual button and approving take the same path", () => {
    // Two copies of the same twelve lines is the shape a rule takes just
    // before they drift, and this one decides whether anybody is searched for.
    const calls = strategyPage.match(/await queueSearch\(/g) ?? [];
    expect(calls.length, "approving and the button should both call it").toBe(2);
    // And exactly one definition of it.
    expect((strategyPage.match(/async function queueSearch\(/g) ?? []).length).toBe(1);
  });

  it("a strategy that already has a campaign is not searched again", () => {
    // Rule 24 means the second list finds nobody, so it would be a search that
    // can only ever report zero — and it spends a seat somebody pays for.
    const body = strategyPage.slice(strategyPage.indexOf("async function approveProfile("));
    expect(body).toMatch(/\.from\("campaigns"\)[\s\S]{0,300}?customer_profile_id/);
  });

  it("approving still succeeds when the search cannot start", () => {
    // Losing the approval to a disconnected LinkedIn account would be the
    // product refusing a decision it already has.
    expect(strategyPage).toMatch(/Approved, but the search has not started/);
    expect(strategyPage).toMatch(/It never throws/);
  });
});

describe("what onboarding collects reaches the agent", () => {
  it("the strategy job reads the bio, not only the name", () => {
    // Both are on one row. Selecting only the name is how the promise that
    // "invitations go out in your voice" was kept for replies and broken for
    // invitations.
    expect(strategyJob).toMatch(/\.select\("full_name, bio"\)/);
    expect(strategyJob).toMatch(/repBio: owner\?\.bio \?\? null/);
  });
});

/**
 * How many of these people are getting the generic note, before Launch.
 *
 * Every card already says so on its own, and that is ten cards to scroll to
 * learn a number somebody needs before pressing a button that cannot be taken
 * back. A live campaign here was built with ten people on it and three
 * personalised notes, and nothing above the list said so — which is rule 27's
 * "the review screen shows a campaign that reads as personalised and is not",
 * arrived at by a route the rule did not anticipate: the writer came back
 * short rather than failing.
 */
describe("the review screen counts the generic notes", () => {
  it("counts them from the rows it is about to show", () => {
    // From the rows, not from the worker's event: a human may have written one
    // by hand since, and a count taken from anywhere else can disagree with
    // the list printed underneath it.
    expect(campaignPage).toMatch(/const onTemplate = rows\.filter\(\(row\) => !row\.invite_note\)\.length;/);
  });

  it("says the number above the list, not only on each card", () => {
    expect(campaignPage).toMatch(/\{onTemplate\} of \{rows\.length\}/);
    // And says nothing at all when everybody has one, because a notice that is
    // always there is a notice nobody reads.
    expect(campaignPage).toMatch(/\{onTemplate > 0 \?/);
  });
});

/**
 * Setting a password signs you in.
 *
 * `signUp` returns a session when the project does not require a confirmed
 * address, and this discarded it and redirected to "check your inbox" — so
 * somebody who had just chosen a password still could not get in, and the
 * password was beside the point: the only way through was a link in an email.
 * That is the flow this replaced, wearing a password field.
 *
 * Which of the two it is comes from the response, never from an environment
 * variable naming the setting: the project decides, and a second reading of
 * somebody else's setting is one that can disagree with it.
 */
describe("signing up", () => {
  it("keeps the session rather than throwing it away", () => {
    expect(signupPage).toMatch(/const \{ data: created, error \} = await supabase\.auth\.signUp\(/);
  });

  it("goes straight on when there is a session", () => {
    expect(signupPage).toMatch(/if \(created\.session\) \{[\s\S]{0,400}?redirect\(/);
    expect(signupPage).toMatch(/"\/onboarding"/);
  });

  it("still says to check the inbox when confirmation really is required", () => {
    // A screen that says "you are in" over a session that does not exist
    // sends somebody to a login that will refuse them.
    expect(signupPage).toMatch(/redirect\(`\/signup\?sent=/);
  });
});
