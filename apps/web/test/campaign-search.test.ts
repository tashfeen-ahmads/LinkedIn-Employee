import { describe, expect, it } from "vitest";
import { describeSearch } from "../src/app/app/campaigns/[id]/search-state";

/**
 * What the campaign page says about the last press of "Find more".
 *
 * The search runs in the worker, so the page that starts it never learns how it
 * went. Every one of these states used to look identical on screen — the same
 * list, unchanged — which is what had somebody pressing the button over and
 * over and reporting that nothing happened.
 */

const AT = "2026-09-17T12:00:00Z";
const NOW = new Date("2026-09-17T12:01:00Z").getTime();

describe("describeSearch", () => {
  it("says a search is still running", () => {
    const notice = describeSearch({ name: "targeting.queued", payload: {}, created_at: AT }, NOW);
    expect(notice?.tone).toBe("muted");
    expect(notice?.title).toMatch(/Searching/);
  });

  it("counts what was added and what was already known", () => {
    const notice = describeSearch(
      { name: "campaign.extended", payload: { added: 12, searched: 50, alreadyKnown: 38 }, created_at: AT },
      NOW,
    );
    expect(notice?.title).toBe("Added 12 people.");
    // Both halves. "Added 12" alone makes a page of 50 look like a bad search;
    // naming the 38 makes it the deduplication doing its job.
    expect(notice?.body).toContain("38");
    expect(notice?.body).toContain("Press Find more again");
  });

  it("does not call a page of people we already had a failure", () => {
    const notice = describeSearch(
      { name: "campaign.extended", payload: { added: 0, searched: 50, alreadyKnown: 50 }, created_at: AT },
      NOW,
    );
    expect(notice?.tone).not.toBe("danger");
    expect(notice?.title).toBe("Nobody new on that page.");
  });

  it("says when there is no next page to press for", () => {
    const notice = describeSearch(
      { name: "campaign.extended", payload: { added: 3, searched: 9, alreadyKnown: 6, exhausted: true }, created_at: AT },
      NOW,
    );
    expect(notice?.body).toContain("last page");
    expect(notice?.body).not.toContain("Press Find more again");
  });

  it("repeats the worker's own reason when a search stopped early", () => {
    const notice = describeSearch(
      { name: "targeting.stopped", payload: { reason: "LinkedIn's provider refused the search." }, created_at: AT },
      NOW,
    );
    expect(notice?.tone).toBe("danger");
    expect(notice?.body).toBe("LinkedIn's provider refused the search.");
  });

  it("still says something when the payload carries no reason", () => {
    // A blank danger box is worse than the plain state it replaced.
    const notice = describeSearch({ name: "targeting.stopped", payload: null, created_at: AT }, NOW);
    expect(notice?.body).toBeTruthy();
  });

  it("drops a report old enough to be about a different list", () => {
    // Last week's stop notice sitting above the button reads as the state of
    // the button, and talks somebody out of a press that would have worked.
    const old = describeSearch(
      { name: "targeting.stopped", payload: { reason: "whatever" }, created_at: "2026-09-10T12:00:00Z" },
      NOW,
    );
    expect(old).toBeNull();
  });

  it("says nothing when there is nothing to say", () => {
    expect(describeSearch(null, NOW)).toBeNull();
  });
});
