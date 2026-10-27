import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inboxStageOf } from "../src/lib/inbox-stage";
import { AVAILABILITY_DEFAULTS, availabilityProblem } from "../src/lib/availability";

const src = (...parts: string[]) => readFileSync(join(__dirname, "..", "src", ...parts), "utf8");

describe("inbox stages", () => {
  /*
   * Everyone written to appears somewhere. Ended rows were read as "no stage"
   * and vanished from every tab, and a negative reply was not a reply.
   */
  it("places live rows by their status", () => {
    expect(inboxStageOf({ status: "invited" })).toBe("invited");
    expect(inboxStageOf({ status: "messaged_2" })).toBe("messaged");
    expect(inboxStageOf({ status: "meeting_booked" })).toBe("booked");
    expect(inboxStageOf({ status: "negative" })).toBe("replied");
  });

  it("places an ended row by the furthest thing that happened to it", () => {
    const invited_at = "2026-10-01T10:00:00Z";
    const accepted_at = "2026-10-02T10:00:00Z";
    expect(inboxStageOf({ status: "closed", invited_at })).toBe("invited");
    expect(inboxStageOf({ status: "failed", invited_at, accepted_at })).toBe("accepted");
    expect(inboxStageOf({ status: "closed", invited_at, accepted_at, last_step_sent: 2 })).toBe("messaged");
    expect(inboxStageOf({ status: "opted_out", invited_at, accepted_at, replied_at: "2026-10-03T10:00:00Z" })).toBe("replied");
  });

  it("leaves out anybody nobody wrote to", () => {
    expect(inboxStageOf({ status: "queued" })).toBeNull();
    expect(inboxStageOf({ status: "closed" })).toBeNull();
  });

  it("the page reads the timestamps it needs", () => {
    expect(src("app", "app", "inbox", "page.tsx")).toMatch(/invited_at, accepted_at, replied_at, last_step_sent/);
  });
});

describe("meeting timezone", () => {
  const base = {
    timezone: "America/New_York",
    start: 9,
    end: 17,
    days: [...AVAILABILITY_DEFAULTS.days],
    meetingMinutes: 30,
    minNoticeHours: 12,
    bufferMinutes: 15,
    maxPerDay: 3,
    location: null,
  };

  it("refuses a zone the calendar cannot read, such as the live row's \"Eastern\"", () => {
    expect(availabilityProblem({ ...base, timezone: "Eastern" })).toMatch(/timezone/);
    expect(availabilityProblem({ ...base, timezone: "" })).toMatch(/timezone/);
    expect(availabilityProblem(base)).toBeNull();
  });

  it("is picked from the list, and an unreadable saved zone is said and not used", () => {
    const page = src("app", "app", "meetings", "availability.tsx");
    expect(page).toMatch(/<TimezoneSelect value=\{current\.timezone\} \/>/);
    expect(page).not.toMatch(/<input name="timezone"/);
    expect(page).toMatch(/usableTimezone\(merged\.timezone, ownTimezone\)/);
    expect(page).toMatch(/is not one the calendar can\s+read/);
  });

  it("a profile timezone change is carried onto the meeting hours", () => {
    // The timezone is set beside the sending hours it is read with.
    const profile = src("app", "app", "profile", "hours", "page.tsx");
    expect(profile).toMatch(/timezone !== before\?\.timezone\) \{\s*await carryTimezoneToAvailability\(/);
    expect(src("lib", "availability.ts")).toMatch(/\.from\("availability"\)\s*\.update\(\{ timezone: timezone\.trim\(\)/);
  });
});

describe("the overview's setup block", () => {
  it("is shown while a required step is outstanding, and the knowledge base is a prompt of its own", () => {
    const overview = src("app", "app", "page.tsx");
    expect(overview).toMatch(/const required = nextRequiredStep\(setup\)/);
    expect(overview).toMatch(/\{required \? \(\s*<PageGroup id="setup">/);
    expect(overview).not.toMatch(/\{next \? \(/);
  });
});

describe("the pitch warning", () => {
  it("warns about held follow-ups only when a live step is built from {{pitch}}", () => {
    const page = src("app", "app", "pitch", "page.tsx");
    expect(page).toMatch(/const pitchInUse = \(liveSteps \?\? \[\]\)\.some\(\(step\) => usesPitch\(/);
    // The held-follow-up sentence itself is behind the check, not only the box.
    expect(page).toMatch(/noDefault\(pitches\) && pitchInUse\s*\?\s*"No approved pitch is set as the default/);
  });
});

describe("approving on /app/strategy", () => {
  it("applies the call to action chosen in setup to a strategy that has none", () => {
    // Shared by the business profile and every strategy's own page.
    const page = src("app", "app", "strategy", "actions.ts");
    const action = page.slice(page.indexOf("async function approveProfile"), page.indexOf("async function dropProfile"));
    expect(action).toMatch(/current && !current\.cta_id \? await chosenCtaColumns\(supabase, session\.workspaceId, session\.userId\) : \{\}/);
    // Onboarding's own reading of the choice: this person's first, then the workspace's.
    expect(src("lib", "cta-library.ts")).toMatch(/readConfirmations\(me\?\.setup_confirmed, workspaceId\)\.ctaChoice \?\? readOnboardingStash\(workspace\?\.onboarding\)\.cta/);
  });

  it("saving a strategy's ask points it at the matching library entry", () => {
    const page = src("app", "app", "strategy", "actions.ts");
    expect(page).toMatch(/cta_url: ctaUrl,\s*cta_id: ctaId,/);
  });
});
