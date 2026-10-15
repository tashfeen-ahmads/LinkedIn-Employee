import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { exportWorkspace } from "../src/jobs/retention.js";
import { importWorkspace, readImportFile } from "../src/jobs/import-workspace.js";
import { createServer } from "../src/server.js";
import type { WorkerContext } from "../src/context.js";
import type { Queues } from "../src/queues.js";

const SOURCE = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const REP = "44444444-4444-4444-8444-444444444444";
const AGENT = "55555555-5555-4555-8555-555555555555";
const CTA = "66666666-6666-4666-8666-666666666666";
const BUSINESS = "77777777-7777-4777-8777-777777777777";
const STRATEGY = "88888888-8888-4888-8888-888888888888";
const APPROVED = "2026-09-01T10:00:00.000Z";
const INTERNAL_SECRET = "internal-secret-at-least-32-characters-long";

const businessSpec = {
  companyName: "Acme",
  oneLiner: "Referral software for agencies.",
  offering: "A referral engine.",
  pricingModel: "unknown",
  proofPoints: [],
  toneOfVoice: "Plain.",
  competitors: [],
  commonObjections: [],
  differentiators: [],
};

const strategySpec = {
  name: "Small agencies",
  summary: "Owners of small B2B agencies.",
  jobTitles: ["Founder"],
  seniority: ["Owner"],
  industries: ["Marketing"],
  companySize: "2-50",
  geography: ["United Kingdom"],
  triggerEvents: [],
  pains: ["Referrals fall through the cracks"],
  valueProposition: "Never lose a referral.",
  whatTheyBuy: "A referral tracker",
  insteadOfToday: "A spreadsheet",
  salesNavFilters: {
    titles: [],
    seniorities: [],
    industries: [],
    companyHeadcount: [],
    geographies: [],
    keywords: [],
    excludeTitles: [],
  },
  hooks: ["One", "Two", "Three"],
  connectionNote: "Hi {{first_name}}",
  followUps: [
    { delayDays: 1, message: "Hello" },
    { delayDays: 3, message: "Again" },
  ],
  priority: 1,
};

/** A source workspace holding one of everything, approvals and defaults included. */
function harness() {
  const db = new FakeDb();
  db.seed("workspaces", [
    { id: SOURCE, name: "Source" },
    { id: TARGET, name: "Target" },
  ]);
  db.seed("memberships", [
    { workspace_id: SOURCE, user_id: OWNER, role: "owner" },
    { workspace_id: TARGET, user_id: OWNER, role: "owner" },
    { workspace_id: TARGET, user_id: REP, role: "rep" },
  ]);
  db.seed("agents", [
    { id: AGENT, workspace_id: SOURCE, name: "Nora", model: "gpt-5-mini", playbook: {}, custom_fields: [], is_default: true },
  ]);
  db.seed("ctas", [{ id: CTA, workspace_id: SOURCE, name: "Free audit", kind: "link", url: "https://acme.example.com/audit" }]);
  db.seed("knowledge_documents", [
    { workspace_id: SOURCE, title: "Pricing", content: "It is free.", agent_id: AGENT },
  ]);
  db.seed("pitches", [
    {
      workspace_id: SOURCE,
      name: "Leakage",
      body: "Referrals stop leaking.",
      is_default: true,
      approved_at: APPROVED,
      approved_by: OWNER,
      written_by: "agent",
      facts_used: ["free"],
      agent_id: AGENT,
    },
  ]);
  db.seed("hooks", [
    {
      workspace_id: SOURCE,
      name: "Opener",
      body: "Saw your agency grew this year.",
      is_default: true,
      approved_at: APPROVED,
      approved_by: OWNER,
      written_by: "agent",
      agent_id: AGENT,
    },
  ]);
  db.seed("business_profiles", [{ id: BUSINESS, workspace_id: SOURCE, spec: businessSpec, approved_at: APPROVED }]);
  db.seed("customer_profiles", [
    {
      id: STRATEGY,
      workspace_id: SOURCE,
      business_profile_id: BUSINESS,
      name: "Small agencies",
      spec: strategySpec,
      priority: 1,
      do_not_pursue: false,
      approved_at: APPROVED,
      cta_kind: "link",
      cta_id: CTA,
    },
  ]);
  db.seed("exclusions", [
    { workspace_id: SOURCE, kind: "company", value: "globex", raw_value: "Globex Inc.", reason: "Customer" },
  ]);
  db.seed("prospects", [
    {
      workspace_id: SOURCE,
      linkedin_url: "linkedin.com/in/asked-to-stop",
      first_name: "Stop",
      company: "Initech",
      do_not_contact: true,
    },
    {
      workspace_id: SOURCE,
      linkedin_url: "linkedin.com/in/already-written-to",
      first_name: "Written",
      do_not_contact: false,
      last_contacted_at: "2026-09-02T10:00:00.000Z",
    },
    { workspace_id: SOURCE, linkedin_url: "linkedin.com/in/never-touched", first_name: "Never", do_not_contact: false },
  ]);
  db.seed("campaigns", [{ workspace_id: SOURCE, name: "Autumn", status: "running" }]);
  db.seed("conversations", [{ workspace_id: SOURCE, prospect_id: "p" }]);
  db.seed("messages", [{ workspace_id: SOURCE, conversation_id: "c", body: "A private reply" }]);

  const ctx = { db: db.asDb() } as unknown as WorkerContext;
  return { db, ctx };
}

