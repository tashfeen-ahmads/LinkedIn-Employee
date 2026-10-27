import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
// The Replies section writes it; one reading of it is shared by the section
// and the profile menu's hint.
const profile = readFileSync(join(here, "../src/app/app/profile/replies/page.tsx"), "utf8");
const reading = readFileSync(join(here, "../src/app/app/profile/autonomy-state.ts"), "utf8");
// The write itself, shared by the profile screen and onboarding (rule 65).
const autonomy = readFileSync(join(here, "../src/lib/autonomy.ts"), "utf8");
const targeting = readFileSync(join(here, "../../worker/src/jobs/targeting.ts"), "utf8");

/**
 * One setting, one place it is written, one place the next campaign reads it.
 *
 * "How much the agent finishes on its own" was written by the profile screen
 * onto every campaign that already existed, and read by the Targeting Agent —
 * when it builds the next one — off `workspaces.onboarding`, the answer given
 * at signup. So a rep who switched to "autonomous" changed every campaign they
 * had, and every campaign they would ever build quietly reverted to the signup
 * answer, while this screen went on reporting "autonomous" because one of the
 * old campaigns still said so. Two readings of one setting, and the screen's is
 * the one somebody believes.
 *
 * Asserted across both files rather than against either one alone, because
 * neither was wrong by itself — the bug lived in the gap between them, which is
 * rule 39's lesson: the call sites are where this goes wrong, and a test of one
 * side passes throughout.
 */
describe("autonomy is stored in one place", () => {
  it("the profile screen writes the workspace's answer, not only its campaigns", () => {
    // Everything after the marker, so a `workspaces` write elsewhere on this
    // page — the screen touches several tables — cannot satisfy this.
    const marker = "/* ---- how much the agent finishes on its own ---- */";
    expect(profile.includes(marker), "the autonomy block moved or was renamed").toBe(true);
    const block = profile.slice(profile.indexOf(marker));
    expect(block).toMatch(/await setAutonomy\(supabase, session\.workspaceId,/);

    expect(autonomy).toMatch(/\.from\("workspaces"\)[\s\S]{0,400}?\.update\(\{ onboarding:/);
    // And still the campaigns, so a campaign already running changes too.
    expect(autonomy).toMatch(/\.from\("campaigns"\)[\s\S]{0,600}?\.update\(\{ rules:/);
    // Onboarding sets it through the same definition, not a copy: the launch
    // step's choice goes through setReplyHandling, which is setAutonomy plus
    // the campaign being launched.
    expect(readFileSync(join(here, "../src/app/onboarding/save/route.ts"), "utf8")).toMatch(/await setReplyHandling\(/);
    expect(autonomy).toMatch(/export async function setReplyHandling[\s\S]*?await setAutonomy\(supabase, workspaceId, autonomy, replyMode\)/);
  });

  it("merges rather than replaces, or the sending window and the search tier are lost", () => {
    // The same row holds the hours and the Sales Navigator answer that
    // onboarding stashed for the LinkedIn account to claim.
    expect(autonomy).toMatch(/onboarding: \{ \.\.\.answers, autonomy \}/);
    expect(autonomy).toMatch(/rules: \{ \.\.\.rules, autonomy \}/);
  });

  it("an autonomous answer also takes the campaign off approval, or it changes nothing", () => {
    // The reply gate holds every message on an approval-mode campaign whatever
    // its autonomy says, and campaigns are created in approval mode. Six live
    // drafts said "autonomous" and would have held every reply.
    expect(autonomy).toMatch(/update\(\{ rules: \{ \.\.\.rules, autonomy \} as never, \.\.\.replyModeFor\(autonomy, replyMode\) \}\)/);
    expect(autonomy).toMatch(/autonomy === "autonomous" \? \{ reply_mode: "autopilot" \} : \{\}/);
    expect(targeting).toMatch(/reply_mode: onboardingAutonomy === "autonomous" \? "autopilot" : "approval"/);
  });

  it("the Targeting Agent reads that same row when it builds the next campaign", () => {
    expect(targeting).toMatch(/\.from\("workspaces"\)[\s\S]{0,200}?\.select\("onboarding"\)/);
    expect(targeting).toMatch(/onboarding as \{ autonomy\?: string \} \| null\)\?\.autonomy === "autonomous"/);
  });

  it("the screen prefers the workspace's answer over guessing from campaigns", () => {
    // A brand new workspace that chose "autonomous" during onboarding has no
    // campaigns yet, so reading only the campaigns reported "supervised" — the
    // opposite of what the rep had just said.
    expect(profile).toMatch(/const autonomy = readAutonomy\(wsRow\?\.onboarding, ruleRows\);/);
    expect(reading).toMatch(/const stated = \(onboarding as \{ autonomy\?: string \} \| null\)\?\.autonomy;/);
    expect(reading).toMatch(/stated === "autonomous" \|\| stated === "supervised"\s*\?\s*stated/);
  });
});
