import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Upcoming is read from now forwards, never carved out of the oldest rows.
 *
 * The page read the oldest two hundred meetings and split them, so once a
 * workspace had two hundred behind it every row read was in the past and the
 * Upcoming tab said "Nothing booked yet" on the morning of a call.
 */
const page = readFileSync(join(__dirname, "../src/app/app/meetings/page.tsx"), "utf8");

describe("meetings reads", () => {
  it("asks for the future from now, soonest first", () => {
    expect(page).toMatch(/\.gte\("starts_at", now\.toISOString\(\)\)\s*\.order\("starts_at", \{ ascending: true \}\)/);
  });

  it("asks for the past separately, most recent first", () => {
    expect(page).toMatch(/\.lt\("starts_at", now\.toISOString\(\)\)\s*\.order\("starts_at", \{ ascending: false \}\)/);
  });
});
