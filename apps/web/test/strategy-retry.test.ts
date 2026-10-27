import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chooseStrategySource,
  hasStrategySource,
  mergeStash,
  readOnboardingStash,
  sourceFromForm,
  stashedAccountAnswers,
} from "../src/lib/onboarding-stash";

/**
 * A Strategy Agent run that failed could not be run again.
 *
 * "Try again", the fifteen-minute hint and the strategy page's empty state all
 * linked to `/onboarding`, and `/onboarding` sends anybody with a membership to
 * `/app` — so the only button on a failed run took the person from the
 * dashboard back to the dashboard. Nothing else in the product could start the
 * agent's first run, and a workspace stuck there stayed stuck.
 */
const SRC = join(__dirname, "..", "src");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

describe("the onboarding stash", () => {
  it("reads what onboarding wrote, and nothing it did not", () => {
    const stash = readOnboardingStash({
      workingHours: { start: 9, end: 17, days: [1, 2, 3] },
      hasSalesNavigator: true,
      autonomy: "autonomous",
      source: { websiteUrl: " https://acme.test ", description: "" },
    });
    expect(stash.workingHours).toEqual({ start: 9, end: 17, days: [1, 2, 3] });
    expect(stash.hasSalesNavigator).toBe(true);
    expect(stash.autonomy).toBe("autonomous");
    // Trimmed, and a blank field is absent rather than an empty string the
    // agent would be handed as "the description".
    expect(stash.source).toEqual({ websiteUrl: "https://acme.test" });
  });

  it("survives a column holding something else entirely", () => {
    // jsonb: a null, a string or an array can land there, and the screen still
    // has to render.
    for (const value of [null, "x", [1, 2], { workingHours: "9-5", hasSalesNavigator: "yes" }]) {
      const stash = readOnboardingStash(value);
      expect(stash.workingHours).toBeNull();
      expect(stash.hasSalesNavigator).toBeNull();
      expect(stash.source).toEqual({});
    }
  });

  it("prefers what was just typed, and never mixes the two", () => {
    const kept = { websiteUrl: "https://old.test", description: "old" };
    expect(chooseStrategySource({ websiteUrl: "https://new.test" }, kept)).toEqual({ websiteUrl: "https://new.test" });
    expect(chooseStrategySource({}, kept)).toEqual(kept);
    // Nothing to read is a form to fill in, not a run the agent would refuse.
    expect(chooseStrategySource({}, {})).toBeNull();
    expect(hasStrategySource({})).toBe(false);
  });

  it("does not count a LinkedIn page alone as something Sage can read", () => {
    // Nothing fetches it: a run given only that address stored a business and a
    // strategy with every field blank, and the strategy could be approved.
    expect(hasStrategySource({ linkedinCompanyUrl: "https://linkedin.com/company/acme" })).toBe(false);
    expect(chooseStrategySource({ linkedinCompanyUrl: "https://linkedin.com/company/acme" }, {})).toBeNull();
    expect(hasStrategySource({ linkedinCompanyUrl: "x", description: "We fit heat pumps." })).toBe(true);
  });

  it("reads the three fields from a form", () => {
    const form = new FormData();
    form.set("websiteUrl", "  ");
    form.set("linkedinCompanyUrl", "https://linkedin.com/company/acme");
    form.set("description", " Sells widgets ");
    expect(sourceFromForm(form)).toEqual({
      linkedinCompanyUrl: "https://linkedin.com/company/acme",
      description: "Sells widgets",
    });
  });

  it("merges rather than replaces, so one screen cannot erase another's answer", () => {
    const current = { autonomy: "autonomous", source: { websiteUrl: "https://acme.test" } };
    expect(mergeStash(current, { hasSalesNavigator: true })).toEqual({ ...current, hasSalesNavigator: true });
    expect(mergeStash(null, { hasSalesNavigator: false })).toEqual({ hasSalesNavigator: false });
  });
});

