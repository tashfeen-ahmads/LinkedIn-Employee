import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { detectBrandColors, workspaceWebsite } from "../src/jobs/brand-colors.js";
import type { WorkerContext } from "../src/context.js";

const WS = "11111111-1111-4111-8111-111111111111";
const found = async () => ({ primary: "#0A7CFF", accent: "#FF9800" });

function harness(workspace: Record<string, unknown>) {
  const db = new FakeDb();
  db.seed("workspaces", [{ id: WS, brand_primary: null, brand_accent: null, onboarding: {}, ...workspace }]);
  db.seed("business_profiles", []);
  return { db, ctx: { db: db.asDb() } as unknown as WorkerContext };
}

describe("a company's colours", () => {
  it("are stored from its website when nobody has set any", async () => {
    const { db, ctx } = harness({});
    const out = await detectBrandColors(ctx, { workspaceId: WS, websiteUrl: "acme.test", replace: false }, found);
    expect(out.saved).toBe(true);
    expect(db.find("workspaces", { id: WS })).toMatchObject({ brand_primary: "#0A7CFF", brand_accent: "#FF9800" });
  });

  it("never overwrite colours a person chose, on a background run", async () => {
    const { db, ctx } = harness({ brand_primary: "#112233" });
    const out = await detectBrandColors(ctx, { workspaceId: WS, websiteUrl: "acme.test", replace: false }, found);
    expect(out.saved).toBe(false);
    expect(db.find("workspaces", { id: WS })?.brand_primary).toBe("#112233");
  });

  it("are replaced when somebody presses the button", async () => {
    const { db, ctx } = harness({ brand_primary: "#112233" });
    await detectBrandColors(ctx, { workspaceId: WS, websiteUrl: "acme.test", replace: true }, found);
    expect(db.find("workspaces", { id: WS })?.brand_primary).toBe("#0A7CFF");
  });

  it("are read from the website setup was given when there is no business profile yet", async () => {
    const { ctx } = harness({ onboarding: { source: { websiteUrl: "acme.test" } } });
    expect(await workspaceWebsite(ctx, WS)).toBe("acme.test");
  });
});
