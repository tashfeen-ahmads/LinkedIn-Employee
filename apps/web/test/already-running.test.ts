import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALREADY_RUNNING, isAlreadyRunning, startedNotice } from "../src/lib/worker";

/**
 * A second press while an agent run is in progress starts nothing.
 *
 * The worker answers `{ queued: true, alreadyRunning: true }` for it, and a
 * page that announced "Writing four more" over that sent somebody to wait for
 * a batch that was never asked for.
 */
const SRC = join(__dirname, "..", "src");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

describe("startedNotice", () => {
  it("says it is already working when the worker says so", () => {
    expect(startedNotice({ queued: true, alreadyRunning: true }, "Started.")).toBe(ALREADY_RUNNING);
    expect(ALREADY_RUNNING).toBe("Already working on it — this takes a few minutes.");
  });

  it("keeps the caller's sentence for a run that really started", () => {
    expect(startedNotice({ queued: true }, "Started.")).toBe("Started.");
    expect(startedNotice(null, "Started.")).toBe("Started.");
    // Only a real `true`: a string from a misbehaving body is not a claim.
    expect(isAlreadyRunning({ alreadyRunning: "true" })).toBe(false);
  });
});

describe("every web caller of the strategy and targeting jobs", () => {
  it("the strategy page reads alreadyRunning on all four", () => {
    const page = read("app", "app", "strategy", "page.tsx");
    expect(page).toMatch(/alreadyRunning: isAlreadyRunning\(queued\.data\)/);
    // Write more, add a business.
    expect(page.match(/startedNotice\(\s*queued\.data,/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // Approve, and Find prospects.
    expect(page).toMatch(/started\.alreadyRunning\s*\?\s*`Approved\. \$\{ALREADY_RUNNING\}`/);
    expect(page).toMatch(/started\.alreadyRunning\s*\?\s*ALREADY_RUNNING/);
  });

  it("the campaign page's Find more", () => {
    const page = read("app", "app", "campaigns", "[id]", "page.tsx");
    expect(page).toMatch(/startedNotice\(\s*queued\.data,\s*"Reading the next page/);
  });

  it("the Strategy Agent retry", () => {
    expect(read("lib", "strategy-retry.ts")).toMatch(/startedNotice\(\s*queued\.data,/);
  });
});