describe("retrying the Strategy Agent", () => {
  it("is a real retry, not a link to a page that sends members away", () => {
    const status = read("components", "strategy-status.tsx");
    expect(status).not.toMatch(/href="\/onboarding"/);
    expect(status).toMatch(/<StrategyRetryButton/);

    const strategy = read("app", "app", "strategy", "page.tsx");
    expect(strategy).not.toMatch(/href="\/onboarding"/);
    expect(strategy).toMatch(/<StrategyDetailsForm/);

    const retry = read("components", "strategy-retry.tsx");
    expect(retry).toMatch(/STRATEGY_RETRY = "\/app\/strategy\/retry"/);
    expect(retry).toMatch(/action=\{STRATEGY_RETRY\} method="post"/);
  });

  it("re-queues from the stash, and refuses to write a second business", () => {
    const retry = read("lib", "strategy-retry.ts");
    expect(retry).toMatch(/callWorker\("\/jobs\/strategy"/);
    // Without `expand` the agent writes a business profile; with one already
    // here that is a second copy of the same company.
    expect(retry).not.toMatch(/expand:/);
    expect(retry).toMatch(/if \(business\) return/);
    expect(retry).toMatch(/readOnboardingStash\(workspace\?\.onboarding\)\.source/);
    // No source at all goes to the form, not to the worker.
    expect(retry).toMatch(/if \(!source\) \{[\s\S]{0,200}?#details/);
  });

  it("is a plain form post, which survives a deploy", () => {
    const route = read("app", "app", "strategy", "retry", "route.ts");
    expect(route).toMatch(/export async function POST/);
    expect(route).toMatch(/const to = await retryStrategy\(form\)/);
    expect(route).toMatch(/return seeOther\(/);
  });

  it("onboarding keeps what Sage was asked to read", () => {
    const create = read("lib", "create-workspace.ts");
    expect(create).toMatch(/source: sourceFromForm\(formData\)/);
  });

  it("onboarding shows the retry to a member with no business profile", () => {
    const onboarding = read("app", "onboarding", "page.tsx");
    // Having a workspace is not having finished: the page goes to /app only
    // when no step is left (rule 65), and a run that failed or never started
    // is retried from the business and strategy steps.
    expect(onboarding).not.toMatch(/if \(existing\?\.length\) redirect\("\/app"\)/);
    expect(onboarding).toMatch(/if \(!step\) redirect\("\/app"\)/);
    // And that is the only way out to /app: a workspace on its own is not one.
    expect(onboarding.match(/redirect\("\/app"\)/g)?.length).toBe(1);
    expect(onboarding.match(/<StrategyDetailsForm/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("account answers saved before an account exists", () => {
  it("translates the account patch into the names the worker reads", () => {
    expect(
      stashedAccountAnswers({ has_sales_navigator: true, working_hours: { start: 7, end: 15, days: [1, 2] } }),
    ).toEqual({ hasSalesNavigator: true, workingHours: { start: 7, end: 15, days: [1, 2] } });
  });

  it("leaves out what the save did not touch", () => {
    // A save without the hours must not clear the window onboarding chose.
    expect(stashedAccountAnswers({ has_sales_navigator: false })).toEqual({ hasSalesNavigator: false });
  });

  it("writes them to the stash when no account row was updated", () => {
    // The sending hours are saved on their own section now.
    const profile = read("app", "app", "profile", "hours", "page.tsx");
    expect(profile).toMatch(/\.from\("linkedin_accounts"\)\s*\.update\(accountPatch as never\)[\s\S]{0,200}?\.select\("id"\)/);
    expect(profile).toMatch(
      /if \(!updatedAccounts\?\.length\) \{[\s\S]{0,600}?onboarding: mergeStash\(wsStash\?\.onboarding, stashedAccountAnswers\(accountPatch\)\)/,
    );
  });

  it("does not say Saved over a stash write the database refused", () => {
    // Only an owner or admin may update the workspace row, and a refused
    // update matches nothing rather than failing.
    const profile = read("app", "app", "profile", "hours", "page.tsx");
    expect(profile).toMatch(/accountAnswersKept = Boolean\(stashed\?\.length\)/);
    expect(profile).toMatch(/accountAnswersKept\s*\?\s*"Saved\."/);
  });

  it("shows the stash's values on the form until the row exists", () => {
    // The hours on their section, the plan on the LinkedIn account section,
    // whose plan choices are the radio buttons of `SalesNavigatorSection`.
    expect(read("app", "app", "profile", "hours", "page.tsx")).toMatch(/readWorkingHours\(stash\.workingHours\)/);
    const linkedin = read("app", "app", "profile", "linkedin", "page.tsx");
    expect(linkedin).toMatch(/planOf\(\{ has_sales_navigator: stash\.hasSalesNavigator, has_premium: stash\.hasPremium \}\)/);
    expect(linkedin).toMatch(/<SalesNavigatorSection plan=\{plan\}/);
    expect(read("app", "app", "profile", "sales-navigator-section.tsx")).toMatch(/defaultChecked=\{option\.value === plan\}/);
  });
});
