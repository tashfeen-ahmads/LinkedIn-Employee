import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { systemSummary } from "../src/lib/system-summary";

/**
 * Rule 17, on the line people actually read.
 *
 * The system check's banner said "every stage has what it needs" whenever no
 * row was blocked, including when half the rows were `waiting` because they
 * could not look and when the check came back with no rows at all.
 */
describe("systemSummary", () => {
  it("names the first blocked row ahead of anything that is the customer's move", () => {
    expect(systemSummary([{ state: "todo" }, { state: "ok" }, { state: "blocked" }])).toEqual({ kind: "blocked", index: 2 });
    expect(systemSummary([{ state: "ok" }, { state: "todo" }])).toEqual({ kind: "todo", index: 1 });
  });

  it("never calls a stage that could not look confirmed", () => {
    expect(systemSummary([{ state: "ok" }, { state: "waiting" }, { state: "unknown" }])).toEqual({
      kind: "unconfirmed",
      count: 2,
    });
  });

  it("never reports an empty check as all clear", () => {
    expect(systemSummary([])).toEqual({ kind: "empty" });
  });

  it("is clear only when every row is ok", () => {
    expect(systemSummary([{ state: "ok" }, { state: "ok" }])).toEqual({ kind: "clear" });
  });

  it("is what the page uses", () => {
    const page = readFileSync(join(__dirname, "../src/app/app/system/page.tsx"), "utf8");
    expect(page).toContain("systemSummary(checks)");
    expect(page).toContain('summary.kind === "unconfirmed"');
  });
});
