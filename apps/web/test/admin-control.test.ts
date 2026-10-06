import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { controlFromForm, safeBack } from "../src/lib/admin-control";

/**
 * The operator console's buttons: what a form may send to the worker, and where
 * it may send the operator afterwards.
 */
const ADMIN = join(__dirname, "..", "src", "app", "admin");

describe("controlFromForm", () => {
  it("carries the op and only the fields a control may have", () => {
    const form = new FormData();
    form.set("op", "campaign-pause");
    form.set("campaignId", " 44444444-4444-4444-8444-444444444444 ");
    form.set("userId", "somebody-else");
    form.set("on", "true");
    expect(controlFromForm(form)).toEqual({
      op: "campaign-pause",
      campaignId: "44444444-4444-4444-8444-444444444444",
      on: true,
    });
  });

  it("is nothing without an op", () => {
    expect(controlFromForm(new FormData())).toBeNull();
  });
});

describe("safeBack", () => {
  it("returns to a console page", () => {
    expect(safeBack("/admin/campaigns?status=running")).toBe("/admin/campaigns?status=running");
    expect(safeBack("/admin")).toBe("/admin");
  });

  it("never sends an operator anywhere else", () => {
    for (const bad of ["https://evil.example/admin", "//evil.example", "/app/support", "/admin/../app", null]) {
      expect(safeBack(bad as never)).toBe("/admin");
    }
  });
});

describe("the console", () => {
  const layout = readFileSync(join(ADMIN, "layout.tsx"), "utf8");

  it("has a tab for every part of the product it controls", () => {
    for (const href of [
      "/admin",
      "/admin/issues",
      "/admin/support",
      "/admin/workspaces",
      "/admin/users",
      "/admin/campaigns",
      "/admin/accounts",
      "/admin/jobs",
      "/admin/spend",
      "/admin/settings",
    ]) {
      expect(layout).toContain(`href: "${href}"`);
    }
  });

  it("offers no way to launch a campaign or grant admin", () => {
    // Launch is the owner's yes (the one gate with no way round it), and
    // nothing grants admin through the product (rule 15).
    const control = readFileSync(join(__dirname, "..", "..", "worker", "src", "jobs", "admin-control.ts"), "utf8");
    expect(control).not.toMatch(/op: z\.literal\("campaign-launch"\)/);
    expect(control).not.toMatch(/from\("platform_admins"\)/);
  });
});
