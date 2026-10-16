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
    expect(NORA).toBe(BRAND.name);
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

  it("asks for an approval only while none is approved (rule 65)", () => {
    // Onboarding approves one of Sage's three to five; the rest are options.
    // Read as waiting, every finished setup opened on Sage asking for work
    // nothing depended on.
    const status = teamStatus({ ...QUIET, strategiesApproved: 1, strategiesAwaiting: 3 });
    expect(status.sage.status).toBe("1 strategy approved, 3 more ready when you want them.");
    expect(status.sage.state).toBe("done");
    expect(teamStatus({ ...QUIET, strategiesAwaiting: 3 }).sage.status).toBe("3 strategies waiting for your approval.");
    expect(teamStatus({ ...QUIET, strategiesAwaiting: 3 }).sage.state).toBe("waiting");
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
    ...["marketing", "schema", "auth-aside", "gate-simulator", "agent-timeline"].map(
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
      if (isComparison(file)) continue;
      // Comments may discuss what was removed; only rendered text counts.
      const source = rendered(file);
      for (const pattern of BANNED) {
        if (pattern.test(source)) offenders.push(`${file.split("/src/")[1]}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
   * A comparison page has to say what the alternatives cost, or it is not a
   * comparison: somebody choosing between Nora and a $99-a-month tool needs the
   * $99. So these pages may quote other companies' prices and trials, and two
   * things keep that from becoming the thing this test exists to stop. Every
   * one is dated, because a competitor's price is a fact about one month. And
   * no sentence puts a price next to Nora's name, because a price beside the
   * product's name reads as the product's price, to a person skimming and to a
   * model summarising the page alike.
   */
  it("lets comparison pages quote other tools' prices, dated, and never beside Nora's name", () => {
    const comparisons = PUBLIC.filter(isComparison);
    expect(comparisons.length, "no comparison pages found, so this test would pass vacuously").toBeGreaterThan(3);
    const offenders: string[] = [];
    for (const file of comparisons) {
      const source = rendered(file);
      const quotesPrice = /\$\d/.test(source);
      if (quotesPrice && !/as of (January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/i.test(source)) {
        offenders.push(`${file.split("/src/")[1]}: quotes a price with no "as of <month> <year>"`);
      }
      // A dollar figure inside the same clause as the name, either way round:
      // "Nora costs $49", "$49 gets you Nora". Clause ends at punctuation or
      // markup, so "$99 a month. Nora is free" is two clauses and fine.
      const beside = source.match(/\bNora\b[^.;:!?<>{}]{0,60}\$\d|\$\d[^.;:!?<>{}]{0,40}\bNora\b/g) ?? [];
      for (const hit of beside) offenders.push(`${file.split("/src/")[1]}: a price beside Nora's name: "${hit}"`);
    }
    expect(offenders).toEqual([]);
  });
});

/** Pages that quote what someone else charges (or was fined): other tools, LinkedIn's own plans, court judgments. */
function isComparison(file: string): boolean {
  return /\(marketing\)\/(alternatives\/|guides\/(ai-sdr-pricing|ai-sdr-vs-human-sdr|best-ai-sdr-for-linkedin|safest-linkedin-automation-tool|linkedin-prospecting-without-sales-navigator|is-linkedin-automation-legal)\/|free-linkedin-automation-tool\/)/.test(
    file,
  );
}

/** A file's source with comments removed, so only rendered text is checked. */
function rendered(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
