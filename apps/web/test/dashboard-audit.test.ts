import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchExclusion } from "@le/shared";
import { readExclusion } from "../src/lib/exclusion-form";
import { formatSpend } from "../src/lib/spend-display";
import { scopeFunnel } from "../src/lib/funnel-scope";
import type { FunnelData } from "../src/lib/funnel-data";

/**
 * Defects found walking the dashboard and the operator console tab by tab.
 *
 * Each block names the screen and what it used to do. Where the fix is a pure
 * function it is tested directly; where the bug lived in a call site (rule 39's
 * lesson) the call site is read, because a test of a helper passes while the
 * page that should call it does not.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, "../src/app", path), "utf8");

/** The body of a server action, from its declaration to the next one. */
function action(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  expect(start, `${name} is gone or renamed`).toBeGreaterThan(-1);
  const next = source.indexOf("\nasync function ", start + 1);
  const page = source.indexOf("\nexport default", start + 1);
  const ends = [next, page].filter((n) => n > -1);
  return source.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe("Do not contact: a rule that cannot fire is not stored", () => {
  it("refuses a person entered by name, which matched nobody and was reported as added", () => {
    const named = readExclusion("person", "Jane Doe");
    expect(named.ok).toBe(false);
  });

  it("stores a person by profile address, in the form the send path matches", () => {
    const input = readExclusion("person", "https://www.linkedin.com/in/Jane-Doe/?trk=x");
    expect(input.ok).toBe(true);
    if (!input.ok) return;
    const rule = { kind: input.kind, value: input.value, rawValue: input.raw };
    expect(matchExclusion([rule], { linkedinUrl: "linkedin.com/in/jane-doe" })).not.toBeNull();
  });

  it("says why instead of returning quietly", () => {
    expect(readExclusion("company", "   ")).toMatchObject({ ok: false });
    expect(readExclusion("nonsense", "Acme")).toMatchObject({ ok: false });
    const page = read("app/exclusions/page.tsx");
    expect(action(page, "addExclusion")).not.toMatch(/\)\s*return;/);
  });
});

describe("Operator spend: unpriced is never $0.00", () => {
  it("reports a group of only unpriced calls as unpriced, and a partly priced one as a floor", () => {
    expect(formatSpend(0, 12, 12)).toBe("unpriced");
    expect(formatSpend(1.5, 12, 2)).toBe("$1.50+");
    expect(formatSpend(1.5, 12, 0)).toBe("$1.50");
    expect(formatSpend(0, 0, 0)).toBe("$0.00");
  });

  it("is what the spend screens print", () => {
    for (const path of ["admin/spend/page.tsx", "admin/workspaces/page.tsx", "admin/workspaces/[id]/page.tsx"]) {
      expect(read(path), path).toContain("formatSpend(");
    }
  });
});

