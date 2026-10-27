import { beforeEach, describe, expect, it, vi } from "vitest";
import { eqOf, fakeSupabase, type FakeCall } from "./fake-supabase";

const h = vi.hoisted(() => ({ client: null as unknown, blockers: [] as string[] }));
vi.mock("@/lib/supabase-server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/worker", () => ({ callWorker: async () => ({ ok: true }) }));
vi.mock("@/lib/campaign", () => ({ launchBlockers: () => h.blockers }));

import { setAutonomy, setReplyHandling } from "../src/lib/autonomy";
import { launch } from "../src/lib/launch";

const WS = "ws-1";
const LAUNCHED = "c-launched";

/** A workspace with three campaigns: the one being launched, one on autopilot, one on approval. */
function workspace() {
  const campaigns = [
    { id: LAUNCHED, rules: { autonomy: "supervised" }, reply_mode: "approval" },
    { id: "c-auto", rules: { autonomy: "autonomous" }, reply_mode: "autopilot" },
    { id: "c-held", rules: { autonomy: "supervised", droppedFilters: ["x"] }, reply_mode: "approval" },
  ];
  const fake = fakeSupabase((call) => {
    if (call.table === "workspaces" && call.op === "select") return { data: { onboarding: { workingHours: { start: 9 } } } };
    if (call.table === "workspaces" && call.op === "update") return { data: [{ id: WS }] };
    if (call.table === "campaigns" && call.op === "select") {
      const id = eqOf(call, "id");
      return id ? { data: campaigns.find((c) => c.id === id) ?? null } : { data: campaigns };
    }
    if (call.table === "campaigns" && call.op === "update") return { data: [{ id: eqOf(call, "id") }] };
    return undefined;
  });
  /** The last reply mode and autonomy written onto each campaign. */
  const written = () => {
    const out: Record<string, { reply_mode?: string; autonomy?: string }> = {};
    for (const call of fake.calls.filter((c: FakeCall) => c.table === "campaigns" && c.op === "update")) {
      const payload = call.payload as { reply_mode?: string; rules?: { autonomy?: string } };
      const id = String(eqOf(call, "id"));
      out[id] = {
        ...out[id],
        ...("reply_mode" in payload ? { reply_mode: payload.reply_mode } : {}),
        autonomy: payload.rules?.autonomy,
      };
    }
    return out;
  };
  return { ...fake, written };
}

describe("the launch step's answer is the setting for every campaign", () => {
  it("“I'll check each one” holds replies on every campaign, including one already on autopilot", async () => {
    const db = workspace();
    expect(await setReplyHandling(db.client as never, WS, LAUNCHED, "check", true)).toBe(true);
    const w = db.written();
    expect(w["c-auto"]).toEqual({ reply_mode: "approval", autonomy: "supervised" });
    expect(w["c-held"]).toEqual({ reply_mode: "approval", autonomy: "supervised" });
    expect(w[LAUNCHED]).toEqual({ reply_mode: "approval", autonomy: "supervised" });
  });

  it("“Nora runs it” takes every campaign off approval", async () => {
    const db = workspace();
    expect(await setReplyHandling(db.client as never, WS, LAUNCHED, "nora", true)).toBe(true);
    const w = db.written();
    expect(w["c-held"]).toEqual({ reply_mode: "autopilot", autonomy: "autonomous" });
    expect(w[LAUNCHED]).toEqual({ reply_mode: "autopilot", autonomy: "autonomous" });
    // Merged, so a campaign's record of its search survives.
    const held = db.calls.find((c) => c.op === "update" && eqOf(c, "id") === "c-held")!;
    expect((held.payload as { rules: Record<string, unknown> }).rules.droppedFilters).toEqual(["x"]);
  });

  it("somebody who may not write the workspace sets only the campaign being launched", async () => {
    const db = workspace();
    expect(await setReplyHandling(db.client as never, WS, LAUNCHED, "check", false)).toBe(true);
    expect(Object.keys(db.written())).toEqual([LAUNCHED]);
    expect(db.calls.some((c) => c.table === "workspaces" && c.op === "update")).toBe(false);
  });

  it("the profile's “hold anything uncertain” still leaves each campaign's mode as it was", async () => {
    const db = workspace();
    expect(await setAutonomy(db.client as never, WS, "supervised")).toBe(true);
    for (const value of Object.values(db.written())) expect(value).not.toHaveProperty("reply_mode");
  });
});

