import { describe, expect, it, vi } from "vitest";
import { FakeDb } from "./fake-db.js";
import type { WorkerContext } from "../src/context.js";

/*
 * The writer that fills the one screen whose output sits on a real
 * professional's public profile.
 *
 * Two things are worth a test here and neither is in the agent. It must write
 * nothing approved — the whole gate is `approved_at`, and a writer that set it
 * would make the review screen decorative (rule 9's habit, rule 40's stakes).
 * And it must not touch a row a person has already said yes to, or a row that
 * has already gone out: replacing the first quietly un-approves a decision
 * somebody made, and replacing the second makes this table disagree with
 * LinkedIn about what is on the profile.
 */

const postsMock = vi.fn();

vi.mock("@le/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@le/agents")>();
  return { ...actual, writePosts: (...args: unknown[]) => postsMock(...args) };
});

const { writeWorkspacePosts } = await import("../src/jobs/write-posts.js");

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";

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

function harness(posts: Array<Record<string, unknown>> = [], profileSpec: unknown = BUSINESS_PROFILE) {
  const db = new FakeDb();
  db.seed("business_profiles", [
    { id: "bp", workspace_id: WORKSPACE, spec: profileSpec, created_at: "2026-09-01T00:00:00Z" },
  ]);
  db.seed("knowledge_documents", [
    { workspace_id: WORKSPACE, title: "Pricing", content: "£49 a month, no contract." },
  ]);
  db.seed("customer_profiles", [
    {
      id: "cp",
      workspace_id: WORKSPACE,
      spec: { name: "Business owners", summary: "Get work by word of mouth." },
      approved_at: "2026-09-01T00:00:00Z",
    },
  ]);
  db.seed("profiles", [{ id: USER, full_name: "Tashfeen Ahmad" }]);
  db.seed("linkedin_posts", posts);
  db.seed("events", []);

  const ctx = {
    db: db.asDb(),
    agentsFor: () => ({ client: {} as never }),
  } as unknown as WorkerContext;
  return { db, ctx };
}

const agentReturns = (bodies: string[], over: Record<string, unknown> = {}) => {
  postsMock.mockReset();
  postsMock.mockResolvedValue({
    drafts: bodies.map((body, i) => ({
      name: `Draft ${i + 1}`,
      body,
      angle: `Angle ${i + 1}`,
      factsUsed: ["£49 a month, no contract."],
    })),
    droppedForLinks: 0,
    droppedForLength: 0,
    ...over,
  });
};

