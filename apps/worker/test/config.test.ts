import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";

const complete = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  OPENAI_API_KEY: "sk-test",
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
    const { UNIPILE_DSN, ...withoutDsn } = complete;
    void UNIPILE_DSN;
    expect(() => loadEnv(withoutDsn)).toThrow(/UNIPILE_DSN/);
  });

  it("refuses an environment with no model provider at all", () => {
    // Rejected at boot, not at the first agent call — which would be an hour
    // after someone signed up, and would look like a broken product rather
    // than a missing setting.
    const { OPENAI_API_KEY, ...withoutKey } = complete;
    void OPENAI_API_KEY;
    expect(() => loadEnv(withoutKey)).toThrow(/OPENAI_API_KEY/);
  });

  it("takes either provider's key", () => {
    const { OPENAI_API_KEY, ...rest } = complete;
    void OPENAI_API_KEY;
    expect(() => loadEnv({ ...rest, ANTHROPIC_API_KEY: "sk-ant-test" })).not.toThrow();
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
