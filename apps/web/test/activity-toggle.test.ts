import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fake-supabase";

/*
 * The LinkedIn activity switches. The old Likes and comments page posted no
 * `setting`, and its one switch meant both: a page left open across the
 * deploy that says "stop" must stop comments too, the action LinkedIn's
 * policy watches most closely.
 */
const h = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase-server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/workspace", () => ({
  requireSession: async () => ({ workspaceId: "ws-1", userId: "user-1", role: "owner" }),
}));

import { POST } from "../src/app/app/profile/activity/toggle/route";

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return POST(new Request("https://app.test/app/profile/activity/toggle", { method: "POST", body }) as never);
}

function db() {
  return fakeSupabase((call) => (call.table === "workspaces" && call.op === "update" ? { data: [{ id: "ws-1" }] } : undefined));
}

beforeEach(() => {
  h.client = null;
});

describe("the activity switches", () => {
  it("an old page's 'off' with no setting stops likes and comments both", async () => {
    const fake = db();
    h.client = fake.client;
    await post({ on: "false" });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(update.payload).toEqual({ engage_posts: false, engage_comments: false });
  });

  it("the comment switch changes comments only", async () => {
    const fake = db();
    h.client = fake.client;
    await post({ setting: "engage_comments", on: "false" });
    const update = fake.calls.find((c) => c.op === "update")!;
    expect(update.payload).toEqual({ engage_comments: false });
  });

  it("a warm-up switch whose read failed writes nothing over the setup answers", async () => {
    const fake = fakeSupabase((call) => {
      if (call.table === "workspaces" && call.op === "select") return { data: null, error: { message: "timeout" } };
      if (call.op === "update") return { data: [{ id: "ws-1" }] };
      return undefined;
    });
    h.client = fake.client;
    const res = await post({ setting: "warm_up", on: "false" });
    expect(fake.calls.some((c) => c.op === "update")).toBe(false);
    expect(res.headers.get("location")).toMatch(/error=/);
  });

  it("a warm-up switch keeps the other setup answers", async () => {
    const fake = fakeSupabase((call) => {
      if (call.table === "workspaces" && call.op === "select") return { data: { onboarding: { timezone: "America/New_York" } } };
      if (call.op === "update") return { data: [{ id: "ws-1" }] };
      return undefined;
    });
    h.client = fake.client;
    await post({ setting: "warm_up", on: "false" });
    const update = fake.calls.find((c) => c.table === "workspaces" && c.op === "update")!;
    expect(update.payload).toMatchObject({ onboarding: { timezone: "America/New_York", warmUp: false } });
  });
});
