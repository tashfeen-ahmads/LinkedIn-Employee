import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeCall, type FakeResult } from "./fake-supabase";

/*
 * The onboarding save route, run as written against a recording database.
 * Only what the route reaches beyond it is replaced: the wizard read, the
 * launch, and the workers it calls.
 */
const h = vi.hoisted(() => ({
  client: null as unknown,
  blockers: [] as string[],
  launchOutcome: { status: "launched", kicked: true } as unknown,
  replyHandlingOk: true,
}));

vi.mock("@/lib/supabase-server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/worker", () => ({ callWorker: async () => ({ ok: true, data: {} }) }));
vi.mock("@/lib/search", () => ({ queueSearch: async () => ({ ok: true }) }));
vi.mock("@/lib/approve", () => ({ approveStrategy: async () => ({ ok: true }), planFlags: () => null }));
vi.mock("@/lib/agent-voice", () => ({ carryVoiceToAgent: async () => true }));
vi.mock("@/lib/cta-library", () => ({ ensureCta: async () => "cta-1" }));
vi.mock("@/lib/availability", () => ({
  AVAILABILITY_DEFAULTS: { minNoticeHours: 4, bufferMinutes: 10, maxPerDay: 4 },
  availabilityProblem: () => null,
  saveAvailability: async () => true,
}));
vi.mock("@/lib/campaign", () => ({ launchBlockers: () => h.blockers }));
vi.mock("@/lib/launch", () => ({
  launchState: async () => ({}),
  launch: async () => h.launchOutcome,
}));
vi.mock("@/lib/autonomy", () => ({
  AUTONOMY_ROLES: ["owner", "admin", "manager"],
  setReplyHandling: async () => h.replyHandlingOk,
}));
vi.mock("@/lib/wizard-state", () => ({
  readWizard: async () => ({
    unreadable: false,
    workspaceId: "ws-1",
    role: "owner",
    workspaceName: "Acme",
    stash: { source: {}, cta: null, autonomy: null },
    confirmations: {},
    account: null,
    facts: {
      hasWorkspace: true,
      linkedInActive: true,
      confirmed: { hours: true, voice: true, cta: true },
      hasMeetingHours: true,
      hasApprovedStrategy: true,
      hasCampaign: true,
      hasLaunchedCampaign: false,
    },
  }),
}));

import { POST } from "../src/app/onboarding/save/route";

const CAMPAIGN = "4f1c2a9e-8b7d-4c3e-9a1b-2c3d4e5f6a7b";

function post(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return POST(new Request("http://localhost/onboarding/save", { method: "POST", body: form }) as never);
}

function useDb(respond: (call: FakeCall) => FakeResult) {
  const fake = fakeSupabase(respond);
  h.client = fake.client;
  return fake;
}

/** A database where the posted campaign is this workspace's draft. */
const draftDb = (call: FakeCall): FakeResult => {
  if (call.table === "campaigns" && call.op === "select") return { data: { id: CAMPAIGN } };
  return { data: [{ id: "row" }] };
};

beforeEach(() => {
  h.blockers = [];
  h.launchOutcome = { status: "launched", kicked: true };
  h.replyHandlingOk = true;
});

