import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BRAND } from "@le/shared";
import { LEAD, NORA, TEAM, type TeamFacts, teamStatus } from "../src/lib/team";

/**
 * NORA's team: one definition, and status lines that only say what is true.
 *
 * The panel on the overview is a second place this product reports on itself,
 * and every rule about the first place applies: a line that calls a teammate
 * busy when nothing was queued is rule 17's disease, a cheerful count over a
 * disconnected account is rule 21's, and a needs-you number that disagrees
 * with the list above it is rule 50's.
 */

const QUIET: TeamFacts = {
  strategyPhase: "ready",
  strategiesApproved: 0,
  strategiesAwaiting: 0,
  prospectsFound: 0,
  campaignsTotal: 0,
  campaignsRunning: 0,
  campaignsDraft: 0,
  invited: 0,
  replied: 0,
  meetings: 0,
  meetingsCounted: true,
  heldReplies: 0,
  linkedInConnected: true,
  needsYou: 0,
};

describe("the team", () => {
  it("is led by the brand, spelt from BRAND rather than typed", () => {
    expect(NORA).toBe(BRAND.name.toUpperCase());
    expect(LEAD.name).toBe(NORA);
  });

  it("is four people in hand-off order", () => {
    expect(TEAM.map((m) => m.name)).toEqual(["Sage", "Scout", "Quinn", "Reese"]);
    for (const member of TEAM) {
      expect(member.does.length, member.name).toBeGreaterThanOrEqual(2);
      expect(member.does.length, member.name).toBeLessThanOrEqual(3);
      expect(member.href.startsWith("/app")).toBe(true);
    }
  });
});

describe("teamStatus", () => {
  it("reads a fresh workspace as waiting, never as working", () => {
    const status = teamStatus({ ...QUIET, strategyPhase: "absent" });
    for (const line of Object.values(status)) expect(line.state).not.toBe("working");
    expect(status.sage.state).toBe("waiting");
  });

  it("only calls Sage busy while a strategy run is actually queued", () => {
    expect(teamStatus({ ...QUIET, strategyPhase: "running" }).sage.state).toBe("working");
    expect(teamStatus({ ...QUIET, strategyPhase: "failed" }).sage.state).toBe("blocked");
  });

  it("puts strategies waiting for approval ahead of the ones approved", () => {
    const status = teamStatus({ ...QUIET, strategiesApproved: 5, strategiesAwaiting: 3 });
    expect(status.sage.status).toBe("3 strategies waiting for your approval.");
    expect(status.sage.state).toBe("waiting");
    expect(teamStatus({ ...QUIET, strategiesApproved: 1 }).sage.status).toBe("1 strategy approved.");
  });

  it("counts the people Scout found", () => {
    expect(teamStatus({ ...QUIET, prospectsFound: 72 }).scout.status).toBe("72 people found.");
    expect(teamStatus({ ...QUIET, prospectsFound: 1 }).scout.status).toBe("1 person found.");
  });

  it("says which campaigns are waiting for a launch", () => {
    const status = teamStatus({ ...QUIET, campaignsTotal: 2, campaignsRunning: 1, campaignsDraft: 1 });
    expect(status.quinn.status).toBe("2 campaigns written · 1 running · 1 waiting for launch.");
    expect(status.quinn.state).toBe("waiting");
  });

  it("reports Reese stopped while LinkedIn is disconnected, whatever was sent before", () => {
    const status = teamStatus({ ...QUIET, linkedInConnected: false, invited: 14, replied: 1 });
    expect(status.reese.state).toBe("blocked");
    expect(status.reese.status).not.toMatch(/14/);
  });

  it("reports what Reese sent, and leaves meetings out where no campaign can reach them", () => {
    const facts = { ...QUIET, invited: 14, replied: 1, meetings: 0, campaignsRunning: 1 };
    expect(teamStatus(facts).reese.status).toBe("14 invitations sent · 1 reply · 0 meetings.");
    expect(teamStatus({ ...facts, meetingsCounted: false }).reese.status).toBe(
      "14 invitations sent · 1 reply.",
    );
    expect(teamStatus({ ...facts, heldReplies: 2 }).reese.state).toBe("waiting");
  });

  it("gives NORA the needs-you list's own count", () => {
    expect(teamStatus(QUIET).lead.state).toBe("done");
    expect(teamStatus({ ...QUIET, needsYou: 1 }).lead.status).toMatch(/^One thing needs you/);
    expect(teamStatus({ ...QUIET, needsYou: 4 }).lead.status).toMatch(/^4 things need you/);
  });
});

/*
 * Free for everyone, for now — so no price, plan or trial clock may survive on
 * a page anybody outside the product reads.
 *
 * A grep, because the price was never in one function: it was in a component,
 * the structured data, the page metadata, a FAQ answer and the sign-up panel,
 * and a check of any one of them would have passed with the other four still
 * quoting $149.
 */
const here = dirname(fileURLToPath(import.meta.url));

function tsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsx(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("nothing public quotes a price", () => {
  const PUBLIC = [
    ...tsx(join(here, "../src/app/(marketing)")),
    ...["marketing", "schema", "auth-aside", "product-film", "gate-simulator", "agent-timeline"].map(
      (name) => join(here, `../src/components/${name}.tsx`),
    ),
    join(here, "../src/app/signup/page.tsx"),
    join(here, "../src/app/login/page.tsx"),
    join(here, "../src/app/app/profile/billing-section.tsx"),
    join(here, "../src/app/app/layout.tsx"),
  ];

  it("finds the pages", () => {
    expect(PUBLIC.length).toBeGreaterThan(10);
  });

  it("has no dollar price, per-seat rate, plan name or trial offer", () => {
    const BANNED = [
      /\$\d/,
      /\/\s*seat\s*\/\s*mo/i,
      /per seat,? per month/i,
      /free trial/i,
      /7-day/i,
      /seven days free/i,
      /choose a plan/i,
      /"(Solo|Pro|Teams)"/,
      /on every plan/i,
    ];
    const offenders: string[] = [];
    for (const file of PUBLIC) {
      // Comments may discuss what was removed; only rendered text counts.
      const source = readFileSync(file, "utf8")
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const pattern of BANNED) {
        if (pattern.test(source)) offenders.push(`${file.split("/src/")[1]}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
