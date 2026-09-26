import { describe, expect, it } from "vitest";
import { NOTHING_NEEDS_YOU, needsYou, type NeedsYouFacts } from "../src/needs-you.js";

/**
 * What needs a person, as one ordered list.
 *
 * The assertions are about order and about what the list refuses to say, not
 * about its shape — those are the two things three callers must agree on.
 */

const CALM: NeedsYouFacts = {
  loopStalled: false,
  linkedInConnected: true,
  webhookRefused: null,
  heldReplies: 0,
  heldBookings: 0,
  heldForCopy: 0,
  pitchesUnapproved: 0,
  hooksUnapproved: 0,
  strategiesUnapproved: 0,
  campaignsUnlaunched: 0,
  campaignsWithThinNotes: 0,
  campaignsMissingCta: 0,
};

const kinds = (facts: NeedsYouFacts) => needsYou(facts).map((item) => item.kind);

describe("a day with nothing waiting", () => {
  it("is empty, and the screen has a sentence for it", () => {
    // Zero items is the good day. A dashboard that looks broken when
    // everything is fine teaches people to stop opening it.
    expect(needsYou(CALM)).toEqual([]);
    expect(NOTHING_NEEDS_YOU).toContain("Nothing needs you");
  });
});

describe("a webhook refusing deliveries", () => {
  it("is a blocker, because it is the quietest failure there is", () => {
    /*
     * Every other row is something visibly undone. This one looks exactly like
     * a working deployment nobody has replied to yet: LinkedIn holds the reply,
     * the worker answers 401 exactly as it should, and the funnel reports a
     * zero that reads as an audience problem. It sat on `/app/system` where
     * only somebody already suspicious would look.
     */
    const items = needsYou({ ...CALM, webhookRefused: "no_signature" });
    expect(items[0]?.kind).toBe("webhook_refused");
    expect(items[0]?.tone).toBe("blocker");
  });

  it("says what it costs them, never what is broken in here", () => {
    /*
     * It named a webhook, a signing secret and "the provider" — our vendor and
     * our plumbing, on a business owner's dashboard. They do not know what any
     * of that is and cannot change a single part of it. The distinction between
     * the two refusals is real and belongs on the system check behind the admin
     * flag, where somebody can act on it.
     */
    for (const kind of ["no_signature", "bad_signature"] as const) {
      const row = needsYou({ ...CALM, webhookRefused: kind })[0]!;
      const text = `${row.title} ${row.why}`;
      for (const jargon of ["webhook", "signature", "signing secret", "provider", "deployment", "endpoint"]) {
        expect(text.toLowerCase()).not.toContain(jargon);
      }
    }
  });

  it("asks for the only thing they can actually do", () => {
    // A row whose action the reader cannot perform is rule 8 one step worse:
    // repair waiting not for somebody to find a button, but for somebody who
    // could never press it.
    const row = needsYou({ ...CALM, webhookRefused: "no_signature" })[0]!;
    expect(row.href).toBe("/app/support");
    expect(row.why).toContain("ours to fix rather than yours");
  });

  it("says nothing when deliveries are fine, or when none has ever arrived", () => {
    // A red row on every workspace whose first campaign has had no reply yet
    // is a check that cries wolf until nobody reads it.
    expect(needsYou(CALM)).toEqual([]);
  });
});