async function exported(ctx: WorkerContext) {
  return JSON.parse(JSON.stringify(await exportWorkspace(ctx, SOURCE))) as Record<string, unknown>;
}

const inTarget = (db: FakeDb, table: string) => db.rows(table).filter((r) => r.workspace_id === TARGET);

describe("importWorkspace", () => {
  it("writes configuration into the caller's workspace and nothing else", async () => {
    const { db, ctx } = harness();
    const file = await exported(ctx);
    const sourceCounts = Object.fromEntries(
      ["agents", "ctas", "knowledge_documents", "pitches", "hooks", "business_profiles", "customer_profiles", "exclusions"].map(
        (t) => [t, db.rows(t).filter((r) => r.workspace_id === SOURCE).length],
      ),
    );

    const result = await importWorkspace(ctx, { workspaceId: TARGET, userId: OWNER, raw: file });

    expect(result.ok).toBe(true);
    for (const table of Object.keys(sourceCounts)) {
      expect(inTarget(db, table).length, table).toBeGreaterThan(0);
      // Nothing written back into the workspace the file came from.
      expect(db.rows(table).filter((r) => r.workspace_id === SOURCE).length, table).toBe(sourceCounts[table]);
    }
    // Personal records and history never come in.
    for (const table of ["prospects", "campaigns", "conversations", "messages", "campaign_prospects", "meetings"]) {
      expect(inTarget(db, table), table).toHaveLength(0);
    }
  });

  it("ignores every id and workspace the file names, and rewires its own references", async () => {
    const { db, ctx } = harness();
    const file = await exported(ctx);
    const fileIds = new Set(
      Object.values(file)
        .filter(Array.isArray)
        .flatMap((rows) => (rows as Array<{ id?: string }>).map((r) => r.id))
        .filter(Boolean),
    );

    await importWorkspace(ctx, { workspaceId: TARGET, userId: OWNER, raw: file });

    const agent = inTarget(db, "agents")[0]!;
    const cta = inTarget(db, "ctas")[0]!;
    for (const table of ["agents", "ctas", "knowledge_documents", "pitches", "hooks", "business_profiles", "customer_profiles"]) {
      for (const row of inTarget(db, table)) expect(fileIds.has(row.id as string), table).toBe(false);
    }
    expect(inTarget(db, "knowledge_documents")[0]!.agent_id).toBe(agent.id);
    expect(inTarget(db, "pitches")[0]!.agent_id).toBe(agent.id);
    expect(inTarget(db, "hooks")[0]!.agent_id).toBe(agent.id);
    const strategy = inTarget(db, "customer_profiles")[0]!;
    expect(strategy.cta_id).toBe(cta.id);
    expect(strategy.business_profile_id).toBe(inTarget(db, "business_profiles")[0]!.id);
  });

  it("never follows a reference to a row the file did not bring", async () => {
    const { db, ctx } = harness();
    const file = await exported(ctx);
    // Point the knowledge at the source workspace's real agent, and drop the
    // agent itself from the file.
    file.agents = [];

    await importWorkspace(ctx, { workspaceId: TARGET, userId: OWNER, raw: file });

    expect(inTarget(db, "knowledge_documents")[0]!.agent_id).toBeNull();
    expect(inTarget(db, "pitches")[0]!.agent_id).toBeNull();
  });

  it("brings everything a person approves in unapproved, and nothing as a default", async () => {
    const { db, ctx } = harness();

    const result = await importWorkspace(ctx, { workspaceId: TARGET, userId: OWNER, raw: await exported(ctx) });

    for (const table of ["pitches", "hooks", "customer_profiles", "business_profiles"]) {
      for (const row of inTarget(db, table)) expect(row.approved_at ?? null, table).toBeNull();
    }
    for (const table of ["pitches", "hooks", "agents"]) {
      for (const row of inTarget(db, table)) expect(row.is_default, table).toBe(false);
    }
    expect(result.ok && result.awaitingApproval).toBe(4);
    expect(result.ok && result.summary).toMatch(/unapproved/);
  });

  it("carries the do-not-contact and already-contacted people over as exclusions, not prospects", async () => {
    const { db, ctx } = harness();

    const result = await importWorkspace(ctx, { workspaceId: TARGET, userId: OWNER, raw: await exported(ctx) });

    const people = inTarget(db, "exclusions").filter((r) => r.kind === "person").map((r) => r.value);
    expect(people.sort()).toEqual(["linkedin.com/in/already-written-to", "linkedin.com/in/asked-to-stop"]);
    expect(inTarget(db, "exclusions").find((r) => r.kind === "company")!.value).toBe("globex");
    expect(inTarget(db, "prospects")).toHaveLength(0);
    // The exclusion holds the address and nothing else about the person.
    expect(JSON.stringify(inTarget(db, "exclusions"))).not.toMatch(/Stop|Initech|Written/);
    expect(result.ok && result.counts.suppression.added).toBe(2);
  });

  it("adds nothing twice when the same file is imported again", async () => {
    const { db, ctx } = harness();
    const file = await exported(ctx);

    await importWorkspace(ctx, { workspaceId: TARGET, userId: OWNER, raw: file });
    const before = Object.fromEntries(
      ["exclusions", "agents", "ctas", "knowledge_documents", "pitches", "hooks", "customer_profiles", "business_profiles"].map(
        (t) => [t, inTarget(db, t).length],
      ),
    );
    const second = await importWorkspace(ctx, { workspaceId: TARGET, userId: OWNER, raw: file });

    for (const [table, count] of Object.entries(before)) expect(inTarget(db, table).length, table).toBe(count);
    expect(second.ok && second.counts.exclusions.added).toBe(0);
    expect(second.ok && second.counts.suppression.added).toBe(0);
  });

  it("recomputes an exclusion's matching key rather than trusting the file's", async () => {
    const { db, ctx } = harness();
    const file = await exported(ctx);
    (file.exclusions as Array<Record<string, unknown>>)[0]!.value = "something-else";

    await importWorkspace(ctx, { workspaceId: TARGET, userId: OWNER, raw: file });

    expect(inTarget(db, "exclusions").find((r) => r.kind === "company")!.value).toBe("globex");
  });

  it("refuses an export of another version, in words", () => {
    const refused = readImportFile({ exportVersion: 1, exclusions: [] });
    expect(refused).toEqual({ ok: false, error: expect.stringMatching(/version 1.*only version 2/) });
    expect(readImportFile({ hello: "world" }).ok).toBe(false);
    expect(readImportFile([]).ok).toBe(false);
  });
});

