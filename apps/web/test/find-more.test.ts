import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { growableCampaign } from "../src/lib/find-more";

/*
 * Finding more people is a strategy-level act. The Prospects page's button was
 * a link to the campaign's overview, which searched nothing, and the strategy
 * page's started a new search from the first page, which found nobody new once
 * a campaign existed. Both now grow the strategy's running campaign.
 */

const S = "strategy-1";
const row = (over: Partial<Parameters<typeof growableCampaign>[0][number]>) => ({
  id: "c",
  status: "running",
  customer_profile_id: S,
  search_exhausted: false,
  created_at: "2026-11-01T00:00:00Z",
  ...over,
});

describe("growableCampaign", () => {
  it("picks the running campaign over a newer draft", () => {
    const pick = growableCampaign(
      [row({ id: "draft", status: "draft", created_at: "2026-11-10T00:00:00Z" }), row({ id: "live" })],
      S,
    );
    expect(pick?.id).toBe("live");
  });

  it("never grows a finished, archived or exhausted campaign, or another strategy's", () => {
    expect(
      growableCampaign(
        [
          row({ id: "a", status: "archived" }),
          row({ id: "b", status: "completed" }),
          row({ id: "c", search_exhausted: true }),
          row({ id: "d", customer_profile_id: "other" }),
        ],
        S,
      ),
    ).toBeNull();
  });

  it("takes the newest usable one when none is running", () => {
    const pick = growableCampaign(
      [row({ id: "old", status: "paused" }), row({ id: "new", status: "paused", created_at: "2026-11-09T00:00:00Z" })],
      S,
    );
    expect(pick?.id).toBe("new");
  });
});

describe("where Find more lives", () => {
  const read = (p: string) => readFileSync(new URL(`../src/app/app/${p}`, import.meta.url), "utf8");

  it("is a search on the Prospects page, never a link to the campaign", () => {
    const page = read("prospects/find/page.tsx");
    expect(page).toContain("action={growStrategy}");
    expect(page).not.toContain("Find more on this campaign");
  });

  it("grows the running campaign from the strategy page", () => {
    expect(read("strategy/[id]/page.tsx")).toContain("action={growStrategy}");
  });

  it("goes through one path, the campaign's own button included", () => {
    expect(read("campaigns/[id]/actions.ts")).toContain("queueFindMore(supabase, session, campaignId)");
    expect(read("strategy/actions.ts")).toContain("queueFindMore(supabase, session, campaign.id)");
  });
});
