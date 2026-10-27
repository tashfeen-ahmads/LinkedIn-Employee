import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db.js";
import { agentForCampaign, modelFor, openersFor, voiceOf } from "../src/agent.js";
import { pitchFor } from "../src/pitch.js";
import { knowledgeFor } from "../src/knowledge.js";
import { mergeValuesFor } from "../src/jobs/linkedin-action.js";

/*
 * The agent has to change what is actually sent.
 *
 * A settings screen that changes nothing is the worst outcome for a feature
 * like this: the rep edits the voice, watches the message go out identical,
 * and concludes the product is lying to them. They do not come back to the
 * screen. So every path that decides what a prospect reads is asserted here
 * against a campaign that has an agent and one that does not.
 */

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";

function harness(options: { withAgent?: boolean } = {}) {
  const db = new FakeDb();
  db.seed("campaigns", [
    { id: CAMPAIGN, workspace_id: WORKSPACE, agent_id: options.withAgent ? AGENT : null },
  ]);
  db.seed("agents", [
    {
      id: AGENT,
      workspace_id: WORKSPACE,
      name: "Chapter leaders",
      model: "gpt-5",
      system_prompt: "Write like a person, not a brochure.",
      from_name: "Tashfeen",
      playbook: { objective: "Get a reply", qualification: [], handOver: "", avoid: "Buzzwords" },
      custom_fields: [],
      archived_at: null,
    },
  ]);
  return db;
}

describe("the agent a campaign sends through", () => {
  it("is resolved from the campaign", async () => {
    const db = harness({ withAgent: true });
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);
    expect(agent?.fromName).toBe("Tashfeen");
  });

  it("is null for a campaign built before agents existed", async () => {
    // Not an error state. Every campaign in the product predates this, and all
    // of them have to keep behaving exactly as they did.
    const db = harness({ withAgent: false });
    expect(await agentForCampaign(db.asDb(), CAMPAIGN)).toBeNull();
  });

  it("is never another workspace's agent, whatever id the campaign carries", async () => {
    // A form can post any agent id; the worker is the tenant boundary (rule 58).
    const db = harness({ withAgent: true });
    db.find("agents", { id: AGENT })!.workspace_id = "99999999-9999-4999-8999-999999999999";
    expect(await agentForCampaign(db.asDb(), CAMPAIGN)).toBeNull();
  });
});

describe("the name a prospect actually reads", () => {
  const prospect = { first_name: "Kristina", company: "Nova Chapter", headline: null };

  it("is the agent's, not the account holder's", async () => {
    // The whole reason the field exists. "Tashfeen" reads like a person;
    // "Tashfeen Ahmad Khan" reads like a signature block, and that is the
    // difference between a note and a mailshot.
    const db = harness({ withAgent: true });
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);

    const values = mergeValuesFor(prospect, { full_name: "Tashfeen Ahmad Khan" }, agent);
    expect(values.rep_name).toBe("Tashfeen");
  });

  it("falls back to the account holder when the agent has not set one", async () => {
    const values = mergeValuesFor(prospect, { full_name: "Tashfeen Ahmad Khan" }, { fromName: null });
    expect(values.rep_name).toBe("Tashfeen Ahmad Khan");
  });

  it("is unchanged for a campaign with no agent", async () => {
    const values = mergeValuesFor(prospect, { full_name: "Tashfeen Ahmad Khan" });
    expect(values.rep_name).toBe("Tashfeen Ahmad Khan");
  });
});

