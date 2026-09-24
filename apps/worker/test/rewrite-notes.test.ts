import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";

/*
 * Rewriting a campaign's notes is the way back to its copy.
 *
 * Without it the agent is a settings page that changes nothing for anybody who
 * already has a campaign: the openers are fixed, the notes stay as they were
 * written, and the rep correctly concludes the product ignored them. What it
 * must never do is touch somebody already invited, or move anybody into
 * another arm of a test.
 */

const notesMock = vi.fn();

vi.mock("@le/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@le/agents")>();
  return { ...actual, personalizeInvites: (...args: unknown[]) => notesMock(...args) };
});

const { rewriteCampaignNotes } = await import("../src/jobs/rewrite-notes.js");

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const PROFILE = "44444444-4444-4444-8444-444444444444";
const AGENT = "55555555-5555-4555-8555-555555555555";

const BUSINESS_PROFILE = {
  companyName: "Referral Nova",
  oneLiner: "Warm introductions between small businesses.",
  offering: "A referral network.",
  pricingModel: "unknown",
  proofPoints: [],
  toneOfVoice: "Plain and direct.",
  competitors: [],
  commonObjections: [],
  differentiators: [],
};

const CUSTOMER_PROFILE = {
  name: "Business owners",
  summary: "People who own a small business and get work by word of mouth.",
  jobTitles: ["Owner"],
  seniority: ["Owner"],
  industries: ["Professional services"],
  companySize: "1-10",
  geography: ["United States"],
  triggerEvents: [],
  pains: ["Referrals that never happen"],
  valueProposition: "You meet the people best placed to send you work.",
  salesNavFilters: {
    titles: ["Owner"],
    seniorities: ["Owner"],
    industries: ["Professional services"],
    companyHeadcount: ["1-10"],
    geographies: ["United States"],
    keywords: [],
    excludeTitles: [],
  },
  // Deliberately not the agent's line. A fixture whose strategy hooks repeat
  // the agent's opener makes "the agent's openers reached the writer" pass
  // when the strategy's fallback was what arrived — a test green for the
  // wrong reason, which is worse than no test.
  hooks: [
    "The strategy's own first line.",
    "The strategy's own second line.",
    "The strategy's own third line.",
  ],
  connectionNote: "Hi {{first_name}}, who was the last person to send you a client?",
  followUps: [
    { delayDays: 2, message: "Worth a look?" },
    { delayDays: 4, message: "Closing the loop." },
  ],
  priority: 1,
};

function harness(options: { invitedToo?: boolean } = {}) {
  const db = new FakeDb();
  db.seed("campaigns", [
    {
      id: CAMPAIGN,
      workspace_id: WORKSPACE,
      name: "Owners — referral partners",
      agent_id: AGENT,
      customer_profile_id: PROFILE,
      owner_user_id: USER,
      rules: {},
    },
  ]);
  db.seed("agents", [
    {
      id: AGENT,
      workspace_id: WORKSPACE,
      name: "Referral Nova",
      model: "gpt-5",
      system_prompt: "Write like a person.",
      from_name: "Tashfeen",
      playbook: { objective: "Get a reply", qualification: [], handOver: "", avoid: "" },
      custom_fields: [],
      archived_at: null,
    },
  ]);
  db.seed("hooks", [
    {
      id: "hook-1",
      workspace_id: WORKSPACE,
      agent_id: AGENT,
      body: "Who was the last person to send you a client?",
      approved_at: "2026-09-24T00:00:00Z",
    },
  ]);
  db.seed("business_profiles", [
    { id: "bp", workspace_id: WORKSPACE, spec: BUSINESS_PROFILE, created_at: "2026-09-01T00:00:00Z" },
  ]);
  db.seed("customer_profiles", [
    { id: PROFILE, workspace_id: WORKSPACE, spec: CUSTOMER_PROFILE, approved_at: "2026-09-01T00:00:00Z" },
  ]);
  db.seed("profiles", [{ id: USER, full_name: "Tashfeen Ahmad" }]);
  db.seed("prospects", [
    { id: "p-queued", workspace_id: WORKSPACE, provider_id: "pv-queued", first_name: "Dana", last_name: "Rizzo", company: "Rizzo Events", title: "Owner", headline: null, location: null, linkedin_url: "https://linkedin.com/in/dana" },
    { id: "p-invited", workspace_id: WORKSPACE, provider_id: "pv-invited", first_name: "Kaira", last_name: "Cale", company: "Cale Studio", title: "Owner", headline: null, location: null, linkedin_url: "https://linkedin.com/in/kaira" },
  ]);
  db.seed("campaign_prospects", [
    {
      id: "cp-queued",
      workspace_id: WORKSPACE,
      campaign_id: CAMPAIGN,
      prospect_id: "p-queued",
      variant_id: null,
      status: "queued",
      invite_note: "Hi Dana, how does your chapter measure which introductions convert?",
    },
    ...(options.invitedToo
      ? [
          {
            id: "cp-invited",
            workspace_id: WORKSPACE,
            campaign_id: CAMPAIGN,
            prospect_id: "p-invited",
            variant_id: null,
            status: "invited",
            invite_note: "Hi Kaira, we helped a chapter raise introductions 300%.",
          },
        ]
      : []),
  ]);
  db.seed("campaign_variants", []);
  db.seed("events", []);

  const ctx = {
    db: db.asDb(),
    email: null,
    env: {} as WorkerContext["env"],
    agentsFor: () => ({
      client: { provider: "openai", models: { writer: "gpt-5", classifier: "gpt-5-mini" } } as never,
    }),
  } as unknown as WorkerContext;

  return { db, ctx };
}

