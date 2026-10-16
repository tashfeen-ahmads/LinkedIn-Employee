import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTOPILOT_ALWAYS_HOLDS, EXTERNAL_BOOKINGS_UNCOUNTED, alwaysHoldsSentence } from "@le/shared";

const src = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");

/**
 * What autopilot never finishes on its own is one list, read by every screen
 * that offers autopilot or describes it.
 *
 * It was written out by hand on each of them, and each copy named a different
 * two or three of the six holds the code enforces. A customer deciding whether
 * to switch autopilot on is deciding on exactly that list, so a screen that
 * names fewer than the product enforces undersells it, and one that names more
 * than it enforces is a promise somebody will rely on.
 */
describe("the holds autopilot never overrides", () => {
  it("names every hold the code enforces", () => {
    expect(AUTOPILOT_ALWAYS_HOLDS.map((hold) => hold.id)).toEqual([
      "opt-out",
      "asks-for-a-person",
      "not-understood",
      "invented-link",
      "unoffered-time",
      "unapproved-offer",
    ]);
    const sentence = alwaysHoldsSentence();
    for (const hold of AUTOPILOT_ALWAYS_HOLDS) expect(sentence).toContain(hold.clause);
  });

  it("is said in plain words: no dashes, no suppliers, no plumbing (rule 54)", () => {
    const words = AUTOPILOT_ALWAYS_HOLDS.flatMap((hold) => [hold.title, hold.detail, hold.clause]).join(" ");
    expect(words).not.toMatch(/[–—]/);
    expect(words).not.toMatch(/unipile|openai|anthropic|supabase|redis|resend|render|netlify|webhook/i);
    expect(words).not.toMatch(/\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b/);
  });

  it.each([
    ["the profile's edit and read views", "app/app/profile/page.tsx", 2],
    ["onboarding", "app/onboarding/steps.tsx", 1],
    ["the campaign's reply setting", "app/app/campaigns/[id]/page.tsx", 1],
    ["the marketing FAQ", "components/marketing.tsx", 1],
  ])("%s renders the shared sentence", (_where, path, times) => {
    const file = src(path);
    expect(file.split("alwaysHoldsSentence()").length - 1).toBeGreaterThanOrEqual(times);
    // The hand-written copies this replaced, each naming only two holds.
    expect(file).not.toMatch(/Two things always wait/);
    expect(file).not.toMatch(/a prospect who asks for a person and a message the agent did not/);
  });

  it("the about page lists them from the shared list, not its own", () => {
    const about = src("app/(marketing)/about/page.tsx");
    expect(about).toMatch(/const ALWAYS_HELD = AUTOPILOT_ALWAYS_HOLDS;/);
    expect(about).not.toMatch(/const ALWAYS_HELD = \[/);
    expect(about).not.toMatch(/Three things are never left/);
  });
});

/**
 * A rep's own scheduling link books meetings this product cannot see (rule
 * 31). Every screen that counts meetings says so beside the count, and the
 * meetings page says so on every tab rather than only when it is empty: a list
 * with three meetings on it reads as the whole diary.
 */
describe("meetings booked through a rep's own scheduling link", () => {
  it("names the tools the rep chose and none of ours", () => {
    expect(EXTERNAL_BOOKINGS_UNCOUNTED).toMatch(/Calendly/);
    expect(EXTERNAL_BOOKINGS_UNCOUNTED).not.toMatch(/unipile|supabase|redis/i);
  });

  it("the meetings page says so outside the empty state", () => {
    const page = src("app/app/meetings/page.tsx");
    const note = page.indexOf("{EXTERNAL_BOOKINGS_UNCOUNTED}");
    const empty = page.indexOf("<Empty");
    expect(note).toBeGreaterThan(-1);
    expect(note).toBeLessThan(empty);
    expect(page).toMatch(/workspaceUsesOwnBookingLink\(supabase, session\.workspaceId\)/);
  });

  it("the overview's results and headline say so", () => {
    const results = src("app/app/analytics-section.tsx");
    expect(results).toMatch(/ownBookingLink && funnel\.goals\.includes\("meeting"\) \? EXTERNAL_BOOKINGS_UNCOUNTED/);
    expect(results).toMatch(/Meetings booked through your own scheduling link are not counted/);
    expect(src("app/app/page.tsx")).toMatch(/<HeadlineStats report=\{report\} ownBookingLink=\{ownBookingLink\} \/>/);
  });

  it("a meeting campaign's funnel says so", () => {
    const page = src("app/app/campaigns/[id]/page.tsx");
    expect(page).toMatch(/cta\.kind === "meeting" && \(await campaignUsesOwnBookingLink\(/);
    expect(page).toMatch(/\{ownBookingLink \? <p className="tiny subtle">\{EXTERNAL_BOOKINGS_UNCOUNTED\}<\/p> : null\}/);
  });

  it("asks about this workspace's members only, never every profile an admin can read", () => {
    const lib = src("lib/booking-link.ts");
    expect(lib).toMatch(/\.from\("memberships"\)\.select\("user_id"\)\.eq\("workspace_id", workspaceId\)/);
    expect(lib).toMatch(/\.from\("profiles"\)\.select\("booking_url"\)\.in\("id", ids\)/);
  });
});
