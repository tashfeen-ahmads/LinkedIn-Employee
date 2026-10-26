import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/create-workspace", () => ({ createWorkspace: async () => "/onboarding?step=linkedin" }));

/**
 * A new workspace goes through its own setup.
 *
 * The "setup finished" cookie names the person, and an owner whose workspace
 * was deleted to start again kept it: the new workspace's setup was skipped to
 * the dashboard the moment LinkedIn connected.
 */
describe("creating a workspace", () => {
  it("clears any setup-finished cookie from a workspace this person had before", async () => {
    const { POST } = await import("../src/app/onboarding/submit/route");
    const { SETUP_DONE_COOKIE } = await import("../src/lib/wizard");
    const response = await POST(new Request("https://app.test/onboarding/submit", { method: "POST", body: new FormData() }) as never);
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie") ?? "").toMatch(new RegExp(`^${SETUP_DONE_COOKIE}=;.*Max-Age=0`));
  });
});