describe("writeWorkspacePosts", () => {
  it("writes drafts and approves none of them", async () => {
    agentReturns(["A post about referrals.", "A post about the spreadsheet."]);
    const { ctx, db } = harness();

    const result = await writeWorkspacePosts(ctx, { workspaceId: WORKSPACE, userId: USER });

    expect(result).toMatchObject({ ok: true, written: 2 });
    const rows = db.rows("linkedin_posts");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // The whole gate. A writer that set this would make the review screen
      // decorative, on the one thing this product publishes that cannot be
      // taken back.
      expect(row.approved_at, "the writer approved its own post").toBeNull();
      expect(row.approved_by).toBeNull();
      expect(row.status).toBe("draft");
      expect(row.user_id).toBe(USER);
      expect(row.business_profile_id).toBe("bp");
    }
  });

  it("keeps a picture only when every line of it comes from the post", async () => {
    postsMock.mockReset();
    const steps = {
      kind: "steps",
      title: "Answer a lead before lunch",
      items: [
        { label: "Reply inside ten minutes", detail: null },
        { label: "Ask one question", detail: null },
        { label: "Offer two times", detail: null },
      ],
      stat: null,
      columns: null,
    };
    postsMock.mockResolvedValue({
      drafts: [
        { name: "A", body: "Reply inside ten minutes. Ask one question. Offer two times.", angle: "a", factsUsed: [], format: "how_to", visual: steps },
        // A number the post never states: the picture is refused and the
        // post's short first sentence is framed instead.
        {
          name: "B",
          body: "Most calls come in after five. Few leave a message.",
          angle: "b",
          factsUsed: [],
          format: "insight",
          visual: { kind: "stat", title: "After five", items: [], stat: { value: "41%", caption: "of calls" }, columns: null },
        },
        // No picture and a long opening: none until somebody writes one.
        { name: "C", body: `${"word ".repeat(40)}end.`, angle: "c", factsUsed: [], format: "story", visual: null },
      ],
      droppedForLinks: 0,
      droppedForLength: 0,
      droppedForPitch: 0,
    });
    const { ctx, db } = harness();
    await writeWorkspacePosts(ctx, { workspaceId: WORKSPACE, userId: USER, readNews: async () => [] });
    const rows = db.rows("linkedin_posts");
    expect(rows.map((row) => row.format)).toEqual(["how_to", "insight", "story"]);
    expect(rows[0]!.graphic_headline).toBe("Answer a lead before lunch");
    expect((rows[0]!.graphic_spec as { kind: string }).kind).toBe("steps");
    expect(rows[1]!.graphic_headline).toBe("Most calls come in after five.");
    expect((rows[1]!.graphic_spec as { kind: string }).kind).toBe("quote");
    expect(rows[2]!.graphic_headline).toBeNull();
    expect(rows[2]!.graphic_spec).toBeNull();
  });

  it("hands the writer the audience's industries, pains and this week's real headlines", async () => {
    agentReturns(["A post."]);
    const { ctx, db } = harness();
    db.seed("customer_profiles", [
      {
        id: "cp2",
        workspace_id: WORKSPACE,
        spec: { name: "Plumbers", industries: ["Plumbing", "Construction"], pains: ["Missed calls after hours"] },
        approved_at: "2026-09-01T00:00:00Z",
      },
      // Not approved: nobody said this audience is the one.
      { id: "cp3", workspace_id: WORKSPACE, spec: { name: "Dentists", industries: ["Dental"] }, approved_at: null },
    ]);
    const asked: string[][] = [];
    await writeWorkspacePosts(ctx, {
      workspaceId: WORKSPACE,
      userId: USER,
      readNews: async (terms) => {
        asked.push([...terms]);
        return [{ title: "Plumbers face new licence rules", source: "Trade Weekly", date: "2026-10-27", url: "https://example.com/a" }];
      },
    });
    expect(asked).toEqual([["Plumbing", "Construction"]]);
    const input = postsMock.mock.calls[0]![1] as { industries: string[]; pains: string[]; news: unknown[] };
    expect(input.industries).toEqual(["Plumbing", "Construction"]);
    expect(input.pains).toEqual(["Missed calls after hours"]);
    // The writer gets the headline and its publication, never the link.
    expect(input.news).toEqual([{ title: "Plumbers face new licence rules", source: "Trade Weekly", date: "2026-10-27" }]);
  });

  it("writes the week's posts without news when the headlines cannot be read", async () => {
    agentReturns(["A post."]);
    const { ctx, db } = harness();
    db.seed("customer_profiles", [
      { id: "cp2", workspace_id: WORKSPACE, spec: { name: "Plumbers", industries: ["Plumbing"] }, approved_at: "2026-09-01T00:00:00Z" },
    ]);
    const result = await writeWorkspacePosts(ctx, {
      workspaceId: WORKSPACE,
      userId: USER,
      readNews: async () => {
        throw new Error("feed down");
      },
    });
    expect(result).toMatchObject({ ok: true, written: 1 });
    expect((postsMock.mock.calls[0]![1] as { news: unknown[] }).news).toEqual([]);
  });

  it("replaces this person's drafts and leaves approved and published rows alone", async () => {
    agentReturns(["A new draft."]);
    const { ctx, db } = harness([
      { id: "old-draft", workspace_id: WORKSPACE, user_id: USER, body: "An old draft.", status: "draft", approved_at: null },
      {
        id: "approved",
        workspace_id: WORKSPACE,
        user_id: USER,
        body: "Somebody read this one.",
        status: "approved",
        approved_at: "2026-09-26T09:00:00Z",
      },
      {
        id: "published",
        workspace_id: WORKSPACE,
        user_id: USER,
        body: "This is on the profile.",
        status: "published",
        approved_at: "2026-09-20T09:00:00Z",
      },
      /*
       * The row the mutation check found nothing guarding.
       *
       * A post LinkedIn refused has `approved_at` cleared but is not a draft,
       * so `is("approved_at", null)` alone deletes it — and with it the
       * provider's own words about why it failed, which is the only thing
       * telling the rep what to change before they approve it again. Only the
       * status filter keeps it.
       */
      {
        id: "failed",
        workspace_id: WORKSPACE,
        user_id: USER,
        body: "LinkedIn refused this one.",
        status: "failed",
        approved_at: null,
        error: "422: Cannot post to this profile",
      },
    ]);

    await writeWorkspacePosts(ctx, { workspaceId: WORKSPACE, userId: USER });

    expect(db.find("linkedin_posts", { id: "old-draft" }), "an unread draft survived").toBeUndefined();
    // Deleting this would quietly un-approve a decision somebody made — the
    // inverse of the trigger that clears approval when the words change.
    expect(db.find("linkedin_posts", { id: "approved" })?.body).toBe("Somebody read this one.");
    // And this one is the record of what is on the profile.
    expect(db.find("linkedin_posts", { id: "published" })?.body).toBe("This is on the profile.");
    // A refusal the rep has not read yet, with the provider's reason on it.
    const refused = db.find("linkedin_posts", { id: "failed" });
    expect(refused, "a failed post was swept away with the unread drafts").toBeDefined();
    expect(refused?.error).toContain("422");
  });

  it("leaves another rep's drafts alone", async () => {
    /*
     * A post sits on one person's profile, so two reps in a workspace each have
     * their own set. Scoped by workspace alone, one pressing the button would
     * silently throw away the other's unread drafts.
     */
    agentReturns(["Mine."]);
    const { ctx, db } = harness([
      { id: "theirs", workspace_id: WORKSPACE, user_id: OTHER_USER, body: "Theirs.", status: "draft", approved_at: null },
    ]);

    await writeWorkspacePosts(ctx, { workspaceId: WORKSPACE, userId: USER });

    expect(db.find("linkedin_posts", { id: "theirs" })?.body).toBe("Theirs.");
  });

  it("says what is missing instead of writing about a company it knows nothing about", async () => {
    agentReturns(["Should never be reached."]);
    const { ctx, db } = harness([], { companyName: "Half a row" });

    const result = await writeWorkspacePosts(ctx, { workspaceId: WORKSPACE, userId: USER });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("business profile");
    // Named rather than guessed at: without a profile the agent would write
    // fluent, entirely invented copy and offer it for approval as though it had
    // come from somewhere.
    expect(postsMock).not.toHaveBeenCalled();
    expect(db.rows("linkedin_posts")).toHaveLength(0);
  });

  it("hands the agent the segments somebody approved", async () => {
    // A post written for nobody in particular is written for LinkedIn in
    // general, which is nobody.
    agentReturns(["A post."]);
    const { ctx } = harness();

    await writeWorkspacePosts(ctx, { workspaceId: WORKSPACE, userId: USER });

    const input = postsMock.mock.calls[0]?.[1] as { audiences?: string[]; repName?: string };
    expect(input.audiences).toEqual(["Business owners — Get work by word of mouth."]);
    expect(input.repName).toBe("Tashfeen Ahmad");
  });

  it("only shows the agent the current drafts when it is being asked for a change", async () => {
    /*
     * A blank instruction with the old drafts attached invites a light edit of
     * them, and "write me new ones" returns the same three with two words moved.
     */
    const onScreen = () => [
      { id: "d1", workspace_id: WORKSPACE, user_id: USER, body: "The one on screen.", status: "draft", approved_at: null },
    ];
    // A fresh harness each time: the first run replaces the draft it was shown,
    // so a second run against the same fixture would be reading its own output.
    agentReturns(["A post."]);
    await writeWorkspacePosts(harness(onScreen()).ctx, { workspaceId: WORKSPACE, userId: USER });
    expect((postsMock.mock.calls[0]?.[1] as { current?: string[] }).current).toBeUndefined();

    agentReturns(["A post."]);
    await writeWorkspacePosts(harness(onScreen()).ctx, {
      workspaceId: WORKSPACE,
      userId: USER,
      instruction: "Shorter.",
    });
    expect((postsMock.mock.calls[0]?.[1] as { current?: string[] }).current).toEqual(["The one on screen."]);
  });
});