describe("which openers a campaign may use", () => {
  function withHooks(db: FakeDb) {
    db.seed("hooks", [
      { id: "h1", workspace_id: WORKSPACE, agent_id: AGENT, body: "Agent's own line", approved_at: "2026-09-24T00:00:00Z" },
      { id: "h2", workspace_id: WORKSPACE, agent_id: AGENT, body: "Not approved", approved_at: null },
      { id: "h3", workspace_id: WORKSPACE, agent_id: null, body: "Workspace line", approved_at: "2026-09-24T00:00:00Z" },
    ]);
    return db;
  }

  it("is the agent's set, and only the agent's", async () => {
    // An agent given three openers has been given exactly the three somebody
    // wants used. Quietly adding the workspace's others back would make the
    // agent's list a suggestion.
    const db = withHooks(harness({ withAgent: true }));
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);

    const openers = await openersFor(db.asDb(), WORKSPACE, agent);
    expect(openers).toEqual(["Agent's own line"]);
    expect(openers).not.toContain("Workspace line");
  });

  it("never includes an opener nobody approved", async () => {
    // It is the first thing a stranger ever sees from this workspace, which is
    // the one place a review screen cannot be decorative.
    const db = withHooks(harness({ withAgent: true }));
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);

    expect(await openersFor(db.asDb(), WORKSPACE, agent)).not.toContain("Not approved");
  });

  it("never reads another workspace's openers under this agent's id", async () => {
    // The worker uses the service role, so RLS cannot keep a row from another
    // workspace out. A line carrying this agent id but a different workspace
    // is somebody else's copy, and it must never reach this campaign's notes.
    const db = harness({ withAgent: true });
    db.seed("hooks", [
      { id: "hx", workspace_id: "other-workspace", agent_id: AGENT, body: "Another company's line", approved_at: "2026-09-24T00:00:00Z" },
      { id: "h3", workspace_id: WORKSPACE, agent_id: null, body: "Workspace line", approved_at: "2026-09-24T00:00:00Z" },
    ]);
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);

    const openers = await openersFor(db.asDb(), WORKSPACE, agent);
    expect(openers).not.toContain("Another company's line");
    expect(openers).toEqual(["Workspace line"]);
  });

  it("falls back to the workspace when the agent has none of its own", async () => {
    // Rather than sending nothing: an invitation with no note is still
    // delivered, so an empty list here would quietly turn a campaign into bare
    // connection requests nobody chose to send.
    const db = harness({ withAgent: true });
    db.seed("hooks", [
      { id: "h3", workspace_id: WORKSPACE, agent_id: null, body: "Workspace line", approved_at: "2026-09-24T00:00:00Z" },
    ]);
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);

    expect(await openersFor(db.asDb(), WORKSPACE, agent)).toEqual(["Workspace line"]);
  });
});

describe("which offer a prospect hears", () => {
  function withPitches(db: FakeDb) {
    db.seed("pitches", [
      { id: "p1", workspace_id: WORKSPACE, agent_id: AGENT, body: "The agent's offer", approved_at: "2026-09-24T00:00:00Z", is_default: false },
      { id: "p2", workspace_id: WORKSPACE, agent_id: null, body: "The workspace default", approved_at: "2026-09-24T00:00:00Z", is_default: true },
    ]);
    return db;
  }

  it("is the campaign's agent's, over the workspace default", async () => {
    const db = withPitches(harness({ withAgent: true }));
    expect(await pitchFor(db.asDb(), WORKSPACE, null, AGENT)).toBe("The agent's offer");
  });

  it("is the workspace default when the campaign has no agent", async () => {
    const db = withPitches(harness({ withAgent: false }));
    expect(await pitchFor(db.asDb(), WORKSPACE, null, null)).toBe("The workspace default");
  });

  it("never uses an offer line nobody approved", async () => {
    const db = harness({ withAgent: true });
    db.seed("pitches", [
      { id: "p1", workspace_id: WORKSPACE, agent_id: AGENT, body: "Unread draft", approved_at: null, is_default: false },
    ]);
    // Nothing approved anywhere means nothing to say — and rule 40 holds the
    // follow-up rather than sending `{{pitch}}` to a real person.
    expect(await pitchFor(db.asDb(), WORKSPACE, null, AGENT)).toBeNull();
  });
});

describe("the voice handed to a writer", () => {
  it("carries the rep's own words, the objective and what to avoid", async () => {
    const db = harness({ withAgent: true });
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);

    const voice = voiceOf(agent);
    expect(voice).toContain("Write like a person");
    expect(voice).toContain("Get a reply");
    expect(voice).toContain("Buzzwords");
  });

  it("is absent when nothing was written, rather than an empty instruction", () => {
    // An empty block in the prompt is a sentence the model still reads.
    expect(voiceOf(null)).toBeUndefined();
  });
});

describe("which model actually runs", () => {
  const openai = { provider: "openai", models: { writer: "gpt-5", classifier: "gpt-5-mini" } };

  it("honours the agent's choice when this deployment serves it", async () => {
    const db = harness({ withAgent: true });
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);

    expect(modelFor(openai, agent)).toEqual({ model: "gpt-5", honoured: true });
  });

  it("falls back rather than failing when the provider cannot serve it", async () => {
    /*
     * A client built for one provider cannot answer for the other, so an agent
     * set to a Claude model on an OpenAI-keyed deployment is not a slower
     * agent — it is a failed call and a campaign with no notes. A rep gets
     * their campaign written in a slightly different voice instead.
     */
    const db = harness({ withAgent: true });
    db.rows("agents")[0]!.model = "claude-opus-5";
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);

    const chosen = modelFor(openai, agent);
    expect(chosen.model).toBe("gpt-5");
    // And never silently: the caller records an event on this being false,
    // because a setting that quietly does nothing is worse than one missing.
    expect(chosen.honoured).toBe(false);
  });

  it("overrides nothing when the client has not said what it serves", async () => {
    // Not evidence about anything. Deciding a model from a client that has not
    // reported one is the kind of guess that reaches a real person.
    const db = harness({ withAgent: true });
    const agent = await agentForCampaign(db.asDb(), CAMPAIGN);

    expect(modelFor({}, agent).model).toBeUndefined();
  });
});