describe("Results: a rep's page is about a rep's campaigns, all of it", () => {
  const row = (campaign_id: string) =>
    ({ campaign_id, status: "invited", invited_at: "2026-10-01T10:00:00Z", accepted_at: null, replied_at: null }) as never;
  const campaign = (id: string, owner: string) =>
    ({ id, name: id, status: "running", owner_user_id: owner, cta_kind: "meeting", customer_profile_id: null, launched_at: null }) as never;
  const funnel: FunnelData = {
    campaigns: [campaign("mine", "me"), campaign("theirs", "them")],
    rows: [row("mine"), row("theirs"), row("theirs")],
    rowsByCampaign: new Map([
      ["mine", [row("mine")]],
      ["theirs", [row("theirs"), row("theirs")]],
    ]),
    goals: ["meeting"],
    truncated: false,
  };

  it("drops other people's campaigns and rows before anything is counted", () => {
    const scoped = scopeFunnel(funnel, { userId: "me", canSeeTeam: false });
    expect(scoped.campaigns.map((c) => c.id)).toEqual(["mine"]);
    expect(scoped.rows).toHaveLength(1);
    expect([...scoped.rowsByCampaign.keys()]).toEqual(["mine"]);
  });

  it("leaves a manager's view whole", () => {
    expect(scopeFunnel(funnel, { userId: "me", canSeeTeam: true })).toBe(funnel);
  });

  it("is applied before the report, the trend and the strategy rows", () => {
    const source = read("app/analytics-section.tsx");
    const scoped = source.indexOf("scopeFunnel(");
    expect(scoped).toBeGreaterThan(-1);
    expect(source.indexOf("funnelReport(")).toBeGreaterThan(scoped);
    expect(source.indexOf("dailySends(funnel.rows")).toBeGreaterThan(scoped);
  });

  it("scopes the overview's headline figures the same way, before they are counted", () => {
    // The headline stats sit above Results on the same screen. Counted from
    // the whole workspace for a rep, "Invited, last 7 days" disagreed with the
    // funnel a few inches below it.
    const source = read("app/page.tsx");
    const scoped = source.indexOf("scopeFunnel(");
    expect(scoped).toBeGreaterThan(-1);
    expect(source).toContain("canSeeTeamFunnel(session.role)");
    expect(source.indexOf("funnelReport(")).toBeGreaterThan(scoped);
    expect(read("app/analytics-section.tsx")).toContain("canSeeTeamFunnel(session.role)");
  });
});

describe("Profile posts: a refused post can be sent again, and history is not rewritten", () => {
  const page = read("app/posts/page.tsx");

  it("lets Hold reach a failed post, which keeps its approval when LinkedIn refuses it", () => {
    expect(action(page, "unapprove")).toMatch(/\.in\("status", \[[^\]]*"failed"[^\]]*\]\)/);
  });

  it("offers the approval controls on a failed post rather than only Save and Hold", () => {
    expect(page).toMatch(/const awaitingApproval = !row\.approved_at \|\| failed;/);
  });

  it("never edits a published post, whose body is the record of what went out", () => {
    expect(action(page, "saveEdit")).toContain('.neq("status", "published")');
  });

  it("only touches the rep's own posts, which is all the screen lists", () => {
    for (const name of ["saveEdit", "approve", "unapprove", "discard"]) {
      expect(action(page, name), name).toContain('.eq("user_id", session.userId)');
    }
  });
});

describe("Defaults are scoped to what they compete with", () => {
  it("clears only the same agent's default line on Opener and pitch (migration 0031)", () => {
    const body = action(read("app/pitch/page.tsx"), "makeDefault");
    expect(body).toMatch(/clear\.eq\("agent_id", target\.agent_id\)/);
    expect(body).toMatch(/clear\.is\("agent_id", null\)/);
  });

  it("checks the agent is live before clearing the workspace's default", () => {
    const body = action(read("app/agents/page.tsx"), "makeDefault");
    const check = body.indexOf('.is("archived_at", null)');
    const clear = body.indexOf("is_default: false");
    expect(check).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(check);
  });
});

describe("Agent: every write is to this workspace's agent", () => {
  const page = read("app/agents/[id]/page.tsx");
  for (const name of ["saveIdentity", "savePlaybook", "writeLines", "addOpener", "addOffer", "approveLine", "retireLine"]) {
    it(`${name} refuses an agent id from somewhere else`, () => {
      expect(action(page, name)).toContain("if (!agent) notFound();");
    });
  }

  it("does not tell the customer spend is on the overview, which it has not been since usage moved", () => {
    expect(page).not.toContain("Spend is on the overview");
  });
});

describe("Calls to action: a goal in use does not change underneath its campaigns", () => {
  const body = action(read("app/cta/page.tsx"), "saveCta");
  it("refuses a change of kind while campaigns point at it", () => {
    expect(body).toMatch(/current\.kind !== kind && \(users \?\? 0\) > 0/);
  });
  it("reports an archive that did not happen", () => {
    expect(action(read("app/cta/page.tsx"), "archiveCta")).toMatch(/if \(error \|\| !changed\?\.length\)/);
  });
});

