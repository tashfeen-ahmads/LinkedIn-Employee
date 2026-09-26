import { describe, expect, it } from "vitest";
import { weeklyReportEmail } from "../src/templates.js";

/**
 * The email a rep forwards to whoever signs off the subscription.
 *
 * The daily digest is a working tool — counters and the number waiting — and it
 * is the wrong thing to forward. This one carries sentences, and it carries
 * sentences it did not write: `dailyReport` and `knowledgeSentences` produce
 * them, so the email and the dashboard cannot describe one week differently.
 */

const base = {
  to: "rep@example.com",
  repName: "Jane Smith",
  appUrl: "https://app.example.com",
  lines: ["I looked at 38 profiles, sent 12 invitations and wrote 3 messages.", "3 people accepted."],
  knowledge: ["Your agent has 5 approved openers and 3 approved offer lines."],
  invited: 12,
  accepted: 3,
};

describe("the weekly report", () => {
  it("leads with what happened to somebody, not with effort", () => {
    /*
     * "12 invitations sent" is a sentence about effort, and it is what every
     * tool in this category puts in a subject line. An acceptance is the first
     * thing that happened *to* a person, so it is the first thing worth opening
     * for.
     */
    expect(weeklyReportEmail(base).subject).toBe("3 people accepted this week");
  });

  it("falls back to activity only when nothing was accepted", () => {
    expect(weeklyReportEmail({ ...base, accepted: 0 }).subject).toBe("Your week: 12 invitations");
    expect(weeklyReportEmail({ ...base, accepted: 0, invited: 0 }).subject).toBe(
      "Your week on LinkedIn Employee",
    );
  });

  it("carries the words it was given, rather than writing its own", () => {
    // The whole reason `lines` is an input. Two assemblies of one week disagree,
    // and the rep believes whichever they opened.
    const mail = weeklyReportEmail(base);
    for (const line of base.lines) {
      expect(mail.html).toContain(line);
      expect(mail.text).toContain(line);
    }
  });

  it("includes what the agent has accumulated", () => {
    const mail = weeklyReportEmail(base);
    expect(mail.html).toContain("What your agent knows");
    expect(mail.html).toContain("5 approved openers");
  });

  it("leaves the section out entirely when there is nothing in it", () => {
    // A heading over an empty list is a product admitting it has nothing to say.
    const mail = weeklyReportEmail({ ...base, knowledge: [] });
    expect(mail.html).not.toContain("What your agent knows");
  });

  it("greets somebody by their first name only", () => {
    expect(weeklyReportEmail(base).text.startsWith("Jane, here is your week.")).toBe(true);
    expect(weeklyReportEmail({ ...base, repName: null }).text.startsWith("Here is your week.")).toBe(true);
  });
});
