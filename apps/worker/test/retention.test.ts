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
});
