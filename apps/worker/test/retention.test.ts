import { MAX_PAGES, PAGE_SIZE } from "@le/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db.js";
import { eraseProspect, exportWorkspace, runRetentionSweep } from "../src/jobs/retention.js";
import type { WorkerContext } from "../src/context.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const PROSPECT = "55555555-5555-4555-8555-555555555555";
const CONVERSATION = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-09-09T12:00:00Z");

function harness(options: { createdAt?: string; retentionDays?: number } = {}) {
  const db = new FakeDb();
  db.seed("workspaces", [
    { id: WORKSPACE, name: "Acme", plan: "pro", data_retention_days: options.retentionDays ?? 365 },
  ]);
  db.seed("prospects", [
    {
      id: PROSPECT,
      workspace_id: WORKSPACE,
      linkedin_url: "linkedin.com/in/jane-doe",
      provider_id: "prov_jane",
      first_name: "Jane",
      last_name: "Doe",
      title: "Head of Ops",
      company: "Northwind",
      about: "Long biography full of personal detail.",
      do_not_contact: false,
      created_at: options.createdAt ?? NOW.toISOString(),
      signals: [{ type: "new_role", detail: "Started recently" }],
      fit_reasons: ["Right title"],
      fit_score: 88,
    },
  ]);
  db.seed("conversations", [
    { id: CONVERSATION, workspace_id: WORKSPACE, prospect_id: PROSPECT, linkedin_account_id: "acct" },
  ]);
  db.seed("messages", [
    { workspace_id: WORKSPACE, conversation_id: CONVERSATION, direction: "inbound", source: "human", body: "Personal reply" },
    { workspace_id: WORKSPACE, conversation_id: CONVERSATION, direction: "outbound", source: "agent", body: "Our message" },
  ]);
  db.seed("reply_drafts", [
    { workspace_id: WORKSPACE, conversation_id: CONVERSATION, body: "draft", status: "pending", prompt_version: "v1" },
  ]);
  db.seed("meetings", [
    {
      workspace_id: WORKSPACE,
      prospect_id: PROSPECT,
      rep_user_id: "user",
      starts_at: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(),
      ends_at: new Date(NOW.getTime() - 30 * 86_400_000 + 1_800_000).toISOString(),
    },
  ]);
  db.seed("campaign_prospects", [
    { workspace_id: WORKSPACE, campaign_id: "camp", prospect_id: PROSPECT, status: "closed" },
  ]);

  const ctx = { db: db.asDb() } as unknown as WorkerContext;
  return { db, ctx };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("eraseProspect", () => {
  it("removes the conversation, its messages, drafts and meetings", async () => {
    const { db, ctx } = harness();

    const result = await eraseProspect(ctx, { workspaceId: WORKSPACE, prospectId: PROSPECT, reason: "request" });

    expect(result.messagesDeleted).toBe(2);
    expect(db.rows("messages")).toHaveLength(0);
    expect(db.rows("reply_drafts")).toHaveLength(0);
    expect(db.rows("conversations")).toHaveLength(0);
    expect(db.rows("meetings")).toHaveLength(0);
    expect(db.rows("campaign_prospects")).toHaveLength(0);
  });

  it("strips every identifying field from the prospect", async () => {
    const { db, ctx } = harness();

    await eraseProspect(ctx, { workspaceId: WORKSPACE, prospectId: PROSPECT, reason: "request" });

    const row = db.find("prospects", { id: PROSPECT })!;
    for (const field of ["first_name", "last_name", "title", "company", "about", "provider_id"]) {
      expect(row[field], field).toBeNull();
    }
    expect(row.signals).toEqual([]);
    expect(row.fit_score).toBeNull();
  });

  it("keeps a do-not-contact tombstone so they are not re-imported later", async () => {
    const { db, ctx } = harness();

    await eraseProspect(ctx, { workspaceId: WORKSPACE, prospectId: PROSPECT, reason: "request" });

    const row = db.find("prospects", { id: PROSPECT })!;
    // Forgetting someone entirely would let the next campaign import them and
    // message them again — the opposite of what they asked for.
    expect(row.do_not_contact).toBe(true);
    expect(row.linkedin_url).toBe("linkedin.com/in/jane-doe");
    expect(String(row.do_not_contact_reason)).toContain("erased");
  });

  it("writes an audit event containing no personal data", async () => {
    const { db, ctx } = harness();

    await eraseProspect(ctx, { workspaceId: WORKSPACE, prospectId: PROSPECT, reason: "subject request" });

    const event = db.rows("events")[0]!;
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("Jane");
    expect(serialized).not.toContain("Northwind");
    expect(serialized).toContain("erased");
  });

  it("refuses to erase across workspaces", async () => {
    const { db, ctx } = harness();

    const result = await eraseProspect(ctx, {
      workspaceId: "99999999-9999-4999-8999-999999999999",
      prospectId: PROSPECT,
      reason: "request",
    });

    expect(result.prospectsDeleted).toBe(0);
    expect(db.find("prospects", { id: PROSPECT })?.first_name).toBe("Jane");
  });
});

describe("runRetentionSweep", () => {
  it("erases a prospect held past the retention limit", async () => {
    const { db, ctx } = harness({
      createdAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
      retentionDays: 365,
    });

    expect(await runRetentionSweep(ctx, NOW)).toBe(1);
    expect(db.find("prospects", { id: PROSPECT })?.first_name).toBeNull();
  });

  it("leaves recent prospects alone", async () => {
    const { db, ctx } = harness({ createdAt: new Date(NOW.getTime() - 10 * 86_400_000).toISOString() });

    expect(await runRetentionSweep(ctx, NOW)).toBe(0);
    expect(db.find("prospects", { id: PROSPECT })?.first_name).toBe("Jane");
  });

  it("spares someone with an upcoming meeting", async () => {
    const { db, ctx } = harness({
      createdAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
    });
    db.rows("meetings")[0]!.starts_at = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();

    // Retention limits are about data nobody needs, not about deleting a deal
    // that is still in progress.
    expect(await runRetentionSweep(ctx, NOW)).toBe(0);
    expect(db.find("prospects", { id: PROSPECT })?.first_name).toBe("Jane");
  });

  it("spares someone still in an open campaign", async () => {
    const { db, ctx } = harness({
      createdAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
    });
    db.rows("campaign_prospects")[0]!.status = "messaged_1";

    expect(await runRetentionSweep(ctx, NOW)).toBe(0);
  });

  it("honours a shorter per-workspace retention setting", async () => {
    const { ctx } = harness({
      createdAt: new Date(NOW.getTime() - 45 * 86_400_000).toISOString(),
      retentionDays: 30,
    });

    expect(await runRetentionSweep(ctx, NOW)).toBe(1);
  });

  it("does not re-erase an existing tombstone", async () => {
    const { db, ctx } = harness({
      createdAt: new Date(NOW.getTime() - 400 * 86_400_000).toISOString(),
    });
    db.find("prospects", { id: PROSPECT })!.do_not_contact = true;

    expect(await runRetentionSweep(ctx, NOW)).toBe(0);
  });
});

describe("exportWorkspace", () => {
  it("returns the workspace's own records", async () => {
    const { ctx } = harness();

    const dump = await exportWorkspace(ctx, WORKSPACE);

    expect(dump.prospects).toHaveLength(1);
    expect(dump.messages).toHaveLength(2);
    expect(dump.exportedAt).toBeTruthy();
  });

  it("never includes credentials", async () => {
    const { db, ctx } = harness();
    db.seed("integrations", [
      { workspace_id: WORKSPACE, kind: "hubspot", credentials_encrypted: "iv.tag.ciphertext", status: "active" },
    ]);

    const serialized = JSON.stringify(await exportWorkspace(ctx, WORKSPACE));
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("credentials_encrypted");
  });

  it("includes everyone past PostgREST's thousand-row cap", async () => {
    // This is what answers a subject-access request. A plain select stops at
    // a thousand rows and reports the fact nowhere, so the file would look
    // complete and omit everybody after that — a worse answer than no file.
    const { db, ctx } = harness();
    db.seed(
      "prospects",
      Array.from({ length: PAGE_SIZE + 250 }, (_, i) => ({
        workspace_id: WORKSPACE,
        linkedin_url: `https://www.linkedin.com/in/person-${i}/`,
      })),
    );

    const dump = await exportWorkspace(ctx, WORKSPACE);

    // The one seeded by the harness, plus every one of these.
    expect(dump.prospects).toHaveLength(PAGE_SIZE + 251);
    expect(dump.complete).toBe(true);
  });

  /*
   * The slowest test in this repo, on purpose, and with its own timeout.
   *
   * Proving the safety stop means going past it, and the stop is fifty pages of
   * a thousand — so there is no honest way to assert this with fewer than
   * 50,001 rows. The cost is not in `fetchAllRows`; it is `fake-db` filtering
   * and re-sorting the whole seeded array once per page, fifty times, which is
   * the harness being simple rather than fast.
   *
   * It ran in 4896ms against vitest's 5000ms default, so it had about a tenth
   * of a second of headroom and had been a coin flip on a loaded CI box for
   * some time; the vitest 4 upgrade tipped it over rather than caused it. The
   * timeout is explicit here and not raised globally, because a global one
   * would also buy that rope for a test that is genuinely hung.
   */
  it(
    "says so when it gave up rather than handing over a partial file",
    async () => {
      const { db, ctx } = harness();
      db.seed(
        "conversations",
        Array.from({ length: PAGE_SIZE * MAX_PAGES + 1 }, () => ({ workspace_id: WORKSPACE })),
      );

      const dump = await exportWorkspace(ctx, WORKSPACE);

      expect(dump.complete).toBe(false);
    },
    20_000,
  );
});

describe("exportWorkspace — configuration and suppression", () => {
  const OTHER = "99999999-9999-4999-8999-999999999999";
  const MEMBER = "77777777-7777-4777-8777-777777777777";
  const STRANGER = "88888888-8888-4888-8888-888888888888";

  /** One row per configuration table in this workspace, and one in another. */
  function configured() {
    const { db, ctx } = harness();
    db.find("workspaces", { id: WORKSPACE })!.onboarding = { workingHours: null, hasSalesNavigator: false, autonomy: "reviewed" };
    db.find("workspaces", { id: WORKSPACE })!.stripe_customer_id = "cus_secret_billing";
    db.seed("memberships", [
      { workspace_id: WORKSPACE, user_id: MEMBER, role: "owner" },
      { workspace_id: OTHER, user_id: STRANGER, role: "owner" },
    ]);
    db.seed("profiles", [
      { id: MEMBER, email: "owner@acme.test", full_name: "Owner", timezone: "Europe/London", booking_url: "https://cal.com/owner", address: "1 Home Street" },
      { id: STRANGER, email: "stranger@other.test", timezone: "UTC", booking_url: "https://cal.com/stranger" },
    ]);
    db.seed("linkedin_accounts", [
      {
        workspace_id: WORKSPACE,
        user_id: MEMBER,
        provider_account_id: "acct_provider_secret",
        linkedin_member_id: "member_provider_secret",
        status: "active",
        working_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
      },
    ]);
    db.seed("calendar_feeds", [
      { workspace_id: WORKSPACE, user_id: MEMBER, url_encrypted: "iv.tag.feedciphertext", url_host: "calendar.google.com", status: "ok" },
    ]);
    db.seed("integrations", [
      { workspace_id: WORKSPACE, kind: "hubspot", credentials_encrypted: "iv.tag.oauthciphertext", status: "active" },
    ]);
    const perTable: Array<[string, Record<string, unknown>]> = [
      ["business_profiles", { spec: { companyName: "Acme" } }],
      ["customer_profiles", { name: "Ops leaders", spec: {} }],
      ["campaign_steps", { campaign_id: "camp", step_number: 1, delay_days: 0, message: "Hi" }],
      ["campaign_variants", { campaign_id: "camp", name: "Angle A" }],
      ["ctas", { kind: "link", label: "Free audit", url: "https://acme.test/audit" }],
      ["pitches", { body: "Our offer", approved_at: "2026-09-01T00:00:00Z" }],
      ["hooks", { body: "Our opener", approved_at: "2026-09-01T00:00:00Z" }],
      ["agents", { name: "Brand A" }],
      ["knowledge_documents", { title: "Pricing", content: "Ten a month." }],
      ["availability", { user_id: MEMBER, timezone: "Europe/London" }],
      ["availability_blackouts", { user_id: MEMBER, starts_at: "2026-09-10T09:00:00Z", ends_at: "2026-09-10T10:00:00Z" }],
      ["exclusions", { kind: "company", value: "globex", raw_value: "Globex" }],
    ];
    for (const [table, row] of perTable) {
      db.seed(table, [
        { ...row, workspace_id: WORKSPACE, marker: "ours" },
        { ...row, workspace_id: OTHER, marker: "theirs" },
      ]);
    }
    return { db, ctx };
  }

  it("carries every configuration and suppression table, only this workspace's", async () => {
    const { ctx } = configured();
    const dump = (await exportWorkspace(ctx, WORKSPACE)) as unknown as Record<string, unknown>;

    for (const key of [
      "businessProfiles",
      "customerProfiles",
      "campaignSteps",
      "campaignVariants",
      "ctas",
      "pitches",
      "hooks",
      "agents",
      "knowledgeDocuments",
      "availability",
      "availabilityBlackouts",
      "exclusions",
    ]) {
      const rows = dump[key] as Array<Record<string, unknown>>;
      expect(rows, key).toHaveLength(1);
      expect(rows[0]!.workspace_id, key).toBe(WORKSPACE);
      expect(rows[0]!.marker, key).toBe("ours");
    }
    // The harness's own campaign membership row.
    expect((dump.campaignProspects as unknown[]).length).toBe(1);
    expect(dump.complete).toBe(true);
  });

  it("says which shape it is and what each table holds", async () => {
    const { ctx } = configured();
    const dump = await exportWorkspace(ctx, WORKSPACE);
    expect(dump.exportVersion).toBeGreaterThanOrEqual(2);
    // Every table in the file is explained in it, so nobody has to guess.
    for (const key of Object.keys(dump)) {
      if (key === "readme" || key === "exportedAt") continue;
      expect(dump.readme[key], key).toBeTruthy();
    }
  });

  it("lists members by id and role, with their settings, and nobody else's", async () => {
    const { ctx } = configured();
    const dump = await exportWorkspace(ctx, WORKSPACE);

    expect(dump.members).toEqual([expect.objectContaining({ user_id: MEMBER, role: "owner" })]);
    expect(dump.memberSettings).toEqual([{ id: MEMBER, timezone: "Europe/London", booking_url: "https://cal.com/owner" }]);
    expect(dump.linkedinAccounts).toEqual([
      expect.objectContaining({ user_id: MEMBER, working_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] } }),
    ]);
    expect(dump.workspace).toEqual(
      expect.objectContaining({ onboarding: { workingHours: null, hasSalesNavigator: false, autonomy: "reviewed" } }),
    );
    expect(JSON.stringify(dump)).not.toContain(STRANGER);
  });

  it("never carries a secret, an address or sign-in data", async () => {
    const { ctx } = configured();
    const dump = await exportWorkspace(ctx, WORKSPACE);
    const serialized = JSON.stringify(dump);

    // The calendar feed by host alone: the address is a credential (rule 19).
    expect(dump.calendarFeeds).toEqual([expect.objectContaining({ url_host: "calendar.google.com" })]);
    expect(serialized).not.toContain("feedciphertext");
    expect(serialized).not.toContain("url_encrypted");
    expect(serialized).not.toContain("oauthciphertext");
    expect(serialized).not.toContain("credentials_encrypted");
    expect(serialized).not.toContain("acct_provider_secret");
    expect(serialized).not.toContain("member_provider_secret");
    expect(serialized).not.toContain("cus_secret_billing");
    expect(serialized).not.toContain("owner@acme.test");
    expect(serialized).not.toContain("1 Home Street");
  });
});
