import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { resolveCalendar } from "../src/calendar.js";
import type { Env } from "../src/config.js";

/**
 * A meeting-hours row holding a zone the runtime cannot read ("Eastern" was
 * live) made `Intl` throw on every reply that offered times. The calendar uses
 * the profile's zone instead and never guesses UTC.
 */
const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function db(zone: string) {
  const fake = new FakeDb();
  fake.seed("availability", [{ id: "av", workspace_id: WS, user_id: USER, timezone: zone }]);
  fake.seed("meetings", []);
  return fake.asDb();
}

const env = { CALENDAR_PROVIDER: "mock" } as unknown as Env;

describe("an unreadable stored timezone", () => {
  it("falls back to the profile's zone", async () => {
    const binding = await resolveCalendar(db("Eastern"), env, { workspaceId: WS, userId: USER, timezone: "America/New_York" });
    expect(binding?.timezone).toBe("America/New_York");
  });

  it("keeps a readable stored zone over the profile's", async () => {
    const binding = await resolveCalendar(db("Europe/London"), env, { workspaceId: WS, userId: USER, timezone: "America/New_York" });
    expect(binding?.timezone).toBe("Europe/London");
  });
});
