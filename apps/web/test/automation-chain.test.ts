import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

const strategyPage = read("../src/app/app/strategy/page.tsx");
const strategyJob = read("../../worker/src/jobs/strategy.ts");

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
