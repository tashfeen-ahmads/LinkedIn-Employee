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
