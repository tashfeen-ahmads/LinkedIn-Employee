import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LINKEDIN_LIMITS, MIN_FIT_TO_QUEUE, fitCutoffSentence, normalizeExclusionValue } from "@le/shared";
import { actionableQueue, sendEstimate, type QueuedRow } from "../src/lib/campaign.js";

/**
 * "N still to invite" and "about N working days" are promises about what the
 * sending loop will do. The send path closes three kinds of queued row instead
 * of inviting them, and the week stops at a ceiling the day does not know
 * about, so both numbers used to promise more than the loop would keep.
 */

function row(prospect: QueuedRow["prospect"], invited_at: string | null = null): QueuedRow {
  return { invited_at, prospect };
}

const clean = { do_not_contact: false, last_contacted_at: null, company: "Northwind", linkedin_url: "https://www.linkedin.com/in/jane" };

describe("actionableQueue", () => {
  it("counts everybody the send path would actually invite", () => {
    expect(actionableQueue([row(clean), row(clean)], [])).toEqual({ actionable: 2, skipped: 0 });
  });

  it("leaves out somebody marked do not contact", () => {
    const out = actionableQueue([row(clean), row({ ...clean, do_not_contact: true })], []);
    expect(out).toEqual({ actionable: 1, skipped: 1 });
  });

  it("leaves out somebody this workspace already contacted from another campaign", () => {
    // Rule 24: the send path closes them rather than inviting them.
    const out = actionableQueue([row({ ...clean, last_contacted_at: "2026-10-01T10:00:00Z" })], []);
    expect(out).toEqual({ actionable: 0, skipped: 1 });
  });

  it("leaves out somebody on the exclusion list, matched the way the send path matches", () => {
    const rules = [
      { kind: "company" as const, value: normalizeExclusionValue("company", "Northwind Ltd"), rawValue: "Northwind Ltd" },
    ];
    const out = actionableQueue([row(clean), row({ ...clean, company: "Contoso" })], rules);
    expect(out).toEqual({ actionable: 1, skipped: 1 });
  });

  it("counts a person once however many reasons apply", () => {
    const out = actionableQueue(
      [row({ ...clean, do_not_contact: true, last_contacted_at: "2026-10-01T10:00:00Z" })],
      [],
    );
    expect(out).toEqual({ actionable: 0, skipped: 1 });
  });
});

describe("sendEstimate", () => {
  it("holds a fast daily cap to the rolling week", () => {
    // 35 a day over five working days is 175; the week stops at 100.
    const out = sendEstimate({ remaining: 400, perDay: LINKEDIN_LIMITS.invitesPerDayMax, workingDaysPerWeek: 5 });
    const weekly = Math.floor(LINKEDIN_LIMITS.invitesPerWeek / 5);
    expect(out?.perDay).toBe(weekly);
    expect(out?.weeklyLimited).toBe(true);
    expect(out?.days).toBe(Math.ceil(400 / weekly));
  });

  it("keeps the daily cap when the week is not the limit", () => {
    const out = sendEstimate({ remaining: 41, perDay: 10, workingDaysPerWeek: 5 });
    expect(out).toEqual({ days: 5, perDay: 10, weeklyLimited: false, shared: 0 });
  });

  it("spreads the week over the account's own working days", () => {
    const five = sendEstimate({ remaining: 200, perDay: 35, workingDaysPerWeek: 5 });
    const seven = sendEstimate({ remaining: 200, perDay: 35, workingDaysPerWeek: 7 });
    expect(seven!.perDay).toBeLessThan(five!.perDay);
  });

  it("says how many other running campaigns share the account", () => {
    expect(sendEstimate({ remaining: 10, perDay: 10, workingDaysPerWeek: 5, otherRunningOnAccount: 2 })?.shared).toBe(2);
  });

  it("says nothing rather than dividing by zero or estimating an empty queue", () => {
    expect(sendEstimate({ remaining: 0, perDay: 10, workingDaysPerWeek: 5 })).toBeNull();
    expect(sendEstimate({ remaining: 10, perDay: 0, workingDaysPerWeek: 5 })).toBeNull();
    expect(sendEstimate({ remaining: 10, perDay: 10, workingDaysPerWeek: 0 })).not.toBeNull();
  });
});

describe("what the campaign screens say", () => {
  const page = readFileSync(join(__dirname, "../src/app/app/campaigns/[id]/page.tsx"), "utf8");

  it("counts still to invite from the actionable queue, not every queued row", () => {
    expect(page).toMatch(/\{actionable\} still to invite/);
    expect(page).not.toMatch(/\{queued\.length\} still to invite/);
  });

  it("no longer claims every person matched on title, industry and location", () => {
    expect(page).not.toMatch(/still matched on\s+title, industry and location/);
    expect(page).toContain('href="/app/profile#sales-navigator"');
  });

  it("states the queue cut-off from the one constant", () => {
    expect(fitCutoffSentence()).toContain(String(MIN_FIT_TO_QUEUE));
    expect(fitCutoffSentence()).not.toMatch(/[–—]/);
    expect(page).toContain("fitCutoffSentence()");
  });
});
