import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";

const complete = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  ANTHROPIC_API_KEY: "sk-ant-test",
  UNIPILE_DSN: "https://api1.unipile.com:13111",
  UNIPILE_ACCESS_TOKEN: "token",
};

describe("loadEnv", () => {
  it("accepts a complete environment and applies defaults", () => {
    const env = loadEnv(complete);
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.WORKER_PORT).toBe(4000);
    expect(env.LINKEDIN_PROVIDER).toBe("unipile");
  });

  it("names what is missing rather than failing obscurely at runtime", () => {
    const { ANTHROPIC_API_KEY, ...withoutKey } = complete;
    void ANTHROPIC_API_KEY;
    expect(() => loadEnv(withoutKey)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("allows the mock provider so development never touches LinkedIn", () => {
    expect(loadEnv({ ...complete, LINKEDIN_PROVIDER: "mock" }).LINKEDIN_PROVIDER).toBe("mock");
  });
});

describe("isoWeekStart", () => {
  it("groups a whole week onto its Monday", async () => {
    const { isoWeekStart } = await import("../src/accounts.js");
    // Monday 7th through Sunday 13th September 2026 are all one week.
    for (const day of ["2026-09-07", "2026-09-09", "2026-09-13"]) {
      expect(isoWeekStart(day), day).toBe("2026-09-07");
    }
  });

  it("separates adjacent weeks", async () => {
    const { isoWeekStart } = await import("../src/accounts.js");
    // An account idle over the weekend must still get its weekly reset, which
    // a "only reset on Monday" rule would skip entirely.
    expect(isoWeekStart("2026-09-13")).not.toBe(isoWeekStart("2026-09-14"));
  });
});