describe("every launch-step refusal reloads onto the same campaign", () => {
  const back = (code: string) => `/onboarding?step=launch&error=${code}&campaign=${CAMPAIGN}`;

  it("blocked before anything is written", async () => {
    useDb(draftDb);
    h.blockers = ["Nobody is on the list."];
    const res = await post({ action: "launch", campaignId: CAMPAIGN, handling: "check" });
    expect(res.headers.get("Location")).toBe(back("launch-blocked"));
  });

  it("no answer to who handles replies", async () => {
    useDb(draftDb);
    const res = await post({ action: "launch", campaignId: CAMPAIGN });
    expect(res.headers.get("Location")).toBe(back("handling"));
  });

  it("reply handling not saved", async () => {
    useDb(draftDb);
    h.replyHandlingOk = false;
    const res = await post({ action: "launch", campaignId: CAMPAIGN, handling: "nora" });
    expect(res.headers.get("Location")).toBe(back("save-failed"));
  });

  it("the opener changed since the page loaded", async () => {
    useDb((call) => {
      if (call.table === "campaigns") return { data: { id: CAMPAIGN } };
      if (call.table === "hooks" && call.op === "update") return { data: [] };
      if (call.table === "hooks") return { data: { approved_at: null } };
      return { data: [{ id: "row" }] };
    });
    const res = await post({
      action: "launch",
      campaignId: CAMPAIGN,
      handling: "check",
      lineTable: "hooks",
      lineId: "hook-1",
      lineBody: "old words",
    });
    expect(res.headers.get("Location")).toBe(back("copy-changed"));
  });

  it("the launch itself failed", async () => {
    useDb(draftDb);
    h.launchOutcome = { status: "failed" };
    const res = await post({ action: "launch", campaignId: CAMPAIGN, handling: "check" });
    expect(res.headers.get("Location")).toBe(back("launch-failed"));
  });

  it("a campaign that is not this workspace's draft", async () => {
    useDb(() => ({ data: null }));
    const res = await post({ action: "launch", campaignId: CAMPAIGN, handling: "check" });
    expect(res.headers.get("Location")).toBe(back("launch-missing"));
  });

  it("an id that is not a uuid is never carried, or looked up", async () => {
    const db = useDb(draftDb);
    const res = await post({ action: "launch", campaignId: "x&step=business", handling: "check" });
    expect(res.headers.get("Location")).toBe("/onboarding?step=launch&error=launch-missing");
    expect(db.calls.some((c) => c.table === "campaigns")).toBe(false);
  });

  it("attaches the opener approved here to this campaign's angles that carry none", async () => {
    // Attached, it is this audience's line, and a campaign for another
    // strategy is not given it to borrow (rule 40).
    const db = useDb(draftDb);
    await post({
      action: "launch",
      campaignId: CAMPAIGN,
      handling: "check",
      lineTable: "hooks",
      lineId: "hook-1",
      lineBody: "Who sent you your last client?",
    });
    const attach = db.calls.find((c) => c.table === "campaign_variants" && c.op === "update");
    expect(attach?.payload).toEqual({ hook_id: "hook-1" });
    expect(attach?.filters).toContainEqual(["eq", "campaign_id", CAMPAIGN]);
    expect(attach?.filters).toContainEqual(["is", "hook_id", null]);
  });

  it("a launch that goes through still opens the app", async () => {
    useDb(draftDb);
    const res = await post({ action: "launch", campaignId: CAMPAIGN, handling: "check" });
    expect(res.headers.get("Location")).toBe("/app?tour=1&launched=1");
  });
});

describe("Book a meeting keeps a scheduling link typed in the general link box", () => {
  const bookingWrites = (calls: FakeCall[]) =>
    calls
      .filter((c) => c.table === "profiles" && c.op === "update" && "booking_url" in (c.payload as object))
      .map((c) => (c.payload as { booking_url: string }).booking_url);

  const ctaDb = (call: FakeCall): FakeResult => {
    if (call.op === "select" && (call.table === "customer_profiles" || call.table === "campaigns")) return { data: [] };
    if (call.op === "select") return { data: null };
    return { data: [{ id: "row" }] };
  };

  it("saved as the booking link when the scheduling box is empty", async () => {
    const db = useDb(ctaDb);
    const res = await post({ action: "cta", ctaKind: "meeting", ctaUrl: "cal.com/sam", bookingUrl: "" });
    expect(res.headers.get("Location")).toBe("/onboarding");
    expect(bookingWrites(db.calls)).toEqual(["https://cal.com/sam"]);
  });

  it("the scheduling box wins when both are filled", async () => {
    const db = useDb(ctaDb);
    await post({ action: "cta", ctaKind: "meeting", ctaUrl: "cal.com/other", bookingUrl: "calendly.com/sam" });
    expect(bookingWrites(db.calls)).toEqual(["https://calendly.com/sam"]);
  });

  it("a bad scheduling link is still refused", async () => {
    const db = useDb(ctaDb);
    const res = await post({ action: "cta", ctaKind: "meeting", ctaUrl: "", bookingUrl: "not a link" });
    expect(res.headers.get("Location")).toBe("/onboarding?step=cta&error=booking-url");
    expect(bookingWrites(db.calls)).toEqual([]);
  });

  it("a link campaign never writes a booking link", async () => {
    const db = useDb(ctaDb);
    await post({ action: "cta", ctaKind: "link", ctaUrl: "acme.com/offer", bookingUrl: "" });
    expect(bookingWrites(db.calls)).toEqual([]);
  });
});
