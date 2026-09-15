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

  it("runs on the mock LinkedIn provider with no Unipile credentials at all", () => {
    // The mock exists so a deployment can stand up before the LinkedIn
    // subscription does. Requiring real credentials to use it defeated that.
    const { UNIPILE_DSN, UNIPILE_ACCESS_TOKEN, ...withoutUnipile } = complete;
    void UNIPILE_DSN;
    void UNIPILE_ACCESS_TOKEN;
    const env = loadEnv({ ...withoutUnipile, LINKEDIN_PROVIDER: "mock" });
    expect(env.LINKEDIN_PROVIDER).toBe("mock");
  });

  it("still demands Unipile credentials when it will actually reach LinkedIn", () => {
    // Caught at boot, not at the first send — a worker that starts without them
    // looks healthy for hours and the failure reads as a campaign that never
    // began.
    const { UNIPILE_DSN, ...withoutDsn } = complete;
    void UNIPILE_DSN;
    expect(() => loadEnv(withoutDsn)).toThrow(/UNIPILE_DSN/);
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

describe("UNIPILE_DSN", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
    OPENAI_API_KEY: "sk-test",
    LINKEDIN_PROVIDER: "unipile",
    UNIPILE_ACCESS_TOKEN: "token",
  };

  it("accepts the full origin with its port", () => {
    expect(loadEnv({ ...base, UNIPILE_DSN: "https://api58.unipile.com:18893" } as never).UNIPILE_DSN)
      .toBe("https://api58.unipile.com:18893");
  });

  it("refuses a DSN with no scheme, which is how the dashboard shows it", () => {
    // `new URL("api58.unipile.com:18893")` does not throw — it parses as the
    // scheme `api58.unipile.com:`. So this reached fetch, which threw with no
    // status, and the only thing the UI could say was "could not reach".
    expect(() => loadEnv({ ...base, UNIPILE_DSN: "api58.unipile.com:18893" } as never))
      .toThrow(/UNIPILE_DSN/);
  });

  it("names what is wrong, not only which key", () => {
    // A key that is plainly filled in sends people to look at the wrong thing
    // when the error says only "incomplete".
    expect(() => loadEnv({ ...base, UNIPILE_DSN: "api58.unipile.com:18893" } as never))
      .toThrow(/scheme and port/);
  });

  it("refuses a scheme that is not http", () => {
    expect(() => loadEnv({ ...base, UNIPILE_DSN: "ftp://api58.unipile.com:18893" } as never))
      .toThrow(/UNIPILE_DSN/);
  });
});

describe("base URLs", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
    OPENAI_API_KEY: "sk-test",
    LINKEDIN_PROVIDER: "mock",
  };

  it("strips a trailing slash from APP_URL", () => {
    // Every redirect is built as `${APP_URL}/path`. One pasted with a slash
    // produced `//app/team`, which a browser reads as protocol-relative and
    // Next.js does not route — so the rep finished signing in to LinkedIn and
    // landed on a client-side exception.
    expect(loadEnv({ ...base, APP_URL: "https://app.example.com/" } as never).APP_URL)
      .toBe("https://app.example.com");
  });

  it("strips a trailing slash from WORKER_URL", () => {
    expect(loadEnv({ ...base, WORKER_URL: "https://worker.example.com/" } as never).WORKER_URL)
      .toBe("https://worker.example.com");
  });

  it("refuses an APP_URL that is not an absolute URL", () => {
    expect(() => loadEnv({ ...base, APP_URL: "app.example.com" } as never)).toThrow(/APP_URL/);
  });
});
