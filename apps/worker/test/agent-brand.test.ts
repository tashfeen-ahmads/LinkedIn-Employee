import { describe, expect, it } from "vitest";
import type { BusinessProfile } from "@le/shared";
import { businessFor, withBrand } from "../src/brand.js";
import { FakeDb } from "./fake-db.js";

/**
 * An agent can speak for its own brand (migration 0047), and the workspace's
 * one business profile (rule 37) is what it falls back to.
 */

const WS = "ws-1";
const OTHER_WS = "ws-2";

const acme: BusinessProfile = {
  companyName: "Acme",
  oneLiner: "Acme sells revenue tooling to B2B teams.",
  offering: "A platform.",
  pricingModel: "$99 a month",
  proofPoints: ["Doubled pipeline for 40 agencies"],
  toneOfVoice: "Plain and direct.",
  competitors: ["Outreach"],
  commonObjections: ["Too expensive"],
  differentiators: ["Built for LinkedIn"],
};

function db() {
  const fake = new FakeDb();
  fake.seed("business_profiles", [{ id: "bp-1", workspace_id: WS, spec: acme, created_at: "2026-01-01T00:00:00Z" }]);
  fake.seed("agents", [
    { id: "a-brand", workspace_id: WS, name: "B", brand_name: "Beta", brand_description: "Beta fills dentists' diaries." },
    { id: "a-plain", workspace_id: WS, name: "Plain", brand_name: null, brand_description: null },
    { id: "a-name-only", workspace_id: WS, name: "Half", brand_name: "Gamma", brand_description: "  " },
    { id: "a-foreign", workspace_id: OTHER_WS, name: "Theirs", brand_name: "Theirs", brand_description: "Another company's product." },
  ]);
  return fake;
}

describe("withBrand", () => {
  it("returns the workspace's business untouched when there is no brand", () => {
    expect(withBrand(acme, null)).toBe(acme);
    expect(withBrand(acme, { name: "Gamma", description: "" })).toBe(acme);
  });

  it("leaves the workspace's facts out of a brand's profile", () => {
    const branded = withBrand(acme, { name: "Beta", description: "Beta fills dentists' diaries." })!;
    expect(branded.companyName).toBe("Beta");
    expect(branded.offering).toBe("Beta fills dentists' diaries.");
    expect(branded.proofPoints).toEqual([]);
    expect(branded.pricingModel).toBe("unknown");
    expect(branded.differentiators).toEqual([]);
    expect(branded.toneOfVoice).toBe("Plain and direct.");
  });

  it("is a profile on its own when the workspace has none yet", () => {
    expect(withBrand(null, { name: "Beta", description: "Beta fills dentists' diaries." })?.companyName).toBe("Beta");
    expect(withBrand(null, null)).toBeNull();
  });
});

describe("businessFor", () => {
  it("overlays the agent's brand", async () => {
    expect((await businessFor(db().asDb(), WS, "a-brand"))?.companyName).toBe("Beta");
  });

  it("falls back to the workspace profile for an agent with no brand, or none at all", async () => {
    expect(await businessFor(db().asDb(), WS, "a-plain")).toEqual(acme);
    expect(await businessFor(db().asDb(), WS, null)).toEqual(acme);
  });

  it("ignores a brand name with nothing said about what it sells", async () => {
    expect(await businessFor(db().asDb(), WS, "a-name-only")).toEqual(acme);
  });

  it("never reads another workspace's agent", async () => {
    expect(await businessFor(db().asDb(), WS, "a-foreign")).toEqual(acme);
  });
});
