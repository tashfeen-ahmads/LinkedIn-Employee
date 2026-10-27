import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Building a campaign from a list: the form's ids are claims.
 *
 * The account id decides whose LinkedIn every message goes out from, and the
 * prospect ids decide who receives them. Both arrived from a form and were
 * inserted as given, so a stale page added somebody contacted since it loaded,
 * and an edited one could name an account this workspace does not own.
 */
// The builder's step 1, in its actions file.
const page = readFileSync(join(__dirname, "../src/app/app/campaigns/new/actions.ts"), "utf8");
const start = page.indexOf("async function createCampaign");
const action = page.slice(start, page.indexOf("\nexport async function", start));

describe("createCampaign", () => {
  it("checks the sending account belongs to this workspace and is connected", () => {
    expect(action).toMatch(
      /from\("linkedin_accounts"\)[\s\S]{0,120}\.eq\("id", accountId\)\s*\.eq\("workspace_id", session\.workspaceId\)\s*\.eq\("status", "active"\)/,
    );
    expect(action.indexOf('from("linkedin_accounts")')).toBeLessThan(action.indexOf('from("campaigns")'));
  });

  it("re-reads the chosen people under the rule the list was drawn with", () => {
    expect(action).toMatch(
      /from\("prospects"\)[\s\S]{0,200}\.in\("id", chosen\)\s*\.is\("last_contacted_at", null\)\s*\.eq\("do_not_contact", false\)/,
    );
  });

  it("inserts only the people that survived the re-read", () => {
    expect(action).toMatch(/from\("campaign_prospects"\)\.insert\(\s*people\.map/);
    expect(action).not.toMatch(/from\("campaign_prospects"\)\.insert\(\s*chosen\.map/);
  });
});