const input = { workspaceId: WORKSPACE, userId: USER, campaignId: CAMPAIGN };

beforeEach(() => {
  notesMock.mockReset();
});

describe("rewriting a campaign's notes", () => {
  it("replaces the note on somebody still queued", async () => {
    notesMock.mockResolvedValue(
      new Map([
        [
          "pv-queued",
          { note: "Dana, who was the last person to send you a client?", promptVersion: "invite/test", grounding: ["Owner at Rizzo Events"], tooThin: false },
        ],
      ]),
    );
    const { db, ctx } = harness();

    const result = await rewriteCampaignNotes(ctx, input);

    expect(result).toEqual({ ok: true, rewritten: 1, unanswered: 0 });
    const row = db.rows("campaign_prospects").find((r) => r.id === "cp-queued");
    expect(row?.invite_note).toBe("Dana, who was the last person to send you a client?");
    expect(row?.invite_note_prompt_version).toBe("invite/test");
  });

  it("hands the agent's approved openers to the writer", async () => {
    // The whole point. Written without them the notes come back generic, which
    // is the copy this exists to replace.
    notesMock.mockResolvedValue(new Map());
    const { ctx } = harness();

    await rewriteCampaignNotes(ctx, input);

    expect(notesMock).toHaveBeenCalledTimes(1);
    const passed = notesMock.mock.calls[0][1] as { hooks: string[]; repName: string };
    expect(passed.hooks).toEqual(["Who was the last person to send you a client?"]);
    // The agent's from-name, not the account holder's: that is the difference
    // between a note and a signature block.
    expect(passed.repName).toBe("Tashfeen");
  });

  it("never touches somebody already invited", async () => {
    // Their note is the record of what they were sent. Rewriting it would
    // leave every screen reporting words nobody received.
    notesMock.mockResolvedValue(
      new Map([
        ["pv-queued", { note: "A new note.", promptVersion: "invite/test", grounding: [], tooThin: false }],
        ["pv-invited", { note: "Should never be used.", promptVersion: "invite/test", grounding: [], tooThin: false }],
      ]),
    );
    const { db, ctx } = harness({ invitedToo: true });

    const result = await rewriteCampaignNotes(ctx, input);

    expect(result).toEqual({ ok: true, rewritten: 1, unanswered: 0 });
    const invited = db.rows("campaign_prospects").find((r) => r.id === "cp-invited");
    expect(invited?.invite_note).toBe("Hi Kaira, we helped a chapter raise introductions 300%.");
  });

  it("leaves the note it has when the writer does not answer for somebody", async () => {
    // Degraded, not emptied. A campaign keeps the copy it already had, which
    // is what rule 27 asks for.
    notesMock.mockResolvedValue(new Map());
    const { db, ctx } = harness();

    const result = await rewriteCampaignNotes(ctx, input);

    expect(result).toEqual({ ok: true, rewritten: 0, unanswered: 1 });
    const row = db.rows("campaign_prospects").find((r) => r.id === "cp-queued");
    expect(row?.invite_note).toBe("Hi Dana, how does your chapter measure which introductions convert?");
  });

  it("leaves alone somebody invited while the model was running", async () => {
    /*
     * Minutes pass between reading the list and finishing the model call, and
     * a tick can invite somebody in between. Their note is then the record of
     * what they were actually sent, so the status is checked again at the
     * write — a read-then-write with no second check overwrites it.
     */
    const { db, ctx } = harness();
    notesMock.mockImplementation(async () => {
      db.rows("campaign_prospects")[0].status = "invited";
      return new Map([
        ["pv-queued", { note: "Written too late.", promptVersion: "invite/test", grounding: [], tooThin: false }],
      ]);
    });

    await rewriteCampaignNotes(ctx, input);

    const row = db.rows("campaign_prospects").find((r) => r.id === "cp-queued");
    expect(row?.invite_note).toBe("Hi Dana, how does your chapter measure which introductions convert?");
  });

  it("hands a writer failure back in words", async () => {
    // "429: rate limited" is the single most useful sentence a rep can be
    // shown here, and it used to go to a log on a host they cannot reach.
    notesMock.mockRejectedValue(new Error("429: rate limited"));
    const { db, ctx } = harness();

    const result = await rewriteCampaignNotes(ctx, input);

    expect(result).toEqual({ ok: false, reason: "429: rate limited" });
    const row = db.rows("campaign_prospects").find((r) => r.id === "cp-queued");
    expect(row?.invite_note).toBe("Hi Dana, how does your chapter measure which introductions convert?");
  });

  it("says so rather than running when nobody is waiting", async () => {
    const { db, ctx } = harness();
    db.rows("campaign_prospects")[0].status = "invited";

    const result = await rewriteCampaignNotes(ctx, input);

    expect(result.ok).toBe(false);
    expect(notesMock).not.toHaveBeenCalled();
  });

  it("refuses a campaign in another workspace", async () => {
    const { ctx } = harness();
    const result = await rewriteCampaignNotes(ctx, {
      ...input,
      workspaceId: "99999999-9999-4999-8999-999999999999",
    });
    expect(result.ok).toBe(false);
    expect(notesMock).not.toHaveBeenCalled();
  });
});
