import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * A workspace that has finished onboarding is not asked to set up what it set
 * up (rule 65). Each of these screens read a different table or column from
 * the one onboarding writes, and so told a customer who had just answered to
 * go and answer again.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]) => readFileSync(join(here, "..", "src", ...p), "utf8");

describe("screens after onboarding read what onboarding wrote", () => {
  it("the pitch page counts an approved line on the agent, which is what campaigns use", () => {
    expect(read("app", "app", "pitch", "page.tsx")).toMatch(/row\.approved_at && \(row\.is_default \|\| row\.agent_id\)/);
  });

  it("an agent on the deployment's own model reads as Automatic, and saves", () => {
    expect(read("app", "app", "agents", "page.tsx")).toMatch(/agent\.model === null \?/);
    expect(read("app", "app", "agents", "[id]", "page.tsx")).toMatch(/if \(model && !isSelectableModel\(model\)\)/);
  });

  it("availability falls back to the timezone given at onboarding, not UTC", () => {
    const availability = read("app", "app", "meetings", "availability.tsx");
    expect(availability).toMatch(/timezone: ownTimezone \?\? DEFAULTS\.timezone, \.\.\.\(row \?\? \{\}\)/);
    // The row's zone when it is one the calendar can read, the profile's otherwise.
    expect(availability).toMatch(/usableTimezone\(row\?\.timezone, await profileTimezone\(supabase, session\.userId\)\)/);
  });

  it("does not ask the Sales Navigator question again on the overview", () => {
    expect(read("app", "app", "page.tsx")).not.toMatch(/Have Sales Navigator\?/);
  });

  it("a new campaign starts on the workspace's call to action", () => {
    expect(read("app", "app", "campaigns", "new", "page.tsx")).toMatch(/: \(ctas\?\.\[0\]\?\.id \?\? ""\)/);
  });
});