describe("order", () => {
  it("puts the deployment above everything else", () => {
    /*
     * Rule 21, in a list. A held reply matters and it matters less than nobody
     * being able to send the answer: while the loop is down, every row under it
     * is a job that cannot finish.
     */
    const order = kinds({
      ...CALM,
      loopStalled: true,
      heldReplies: 3,
      strategiesUnapproved: 2,
    });
    expect(order[0]).toBe("loop_stalled");
  });

  it("puts a disconnected account above the work that depends on it", () => {
    const order = kinds({ ...CALM, linkedInConnected: false, heldReplies: 1, campaignsUnlaunched: 1 });
    expect(order[0]).toBe("linkedin_disconnected");
  });

  it("hides nothing behind a blocker", () => {
    /*
     * Rule 32 lets a disconnected account silence every other *mark*, because a
     * sidebar with six dots has no dots. This is a to-do list, and dropping
     * work from one because other work exists is how something waits a
     * fortnight. Ordered, never filtered.
     */
    const order = kinds({
      ...CALM,
      loopStalled: true,
      linkedInConnected: false,
      heldReplies: 1,
      strategiesUnapproved: 1,
      campaignsUnlaunched: 1,
    });
    expect(order).toContain("held_reply");
    expect(order).toContain("strategy_unapproved");
    expect(order).toContain("campaign_unlaunched");
  });

  it("puts a warm lead above work that has not started", () => {
    const order = kinds({ ...CALM, heldReplies: 1, strategiesUnapproved: 3, campaignsUnlaunched: 2 });
    expect(order.indexOf("held_reply")).toBeLessThan(order.indexOf("strategy_unapproved"));
    expect(order.indexOf("held_reply")).toBeLessThan(order.indexOf("campaign_unlaunched"));
  });

  it("puts a campaign about to send bad notes above one that has not launched", () => {
    // A campaign that will launch and send the wrong thing is worse than one
    // that has not launched at all.
    const order = kinds({ ...CALM, campaignsWithThinNotes: 1, campaignsUnlaunched: 1 });
    expect(order.indexOf("thin_notes")).toBeLessThan(order.indexOf("campaign_unlaunched"));
  });

  it("does not reorder itself as the numbers move", () => {
    // A list that re-sorts by count is one somebody has to read from the top
    // every time.
    const few = kinds({ ...CALM, heldReplies: 1, strategiesUnapproved: 40 });
    const many = kinds({ ...CALM, heldReplies: 40, strategiesUnapproved: 1 });
    expect(few).toEqual(many);
  });
});

describe("a conversation held for copy", () => {
  it("is its own row, not a reply", () => {
    /*
     * Rule 40 holds a follow-up built from {{pitch}} rather than failing it,
     * and leaves its schedule untouched. There is no draft to read — the message
     * was never rendered — and the act that releases it is on the Agents
     * screen. Counted as a reply, the rep is sent to the inbox to look for a
     * draft that does not exist.
     */
    const items = needsYou({ ...CALM, heldForCopy: 2 });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("pitch_unapproved");
    expect(items[0]?.href).toBe("/app/agents");
    expect(items[0]?.tone).toBe("blocker");
  });

  it("outranks an ordinary unapproved offer, and replaces it", () => {
    // One row per kind. "2 conversations held" and "3 offers waiting" are the
    // same errand, and listing both makes the list look longer than the work.
    const items = needsYou({ ...CALM, heldForCopy: 2, pitchesUnapproved: 3 });
    expect(items.filter((i) => i.kind === "pitch_unapproved")).toHaveLength(1);
    expect(items[0]?.title).toContain("held");
  });

  it("is a plain warning when nothing is actually held", () => {
    const items = needsYou({ ...CALM, pitchesUnapproved: 3 });
    expect(items[0]?.tone).toBe("warning");
    expect(items[0]?.title).toContain("written and waiting");
  });
});

describe("every row", () => {
  const busy: NeedsYouFacts = {
    loopStalled: true,
    linkedInConnected: false,
    heldReplies: 2,
    heldBookings: 1,
    heldForCopy: 1,
    pitchesUnapproved: 1,
    hooksUnapproved: 1,
    strategiesUnapproved: 1,
    campaignsUnlaunched: 1,
    campaignsWithThinNotes: 1,
    campaignsMissingCta: 1,
  };

  it("names what happens if nobody does it", () => {
    // "1 strategy needs review" is a chore. "Nothing is searched for until one
    // is approved" is a reason.
    for (const item of needsYou(busy)) {
      expect(item.why.length).toBeGreaterThan(40);
      expect(item.why).not.toBe(item.title);
    }
  });

  it("carries a destination and a verb", () => {
    for (const item of needsYou(busy)) {
      expect(item.href.startsWith("/app")).toBe(true);
      expect(item.action).toMatch(/^[A-Z]/);
      expect(item.count).toBeGreaterThan(0);
    }
  });

  it("appears exactly once", () => {
    const seen = needsYou(busy).map((i) => i.kind);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("counts one person in the singular", () => {
    expect(needsYou({ ...CALM, heldReplies: 1 })[0]?.title).toBe("1 reply is waiting for you.");
    expect(needsYou({ ...CALM, heldReplies: 2 })[0]?.title).toBe("2 replies are waiting for you.");
    expect(needsYou({ ...CALM, strategiesUnapproved: 1 })[0]?.title).toContain("1 strategy is");
    expect(needsYou({ ...CALM, strategiesUnapproved: 2 })[0]?.title).toContain("2 strategies are");
  });
});
