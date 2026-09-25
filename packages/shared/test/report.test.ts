import { describe, expect, it } from "vitest";
import { dailyReport, roughly, type ReportFacts } from "../src/report.js";

/**
 * The report is prose a person reads, so the assertions are about what it says
 * and refuses to say — not about its shape.
 */

const QUIET: ReportFacts = {
  warmed: 0,
  invited: 0,
  accepted: 0,
  messaged: 0,
  replies: 0,
  meetings: 0,
  optedOut: 0,
  held: [],
  throttledMs: 0,
  allowance: { used: 0, cap: 14 },
  loopStalled: false,
};

const BUSY: ReportFacts = {
  ...QUIET,
  warmed: 38,
  invited: 12,
  messaged: 3,
  accepted: 3,
  replies: 1,
  allowance: { used: 12, cap: 14 },
};

const text = (facts: ReportFacts) => dailyReport(facts).join(" ");

describe("a day with work in it", () => {
  it("says what it did, in one sentence", () => {
    expect(text(BUSY)).toContain("I looked at 38 profiles, sent 12 invitations and wrote 3 messages.");
  });

  it("reports acceptances and replies", () => {
    expect(text(BUSY)).toContain("3 people accepted.");
    expect(text(BUSY)).toContain("1 person replied.");
  });

  it("says the account is inside its limits", () => {
    // The most expensive engineering in this repo is invisible unless it
    // fails. Said on a day it worked, it becomes a reason to renew.
    expect(text(BUSY)).toContain("Well inside your limits — 12 of 14 invitations today");
  });

  it("never prints a zero as a result", () => {
    // "0 meetings booked" reads as failure on a day when nobody was ever
    // going to book one. Leaving it out reads as "it did not come up".
    const said = text(BUSY);
    expect(said).not.toMatch(/\b0 (meetings?|people|messages?)/);
    expect(said).not.toContain("meeting");
  });

  it("counts one person in the singular", () => {
    expect(text({ ...QUIET, invited: 1, accepted: 1, replies: 1 })).toContain("1 invitation");
    expect(text({ ...QUIET, invited: 1, accepted: 1 })).toContain("1 person accepted.");
  });
});

describe("a quiet day", () => {
  it("says why it was quiet", () => {
    // Four situations produce the same silence and need four different
    // responses from whoever is reading.
    expect(text({ ...QUIET, quietReason: "outside_working_hours" })).toContain(
      "outside your sending hours",
    );
    expect(text({ ...QUIET, quietReason: "allowance_spent" })).toContain("allowance was already used up");
    expect(text({ ...QUIET, quietReason: "nobody_queued" })).toContain("nobody left waiting");
    expect(text({ ...QUIET, quietReason: "no_campaigns" })).toContain("no campaign is running");
  });

  it("admits when it does not know why", () => {
    // A confident sentence about an unexplained quiet day stops somebody
    // looking into it, which is the one outcome worth avoiding.
    expect(text(QUIET)).toContain("nothing in the record says why");
  });

  it("does not claim to be inside its limits on a day it sent nothing", () => {
    // Technically true and worthless: an account that sent nothing is inside
    // every limit there is.
    expect(text(QUIET)).not.toContain("Well inside your limits");
  });
});

describe("when the loop is not running", () => {
  it("says that and nothing else", () => {
    /*
     * Rule 21, in prose. Everything else in this report describes work being
     * done; if the thing that does the work is down, every one of those
     * sentences is a comfortable lie and the reader should stop reading and
     * go and fix the deployment.
     */
    const lines = dailyReport({ ...BUSY, loopStalled: true });

    expect(lines.join(" ")).toContain("the sending loop is not running");
    expect(lines.join(" ")).not.toContain("38 profiles");
    expect(lines.join(" ")).not.toContain("Well inside your limits");
    expect(lines.join(" ")).toContain("problem with the deployment");
  });

  it("outranks a held conversation", () => {
    // A held reply matters, and it matters less than nobody being able to
    // send the answer.
    const lines = dailyReport({
      ...BUSY,
      loopStalled: true,
      held: [{ reason: "asked about pricing", count: 1 }],
    });
    expect(lines.join(" ")).not.toContain("pricing");
  });
});

describe("what is waiting for a person", () => {
  it("is always said, even on a busy day", () => {
    // The only part of the report that is an ask rather than a statement.
    // Burying it under good news is how a warm lead goes cold on a Friday.
    const said = text({ ...BUSY, held: [{ reason: "asked about pricing", count: 1 }] });
    expect(said).toContain("One conversation is waiting for you: asked about pricing.");
  });

  it("counts and names several reasons", () => {
    const said = text({
      ...BUSY,
      held: [
        { reason: "asked about pricing", count: 2 },
        { reason: "wants to speak to a person", count: 1 },
      ],
    });
    expect(said).toContain("3 conversations are waiting for you");
    expect(said).toContain("asked about pricing (2)");
    expect(said).toContain("wants to speak to a person");
  });

  it("still says how many when the reasons are blank", () => {
    // `needs_human_reason` is free text and nothing guarantees it is filled.
    // A count with no reason is still an ask; silence is not.
    expect(text({ ...BUSY, held: [{ reason: "  ", count: 2 }] })).toContain(
      "2 conversations are waiting for you.",
    );
  });
});

describe("a throttle", () => {
  it("explains a slow day rather than leaving it looking like a bad one", () => {
    const said = text({ ...BUSY, invited: 4, throttledMs: 4 * 60 * 60_000 });
    expect(said).toContain("LinkedIn slowed invitations down for about 4 hours");
    // And says what it did instead, which is the whole argument for warming.
    expect(said).toContain("looking at profiles for the next batch");
  });

  it("does not claim to be inside its limits on a day LinkedIn pushed back", () => {
    // It is the one sentence that would be actively false.
    expect(text({ ...BUSY, throttledMs: 2 * 60 * 60_000 })).not.toContain("Well inside your limits");
  });

  it("is the reason on a day nothing went out at all", () => {
    expect(text({ ...QUIET, quietReason: "throttled", throttledMs: 6 * 60 * 60_000 })).toContain(
      "LinkedIn held invitations from this account for about 6 hours",
    );
  });
});

describe("roughly", () => {
  it("speaks in units a person would say aloud", () => {
    expect(roughly(45 * 60_000)).toBe("about 45 minutes");
    expect(roughly(4 * 60 * 60_000)).toBe("about 4 hours");
    expect(roughly(60 * 60_000)).toBe("about 60 minutes");
    expect(roughly(3 * 86_400_000)).toBe("about 3 days");
  });

  it("never says zero", () => {
    // A throttle that lasted seconds is still a throttle; "about 0 minutes"
    // reads as a bug in the report rather than a short hold.
    expect(roughly(2000)).toBe("about 1 minute");
  });
});
