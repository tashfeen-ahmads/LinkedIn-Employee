import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shown, shownUserIds } from "@/lib/admin";

/*
 * A workspace an owner hid from the console (migration 0062) is left out of
 * every console list. Source-level for the pages, because the bug this guards
 * against is a list nobody remembered to filter.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, "../src/app/admin", ...parts), "utf8");

describe("console lists", () => {
  const hidden = new Set(["ws-hidden"]);

  it("drop rows in a hidden workspace and keep the rest", () => {
    const rows = [{ workspace_id: "ws-hidden" }, { workspace_id: "ws-1" }, { workspace_id: null }];
    expect(shown(rows, hidden)).toEqual([{ workspace_id: "ws-1" }, { workspace_id: null }]);
    expect(shown([{ id: "ws-hidden" }, { id: "ws-1" }], hidden, "id")).toEqual([{ id: "ws-1" }]);
  });

  it("drop a person only when every workspace they belong to is hidden", () => {
    const visible = shownUserIds(
      [
        { user_id: "me", workspace_id: "ws-hidden" },
        { user_id: "both", workspace_id: "ws-hidden" },
        { user_id: "both", workspace_id: "ws-1" },
      ],
      hidden,
    );
    expect(visible("me")).toBe(false);
    expect(visible("both")).toBe(true);
    // A sign-up with no workspace yet is still somebody an operator may need.
    expect(visible("new")).toBe(true);
  });

  it("are filtered on every page that lists workspaces' rows", () => {
    for (const page of [
      ["page.tsx"],
      ["accounts", "page.tsx"],
      ["activity", "page.tsx"],
      ["campaigns", "page.tsx"],
      ["spend", "page.tsx"],
      ["support", "page.tsx"],
      ["users", "page.tsx"],
      ["workspaces", "page.tsx"],
      ["layout.tsx"],
    ]) {
      expect(read(...page), page.join("/")).toMatch(/hiddenWorkspaces\(\)/);
    }
  });

  it("can always be undone, from Settings, by an owner", () => {
    expect(read("settings", "page.tsx")).toMatch(/\.eq\("console_hidden", true\)/);
    expect(read("settings", "page.tsx")).toMatch(/op="workspace-console-hidden"/);
  });
});