describe("Profile and team: the allowance is today's, against today's cap", () => {
  it("draws invitations against the ramp, not the end of it", () => {
    const page = read("app/profile/page.tsx");
    expect(page).not.toMatch(/cap=\{LINKEDIN_LIMITS\.invitesPerDayMax\}/);
    expect(page).toContain("dailyInviteCap(");
    expect(page).toContain("countersForToday(");
  });

  it("rolls the team table's counters over too", () => {
    expect(read("app/profile/team-section.tsx")).toContain("countersForToday(");
  });

  it("says when an invitation was not created instead of 'Invitation sent'", () => {
    expect(action(read("app/profile/team-section.tsx"), "inviteMember")).toMatch(/if \(inviteError \|\| !invitation\)/);
  });
});

describe("Export: a failure comes back to the page, not saved to disk as the export", () => {
  const route = read("app/export/route.ts");
  it("redirects with the reason", () => {
    expect(route).not.toMatch(/NextResponse\.json\(\{ error/);
    expect(route).toContain("seeOther(");
  });
  it("is not a download link, which would save the redirect as a file", () => {
    expect(read("app/profile/billing-section.tsx")).not.toMatch(/href="\/app\/export" download/);
  });
});

describe("Operator console: unread is never reported as clear", () => {
  const overview = read("admin/page.tsx");
  it("puts an unreadable Issues list on the waiting list", () => {
    expect(overview).toMatch(/if \(!issuesRead\) \{\s*waiting\.push/);
  });
  it("reports a missing boot stamp as unknown, not up (rule 23)", () => {
    expect(overview).toMatch(/!bootKnown \? "unknown"/i);
  });
  it("sums today's sends from rolled-over counters", () => {
    for (const path of ["admin/page.tsx", "admin/accounts/page.tsx", "admin/workspaces/[id]/page.tsx"]) {
      expect(read(path), path).toContain("countersForToday(");
    }
  });
  it("reads every open ticket, not only those among the newest hundred", () => {
    expect(read("admin/support/page.tsx")).toMatch(/\.eq\("status", "open"\)\.order\("created_at"/);
  });
});

describe("Every screen in the app can be reached from inside it", () => {
  /*
   * /app/pitch was linked from nowhere: the workspace's own opener and offer
   * lines, which every agent without its own falls back to, could only be
   * opened by somebody who already knew the URL. A page nobody can reach is
   * a page whose approvals nobody gives.
   */
  const appDir = join(here, "../src/app/app");
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
  const everything = [...sources(join(here, "../src")), ...sources(join(here, "../../../packages/shared/src"))];

  const screens = readdirSync(appDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(appDir, entry.name, "page.tsx")))
    .map((entry) => entry.name)
    // A page that only redirects is an old address kept working, not a screen.
    .filter(
      (name) =>
        !/export default async function \w+\([^)]*\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*redirect\(/.test(
          readFileSync(join(appDir, name, "page.tsx"), "utf8"),
        ),
    );

  it("finds the screens", () => {
    expect(screens).toContain("pitch");
    expect(screens).toContain("cta");
  });

  it("links each one from somewhere other than itself", () => {
    for (const name of screens) {
      const own = join(appDir, name);
      const linked = everything.some(
        (file) =>
          !file.startsWith(own + "/") &&
          new RegExp(`["'\`]/app/${name}(["'\`/?#])`).test(readFileSync(file, "utf8")),
      );
      expect(linked, `/app/${name} is linked from nowhere`).toBe(true);
    }
  });

  it("puts Opener and pitch in the nav beside Calls to action, with no mark of its own", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/\{ href: "\/app\/cta"[^}]*\},\s*(?:\/\/[^\n]*\n\s*)*\{ href: "\/app\/pitch", label: "Opener and pitch", icon: "pitch" \}/);
  });
});