describe("launch never changes how replies are handled", () => {
  // A rep who picked "Hold for my approval" on the campaign page just before
  // pressing Launch must not have that silently switched to autopilot.
  function launchDb(campaign: { rules: unknown; reply_mode: string }) {
    return fakeSupabase((call) => {
      if (call.table === "campaigns" && call.op === "select") {
        return { data: { connection_note: "", daily_invite_cap: 10, linkedin_account_id: "acc", ...campaign } };
      }
      if (call.table === "campaigns" && call.op === "update") return { data: [{ id: "c1" }] };
      if (call.table === "campaign_prospects") return { data: [], count: 3 };
      if (call.table === "campaign_steps") return { data: [] };
      if (call.table === "linkedin_accounts") return { data: { status: "active", status_detail: null } };
      return undefined;
    });
  }

  beforeEach(() => {
    h.blockers = [];
  });

  it("keeps an explicit approval choice on an autonomous campaign", async () => {
    const db = launchDb({ rules: { autonomy: "autonomous" }, reply_mode: "approval" });
    h.client = db.client;
    expect((await launch("c1", { workspaceId: WS, userId: "u" })).status).toBe("launched");
    const update = db.calls.find(
      (c) => c.table === "campaigns" && c.op === "update" && (c.payload as { status?: string }).status,
    )!;
    expect(update.payload).toMatchObject({ status: "running" });
    expect(update.payload).not.toHaveProperty("reply_mode");
  });

  it("stamps the launch date only on the first launch, never on a resume", async () => {
    // Refill's day of grace reads it; a resume restamping it held a drained
    // campaign's refill off for a day.
    const db = launchDb({ rules: { autonomy: "supervised" }, reply_mode: "approval" });
    h.client = db.client;
    await launch("c1", { workspaceId: WS, userId: "u" });
    const stamp = db.calls.find(
      (c) => c.table === "campaigns" && c.op === "update" && (c.payload as { launched_at?: string }).launched_at,
    )!;
    expect(stamp.filters).toContainEqual(["is", "launched_at", null]);
    const running = db.calls.find(
      (c) => c.table === "campaigns" && c.op === "update" && (c.payload as { status?: string }).status,
    )!;
    expect(running.payload).not.toHaveProperty("launched_at");
    // Stamped before the status, so a campaign is never running with no
    // launch on record.
    expect(db.calls.indexOf(stamp)).toBeLessThan(db.calls.indexOf(running));
  });

  it("refuses, and sets nothing running, when the first-launch stamp cannot be written", async () => {
    // Running with no launch on record sends the owner back to setup while
    // the campaign sends.
    const db = fakeSupabase((call) => {
      if (call.table === "campaigns" && call.op === "select") {
        return { data: { connection_note: "", daily_invite_cap: 10, linkedin_account_id: "acc", launched_at: null } };
      }
      if (call.table === "campaigns" && call.op === "update") {
        return (call.payload as { launched_at?: string }).launched_at
          ? { error: { message: "timeout" } }
          : { data: [{ id: "c1" }] };
      }
      if (call.table === "campaign_prospects") return { data: [], count: 3 };
      if (call.table === "campaign_steps") return { data: [] };
      if (call.table === "linkedin_accounts") return { data: { status: "active", status_detail: null } };
      return undefined;
    });
    h.client = db.client;
    expect((await launch("c1", { workspaceId: WS, userId: "u" })).status).toBe("failed");
    expect(
      db.calls.some((c) => c.table === "campaigns" && c.op === "update" && (c.payload as { status?: string }).status),
    ).toBe(false);
  });

  it("leaves a supervised campaign's mode alone", async () => {
    const db = launchDb({ rules: { autonomy: "supervised" }, reply_mode: "autopilot" });
    h.client = db.client;
    expect((await launch("c1", { workspaceId: WS, userId: "u" })).status).toBe("launched");
    const update = db.calls.find((c) => c.table === "campaigns" && c.op === "update")!;
    expect(update.payload).not.toHaveProperty("reply_mode");
  });
});