describe("/jobs/import-workspace", () => {
  function server(db: FakeDb) {
    const ctx = {
      db: db.asDb(),
      email: null,
      env: { APP_URL: "http://app.test", INTERNAL_API_SECRET: INTERNAL_SECRET } as WorkerContext["env"],
    } as unknown as WorkerContext;
    return createServer(ctx, {} as unknown as Queues);
  }

  const post = (app: ReturnType<typeof server>, body: unknown) =>
    app.request("/jobs/import-workspace", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: `Bearer ${INTERNAL_SECRET}` },
    });

  it("refuses a member who is not an owner or admin", async () => {
    const { db, ctx } = harness();
    const response = await post(server(db), { workspaceId: TARGET, userId: REP, file: await exported(ctx) });

    expect(response.status).toBe(403);
    expect(inTarget(db, "exclusions")).toHaveLength(0);
  });

  it("refuses a wrong version with a sentence the page can show", async () => {
    const { db } = harness();
    const response = await post(server(db), { workspaceId: TARGET, userId: OWNER, file: { exportVersion: 3 } });

    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toMatch(/only version 2/);
  });

  it("imports for an owner", async () => {
    const { db, ctx } = harness();
    const response = await post(server(db), { workspaceId: TARGET, userId: OWNER, file: await exported(ctx) });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { summary: string }).summary).toMatch(/Added/);
  });
});