/*
 * One workspace, two brands.
 *
 * Agents are how a workspace runs separate products, so each agent's copy and
 * facts belong to that brand alone. A pitch, an opener or a knowledge document
 * of brand B reaching a prospect of brand A is an offer for a product they
 * were never shown, under a real rep's name.
 */
describe("a workspace running two brands", () => {
  const AGENT_B = "44444444-4444-4444-8444-444444444444";

  function twoBrands(options: { workspaceDefault?: boolean; aHasOwn?: boolean } = {}) {
    const db = harness({ withAgent: true });
    db.seed("agents", [
      { id: AGENT_B, workspace_id: WORKSPACE, name: "Brand B", playbook: {}, custom_fields: [], archived_at: null },
    ]);
    db.seed("pitches", [
      ...(options.aHasOwn
        ? [{ id: "pa", workspace_id: WORKSPACE, agent_id: AGENT, body: "Brand A's offer", approved_at: "2026-09-24T00:00:00Z", is_default: true }]
        : []),
      { id: "pb", workspace_id: WORKSPACE, agent_id: AGENT_B, body: "Brand B's offer", approved_at: "2026-09-24T00:00:00Z", is_default: true },
      ...(options.workspaceDefault
        ? [{ id: "pw", workspace_id: WORKSPACE, agent_id: null, body: "The workspace default", approved_at: "2026-09-24T00:00:00Z", is_default: true }]
        : []),
    ]);
    db.seed("knowledge_documents", [
      { id: "ka", workspace_id: WORKSPACE, agent_id: AGENT, title: "A pricing", content: "A costs 10.", created_at: "2026-09-02T00:00:00Z" },
      { id: "kb", workspace_id: WORKSPACE, agent_id: AGENT_B, title: "B pricing", content: "B costs 99.", created_at: "2026-09-01T00:00:00Z" },
      { id: "kw", workspace_id: WORKSPACE, agent_id: null, title: "Shared FAQ", content: "Fact.", created_at: "2026-09-03T00:00:00Z" },
    ]);
    return db;
  }

  it("makes brand A's own offer, never brand B's", async () => {
    const db = twoBrands({ aHasOwn: true, workspaceDefault: true });
    expect(await pitchFor(db.asDb(), WORKSPACE, null, AGENT)).toBe("Brand A's offer");
  });

  it("falls back to the workspace's own default, not to another agent's default", async () => {
    // Two defaults share `is_default` since migration 0031 — the workspace's
    // and brand B's. Matched on that alone, `maybeSingle()` errors and brand
    // A goes silent.
    const db = twoBrands({ workspaceDefault: true });
    expect(await pitchFor(db.asDb(), WORKSPACE, null, AGENT)).toBe("The workspace default");
  });

  it("says nothing rather than brand B's offer when nothing of A's or the workspace's is approved", async () => {
    // The one other default in the workspace is brand B's. Matched on
    // `is_default` alone it is the only row, and brand A's prospect hears it.
    const db = twoBrands();
    expect(await pitchFor(db.asDb(), WORKSPACE, null, AGENT)).toBeNull();
    // And a campaign with no agent hears no brand's offer either.
    expect(await pitchFor(db.asDb(), WORKSPACE, null, null)).toBeNull();
  });

  it("writes brand A's replies from A's and the shared knowledge, never B's", async () => {
    const db = twoBrands();
    const docs = await knowledgeFor(db.asDb(), WORKSPACE, AGENT);
    // In the knowledge page's order — oldest first — across both halves.
    expect(docs.map((d) => d.title)).toEqual(["A pricing", "Shared FAQ"]);
  });

  it("gives a conversation with no agent only the shared knowledge", async () => {
    const db = twoBrands();
    const docs = await knowledgeFor(db.asDb(), WORKSPACE, null);
    expect(docs.map((d) => d.title)).toEqual(["Shared FAQ"]);
  });

  it("never reads another workspace's knowledge under this agent's id", async () => {
    const db = twoBrands();
    db.seed("knowledge_documents", [
      { id: "kx", workspace_id: "other-workspace", agent_id: AGENT, title: "Theirs", content: "No.", created_at: "2026-08-01T00:00:00Z" },
    ]);
    const docs = await knowledgeFor(db.asDb(), WORKSPACE, AGENT);
    expect(docs.map((d) => d.title)).not.toContain("Theirs");
  });
});
