import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECENT_MS, SEARCH_EVENTS, STALLED_MS, describeLastSearch } from "../src/lib/last-search";

/**
 * Every successful prospect search reported itself as a failure.
 *
 * The strategy page read only `targeting.queued` and `targeting.stopped`, so a
 * search that built a campaign left its own `targeting.queued` as the newest
 * row, and the page said "the background worker took the job and did not
 * finish it" for ever after — above the campaign that search had produced. It
 * also printed the event's payload to the customer as JSON.
 */
const NOW = Date.parse("2026-10-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("describeLastSearch", () => {
  it("says nothing once the search has finished", () => {
    for (const name of ["campaign.created", "campaign.extended"]) {
      expect(describeLastSearch({ name, payload: {}, created_at: ago(60_000) }, NOW)).toBeNull();
    }
  });

  it("queries the completion events, or the line above can never be reached", () => {
    expect(SEARCH_EVENTS).toEqual(
      expect.arrayContaining(["targeting.queued", "targeting.stopped", "campaign.created", "campaign.extended"]),
    );
  });

  it("treats a report older than six hours as history", () => {
    const old = { name: "targeting.stopped", payload: { reason: "x" }, created_at: ago(RECENT_MS + 1) };
    expect(describeLastSearch(old, NOW)).toBeNull();
  });

  it("calls a fresh search in progress, and a long-silent one stalled", () => {
    expect(describeLastSearch({ name: "targeting.queued", payload: {}, created_at: ago(30_000) }, NOW)?.tone).toBe(
      "muted",
    );
    const stalled = describeLastSearch(
      { name: "targeting.queued", payload: {}, created_at: ago(STALLED_MS + 1) },
      NOW,
    );
    expect(stalled?.tone).toBe("warning");
    expect(stalled?.title).toMatch(/has not reported back/);
  });

  it("gives a stop's reason and nothing else of its payload", () => {
    const notice = describeLastSearch(
      {
        name: "targeting.stopped",
        payload: { reason: "Your customer profile matched nobody.", build: "abc123", campaignId: "c-1", threw: true },
        created_at: ago(60_000),
      },
      NOW,
    );
    expect(notice?.body).toBe("Your customer profile matched nobody.");
    expect(JSON.stringify(notice)).not.toMatch(/abc123|campaignId|threw/);
  });

  it("names a stop with no reason rather than printing an empty line", () => {
    const notice = describeLastSearch({ name: "targeting.stopped", payload: null, created_at: ago(60_000) }, NOW);
    expect(notice?.body).toBe("No reason was recorded.");
  });
});

describe("the strategy page", () => {
  const page = readFileSync(join(__dirname, "..", "src", "app", "app", "strategy", "page.tsx"), "utf8");

  it("reads the last search through describeLastSearch", () => {
    expect(page).toMatch(/\.in\("name", SEARCH_EVENTS\)/);
    expect(page).toMatch(/describeLastSearch\(lastStop\)/);
  });

  it("never prints an event's payload to the customer", () => {
    expect(page).not.toMatch(/JSON\.stringify\(/);
    expect(page).not.toMatch(/background worker took the job/);
  });
});
